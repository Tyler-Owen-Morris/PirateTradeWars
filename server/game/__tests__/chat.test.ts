import { describe, it, expect } from "vitest";
import { CHAT_HISTORY_SIZE } from "@shared/protocol";
import {
  CHAT_BURST,
  CHAT_NOTICE_COOLDOWN_MS,
  ChatService,
  TokenBucket,
  CHAT_BLOCKED_NOTICE,
  CHAT_MUTE_BASE_MS,
  CHAT_MUTE_LEVEL_RESET_MS,
  CHAT_MUTE_MAX_MS,
  CHAT_STRIKE_WINDOW_MS,
  cleanChatText,
  collapseRepeats,
  textHash,
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

describe("cleanChatText", () => {
  it("collapses repeats, then masks mild words", () => {
    expect(cleanChatText("shiiiiiit")).toEqual({ action: "mask", text: "******" });
    expect(cleanChatText("ahoyyyyy")).toEqual({ action: "allow", text: "ahoyyy" });
  });

  it("drops severe lines", () => {
    expect(cleanChatText("you retard")).toEqual({ action: "drop", category: "slur" });
  });
});

describe("ChatService", () => {
  function service() {
    let now = 1_000_000;
    const logs: string[] = [];
    const chat = new ChatService({ now: () => now, log: (m) => logs.push(m) });
    return { chat, logs, advance: (ms: number) => (now += ms), at: () => now };
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

describe("ChatService moderation and escalation", () => {
  function service() {
    let now = 5_000_000;
    const logs: string[] = [];
    const chat = new ChatService({ now: () => now, log: (m) => logs.push(m) });
    return { chat, logs, advance: (ms: number) => (now += ms), at: () => now };
  }
  const kid = { id: "kid1", name: "Sea Dog" };
  const SLUR = "you retard";

  it("masks mild profanity and broadcasts it", () => {
    const { chat } = service();
    const r = chat.submit(kid, "well shit, they sank me");
    expect(r.ok && r.line.text).toBe("well ****, they sank me");
    expect(chat.history().length).toBe(1);
  });

  it("drops a severe line: private notice only, nothing recorded, logged without the text", () => {
    const { chat, logs } = service();
    const r = chat.submit(kid, SLUR);
    if (r.ok || r.reason !== "blocked") throw new Error("expected blocked");
    expect(r.category).toBe("slur");
    expect(r.notice).toMatchObject({ t: "chat", id: 0, from: "", sys: 1, text: CHAT_BLOCKED_NOTICE });
    expect(r.mutedUntil).toBeUndefined();
    expect(chat.history()).toEqual([]);
    expect(logs).toEqual([`[chat] dropped player=kid1 category=slur hash=${textHash(SLUR)}`]);
    expect(logs.join("")).not.toContain("retard");
    expect(textHash(SLUR)).toMatch(/^[0-9a-f]{12}$/);
  });

  it("drops child-safety lines (links, contact requests, phones) with the same notice", () => {
    const { chat } = service();
    for (const [text, cat] of [["join discord.gg/abc", "link"], ["how old r u", "personal"], ["call 555-123-4567", "phone"]] as const) {
      const r = chat.submit({ id: `p-${cat}`, name: "X" }, text);
      if (r.ok || r.reason !== "blocked") throw new Error(`expected blocked: ${text}`);
      expect(r.category).toBe(cat);
      expect(r.notice.text).toBe(CHAT_BLOCKED_NOTICE);
    }
  });

  it("3 drops within 10 minutes mute for 10 minutes; the mute survives a reconnect and expires", () => {
    const { chat, logs, advance } = service();
    expect(chat.submit(kid, SLUR).ok).toBe(false);
    advance(60_000);
    expect(chat.submit(kid, "send nudes").ok).toBe(false);
    advance(60_000);
    const third = chat.submit(kid, "kys");
    if (third.ok || third.reason !== "blocked") throw new Error("expected blocked");
    expect(third.mutedUntil).toBe(chat.mutedUntil(kid.id));
    expect(third.notice.text).toBe(`${CHAT_BLOCKED_NOTICE} You're muted from chat for 10 minutes.`);
    expect(logs.at(-1)).toBe("[chat] muted player=kid1 minutes=10 level=1");

    // Clean lines are refused while muted. A reconnect keeps the player id, so the same mute applies.
    advance(CHAT_NOTICE_COOLDOWN_MS);
    const muted = chat.submit({ ...kid, name: "Sea Dog" }, "ahoy");
    if (muted.ok || muted.reason !== "muted") throw new Error("expected muted");
    expect(muted.notice?.text).toBe("You're muted from chat for another 10 minutes.");
    const quiet = chat.submit(kid, "ahoy again");
    expect(!quiet.ok && quiet.notice).toBeNull(); // notice spam is rate-limited
    expect(chat.submit({ id: "other", name: "Other" }, "hi").ok).toBe(true); // others unaffected

    advance(CHAT_MUTE_BASE_MS);
    expect(chat.mutedUntil(kid.id)).toBeNull();
    expect(chat.submit(kid, "sorry everyone").ok).toBe(true);
  });

  it("strikes older than the window do not count", () => {
    const { chat, advance } = service();
    chat.submit(kid, SLUR);
    chat.submit(kid, SLUR);
    advance(CHAT_STRIKE_WINDOW_MS + 1);
    const r = chat.submit(kid, SLUR);
    if (r.ok || r.reason !== "blocked") throw new Error("expected blocked");
    expect(r.mutedUntil).toBeUndefined();
    expect(chat.mutedUntil(kid.id)).toBeNull();
  });

  it("repeat mutes double, capped at 1 hour, and the doubling resets after a quiet day", () => {
    const { chat, advance, at } = service();
    const muteOnce = (): number => {
      let r: ReturnType<ChatService["submit"]> | undefined;
      for (let i = 0; i < 3; i++) {
        advance(2000); // stay under the rate limit
        r = chat.submit(kid, SLUR);
      }
      if (!r || r.ok || r.reason !== "blocked" || r.mutedUntil === undefined) throw new Error("expected a mute");
      const len = r.mutedUntil - at();
      advance(len); // serve it
      return len;
    };
    const lengths = [muteOnce(), muteOnce(), muteOnce(), muteOnce(), muteOnce()];
    expect(lengths).toEqual([10, 20, 40, 60, 60].map((m) => m * 60_000));
    expect(Math.max(...lengths)).toBe(CHAT_MUTE_MAX_MS);
    advance(CHAT_MUTE_LEVEL_RESET_MS);
    expect(muteOnce()).toBe(CHAT_MUTE_BASE_MS);
  });

  it("checks the mute before the rate limit (muted lines do not use tokens)", () => {
    const { chat, advance } = service();
    for (let i = 0; i < 3; i++) chat.submit(kid, SLUR);
    expect(chat.mutedUntil(kid.id)).not.toBeNull();
    for (let i = 0; i < 20; i++) expect(chat.submit(kid, "hi").ok).toBe(false);
    advance(CHAT_MUTE_BASE_MS);
    for (let i = 0; i < CHAT_BURST; i++) expect(chat.submit(kid, `m${i}`).ok).toBe(true);
  });
});
