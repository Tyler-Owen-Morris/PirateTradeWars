import { describe, expect, it } from "vitest";
import crypto from "crypto";
import {
  LoginLimiter,
  SessionSigner,
  clientIp,
  makePasswordHash,
  parsePasswordHash,
  trustedProxyHops,
  validSessionSecret,
  verifyPassword,
} from "../auth";

const SECRET = "ab".repeat(32);

describe("password hash", () => {
  it("has the exact scrypt:<salt16>:<hash64> format of the spec formula", () => {
    const salt = Buffer.from("00112233445566778899aabbccddeeff", "hex");
    const line = makePasswordHash("hunter2 hunter2", salt);
    const expected = crypto.scryptSync("hunter2 hunter2", salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex");
    expect(line).toBe(`scrypt:00112233445566778899aabbccddeeff:${expected}`);
    expect(line).toMatch(/^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/);
  });

  it("uses a random salt each time", () => {
    expect(makePasswordHash("same")).not.toBe(makePasswordHash("same"));
  });

  it("verifies the right password and refuses wrong or junk input", async () => {
    const parsed = parsePasswordHash(makePasswordHash("correct horse"))!;
    expect(await verifyPassword("correct horse", parsed)).toBe(true);
    expect(await verifyPassword("correct horse ", parsed)).toBe(false);
    expect(await verifyPassword("", parsed)).toBe(false);
    expect(await verifyPassword(undefined, parsed)).toBe(false);
    expect(await verifyPassword({ toString: () => "correct horse" }, parsed)).toBe(false);
    expect(await verifyPassword("x".repeat(2000), parsed)).toBe(false);
  });

  it("rejects malformed hash lines", () => {
    expect(parsePasswordHash(undefined)).toBeNull();
    expect(parsePasswordHash("")).toBeNull();
    expect(parsePasswordHash("bcrypt:aa:bb")).toBeNull();
    expect(parsePasswordHash(`scrypt:${"a".repeat(30)}:${"b".repeat(128)}`)).toBeNull();
    expect(parsePasswordHash(`scrypt:${"a".repeat(32)}:${"b".repeat(126)}`)).toBeNull();
    expect(parsePasswordHash(`scrypt:${"g".repeat(32)}:${"b".repeat(128)}`)).toBeNull();
    expect(parsePasswordHash(`scrypt:${"a".repeat(32)}:${"b".repeat(128)}:x`)).toBeNull();
    expect(parsePasswordHash(`  scrypt:${"a".repeat(32)}:${"b".repeat(128)}\n`)).not.toBeNull();
  });

  it("session secret must be >= 32 bytes of hex", () => {
    expect(validSessionSecret(SECRET)).toBe(true);
    expect(validSessionSecret("ab".repeat(31))).toBe(false);
    expect(validSessionSecret("zz".repeat(40))).toBe(false);
    expect(validSessionSecret(undefined)).toBe(false);
  });
});

describe("session tokens", () => {
  const hash = makePasswordHash("pw-for-sessions");

  it("signs and verifies", () => {
    const s = new SessionSigner(SECRET, hash);
    const t = s.issue();
    expect(t).toMatch(/^v1\.\d+\.[0-9a-f]{32}\.[0-9a-f]{64}$/);
    expect(s.verify(t)).toBe(true);
  });

  it("expires", () => {
    let now = 1_000_000;
    const s = new SessionSigner(SECRET, hash, () => now);
    const t = s.issue(1000);
    now += 999;
    expect(s.verify(t)).toBe(true);
    now += 1;
    expect(s.verify(t)).toBe(false);
  });

  it("refuses tampered tokens (expiry, nonce, mac) and junk", () => {
    const s = new SessionSigner(SECRET, hash);
    const t = s.issue();
    const [v, exp, nonce, mac] = t.split(".");
    expect(s.verify(`${v}.${Number(exp) + 1}.${nonce}.${mac}`)).toBe(false);
    expect(s.verify(`${v}.${exp}.${nonce.replace(/^./, nonce[0] === "a" ? "b" : "a")}.${mac}`)).toBe(false);
    expect(s.verify(`${v}.${exp}.${nonce}.${mac.replace(/.$/, mac.endsWith("0") ? "1" : "0")}`)).toBe(false);
    expect(s.verify("")).toBe(false);
    expect(s.verify(undefined)).toBe(false);
    expect(s.verify("v1.1.2.3")).toBe(false);
  });

  it("is bound to the secret and to the password hash (rotation logs everyone out)", () => {
    const t = new SessionSigner(SECRET, hash).issue();
    expect(new SessionSigner("cd".repeat(32), hash).verify(t)).toBe(false);
    expect(new SessionSigner(SECRET, makePasswordHash("new password")).verify(t)).toBe(false);
    expect(new SessionSigner(SECRET, hash).verify(t)).toBe(true);
  });

  it("revoke (logout) kills that token only", () => {
    const s = new SessionSigner(SECRET, hash);
    const a = s.issue();
    const b = s.issue();
    s.revoke(a);
    expect(s.verify(a)).toBe(false);
    expect(s.verify(b)).toBe(true);
  });
});

describe("login limiter", () => {
  it("locks an IP after 5 failures for 15 minutes", () => {
    let now = 0;
    const l = new LoginLimiter(undefined, () => now);
    for (let i = 0; i < 4; i++) {
      expect(l.check("1.1.1.1").ok).toBe(true);
      expect(l.fail("1.1.1.1")).toBe(4 - i);
    }
    expect(l.check("1.1.1.1").ok).toBe(true);
    expect(l.fail("1.1.1.1")).toBe(0);
    const gate = l.check("1.1.1.1");
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.scope).toBe("ip");
      expect(gate.retryAfterMs).toBe(15 * 60 * 1000);
    }
    expect(l.check("2.2.2.2").ok).toBe(true); // other IPs unaffected
    now += 15 * 60 * 1000;
    expect(l.check("1.1.1.1").ok).toBe(true);
  });

  it("success clears the IP's failures", () => {
    const l = new LoginLimiter();
    for (let i = 0; i < 4; i++) l.fail("1.1.1.1");
    l.succeed("1.1.1.1");
    expect(l.fail("1.1.1.1")).toBe(4);
  });

  it("locks everyone after 30 failures in the window (IP rotation)", () => {
    let now = 0;
    const l = new LoginLimiter(undefined, () => now);
    for (let i = 0; i < 30; i++) {
      now += 1000;
      expect(l.check(`10.0.0.${i}`).ok).toBe(true);
      l.fail(`10.0.0.${i}`);
    }
    const gate = l.check("9.9.9.9");
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.scope).toBe("global");
    now += 15 * 60 * 1000; // the oldest failures have aged out
    expect(l.check("9.9.9.9").ok).toBe(true);
  });
});

describe("client ip", () => {
  it("takes the entry `hops` from the right of [...XFF, peer]", () => {
    // browser 203.0.113.9 -> ALB (appends client) -> nginx (appends ALB 10.0.1.5) -> node (peer 127.0.0.1)
    expect(clientIp("203.0.113.9, 10.0.1.5", "127.0.0.1", 2)).toBe("203.0.113.9");
    // a spoofed leading entry is ignored
    expect(clientIp("6.6.6.6, 203.0.113.9, 10.0.1.5", "127.0.0.1", 2)).toBe("203.0.113.9");
    expect(clientIp(undefined, "::ffff:127.0.0.1", 0)).toBe("127.0.0.1");
    expect(clientIp("6.6.6.6", "192.168.1.2", 0)).toBe("192.168.1.2");
    // short chain: clamps to the leftmost entry instead of throwing
    expect(clientIp(undefined, "127.0.0.1", 2)).toBe("127.0.0.1");
  });

  it("hop count: env override, else 2 in production, 0 elsewhere", () => {
    expect(trustedProxyHops({ NODE_ENV: "production" })).toBe(2);
    expect(trustedProxyHops({ NODE_ENV: "development" })).toBe(0);
    expect(trustedProxyHops({ NODE_ENV: "production", ADMIN_TRUSTED_PROXY_HOPS: "3" })).toBe(3);
    expect(trustedProxyHops({ ADMIN_TRUSTED_PROXY_HOPS: "junk" })).toBe(0);
  });
});
