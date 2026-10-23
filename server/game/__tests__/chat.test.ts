import { describe, it, expect } from "vitest";
import { CHAT_HISTORY_SIZE } from "@shared/protocol";
import {
  CHAT_BURST,
  CHAT_NOTICE_COOLDOWN_MS,
  ChatService,
  TokenBucket,
  cleanChatText,
  collapseRepeats,
  maskProfanity,
} from "../chat";

describe("TokenBucket", () => {
  it("allows a burst, then refills at the sustained rate", () => {
    const b = new TokenBucket(5, 1, 0);
    for (let i = 0; i < 5; i++) expect(b.tryTake(0)).toBe(true);
    expect(b.tryTake(0)).toBe(false);
    expect(b.tryTake(500)).toBe(false); // half a token
    expect(b.tryTake(1000)).toBe(true); // one token back after 1 s
    expect(b.tryTake(1000)).toBe(false);
    expect(b.isFull(1000 + 5000)).toBe(true); // never more than capacity
    for (let i = 0; i < 5; i++) expect(b.tryTake(6000)).toBe(true);
    expect(b.tryTake(6000)).toBe(false);
  });
});

describe("collapseRepeats", () => {
  it("cuts runs longer than 3 (case-insensitive)", () => {
    expect(collapseRepeats("noooooooo")).toBe("nooo");
    expect(collapseRepeats("AAAAaaaa!!!!!!")).toBe("AAA!!!");
    expect(collapseRepeats("ahoy matey")).toBe("ahoy matey");
    expect(collapseRepeats("\u{1F480}\u{1F480}\u{1F480}\u{1F480}\u{1F480}")).toBe("\u{1F480}\u{1F480}\u{1F480}");
  });
});

describe("maskProfanity", () => {
  it("masks listed words with same-length asterisks, case-insensitively", () => {
    expect(maskProfanity("what the fuck")).toBe("what the ****");
    expect(maskProfanity("SHIT happens")).toBe("**** happens");
    expect(maskProfanity("you fucking rat")).toBe("you ******* rat");
  });

  it("is tolerant of leet substitutions and stretched letters", () => {
    expect(maskProfanity("sh1t")).toBe("****");
    expect(maskProfanity("fuuuck")).toBe("******");
    expect(maskProfanity("f@g")).toBe("***");
  });

  it("masks slurs", () => {
    expect(maskProfanity("you retard")).toBe("you ******");
    expect(maskProfanity("faggots")).toBe("*******");
  });

  it("does not mask innocent words or pirate talk", () => {
    for (const ok of ["class assignment", "Scunthorpe", "spice trade", "grape juice", "cock the pistol", "you scurvy bastard", "bloody hell", "Moby Dick"]) {
      expect(maskProfanity(ok)).toBe(ok);
    }
  });

  it("keeps punctuation and surrounding text intact", () => {
    expect(maskProfanity("(shit!)")).toBe("(****!)");
  });
});

describe("cleanChatText", () => {
  it("collapses then masks", () => {
    expect(cleanChatText("shiiiiiit")).toBe("******");
  });
});

describe("ChatService", () => {
  function service() {
    let now = 1_000_000;
    const chat = new ChatService({ now: () => now });
    return { chat, advance: (ms: number) => (now += ms), at: () => now };
  }
  const alice = { id: "p1", name: "Alice" };
  const bob = { id: "p2", name: "Bob" };

  it("accepts a line with the server-side name, an increasing id and ts", () => {
    const { chat, at } = service();
    const a = chat.submit(alice, "ahoy");
    const b = chat.submit(bob, "yo ho");
    expect(a).toEqual({ ok: true, line: { t: "chat", id: 1, from: "Alice", text: "ahoy", ts: at() } });
    expect(b.ok && b.line.id).toBe(2);
  });

  it("cleans text (repeats + profanity)", () => {
    const { chat } = service();
    const r = chat.submit(alice, "shit!!!!!!");
    expect(r.ok && r.line.text).toBe("****!!!");
  });

  it("rate-limits per player: burst of 5, then 1/s, with one polite notice per cooldown", () => {
    const { chat, advance } = service();
    for (let i = 0; i < CHAT_BURST; i++) expect(chat.submit(alice, `m${i}`).ok).toBe(true);
    const t1 = chat.submit(alice, "too fast");
    expect(t1.ok).toBe(false);
    if (!t1.ok) {
      expect(t1.notice).not.toBeNull();
      expect(t1.notice!.sys).toBe(1);
      expect(t1.notice!.id).toBe(0); // private, not in history
    }
    const t2 = chat.submit(alice, "still too fast");
    expect(!t2.ok && t2.notice).toBeNull(); // no notice spam
    // Bob is unaffected.
    expect(chat.submit(bob, "hi").ok).toBe(true);
    advance(1000);
    expect(chat.submit(alice, "one more").ok).toBe(true);
    expect(chat.submit(alice, "and another").ok).toBe(false);
    advance(CHAT_NOTICE_COOLDOWN_MS);
    // After the cooldown a new throttle gets a fresh notice (tokens refilled, so drain first).
    const results = Array.from({ length: CHAT_BURST + 2 }, (_, i) => chat.submit(alice, `x${i}`));
    expect(results.filter((r) => !r.ok && r.notice).length).toBe(1);
  });

  it("keeps the last CHAT_HISTORY_SIZE lines, oldest first; notices are not recorded", () => {
    const { chat, advance } = service();
    for (let i = 0; i < CHAT_HISTORY_SIZE + 10; i++) {
      advance(1000);
      chat.submit({ id: `p${i}`, name: `P${i}` }, `line ${i}`);
    }
    const h = chat.history();
    expect(h.length).toBe(CHAT_HISTORY_SIZE);
    expect(h[0].text).toBe("line 10");
    expect(h[h.length - 1].text).toBe(`line ${CHAT_HISTORY_SIZE + 9}`);
    h.pop(); // a copy
    expect(chat.history().length).toBe(CHAT_HISTORY_SIZE);
  });

  it("broadcast system lines go into the history", () => {
    const { chat } = service();
    const s = chat.systemLine("The Spanish fleet approaches");
    expect(s.sys).toBe(1);
    expect(s.id).toBeGreaterThan(0);
    expect(chat.history()).toEqual([s]);
  });
});
