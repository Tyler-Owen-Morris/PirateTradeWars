import { describe, it, expect } from "vitest";
import { MAX_CHAT_LENGTH, MAX_NAME_LENGTH, parseChatLine, parseClientMessage, sanitizeChatText } from "../protocol";

describe("sanitizeChatText", () => {
  it("trims and collapses whitespace (tabs/newlines become spaces)", () => {
    expect(sanitizeChatText("  ahoy \t\n  there  ")).toBe("ahoy there");
  });

  it("strips control, zero-width and bidi-override characters", () => {
    expect(sanitizeChatText("a\u0000b\u0007c\u007fd\u009be")).toBe("abcde");
    expect(sanitizeChatText("in​vis‍ible﻿")).toBe("invisible");
    expect(sanitizeChatText("‮gnp.exe‬")).toBe("gnp.exe");
    expect(sanitizeChatText("x⁦y⁩")).toBe("xy");
  });

  it("strips invisible chars before collapsing whitespace (U+FEFF counts as \\s)", () => {
    expect(sanitizeChatText("n﻿i­g͏gㅤe᠎r")).toBe("nigger");
    expect(sanitizeChatText("a ﻿ b")).toBe("a b");
  });

  it("rejects empty / whitespace-only / control-only / non-strings", () => {
    expect(sanitizeChatText("")).toBeNull();
    expect(sanitizeChatText("    ")).toBeNull();
    expect(sanitizeChatText("\u0000​\n")).toBeNull();
    expect(sanitizeChatText(42)).toBeNull();
    expect(sanitizeChatText(null)).toBeNull();
  });

  it("cuts to MAX_CHAT_LENGTH code points without splitting surrogate pairs", () => {
    expect(sanitizeChatText("a".repeat(500))).toBe("a".repeat(MAX_CHAT_LENGTH));
    const skulls = "\u{1F480}".repeat(MAX_CHAT_LENGTH + 10);
    const out = sanitizeChatText(skulls)!;
    expect(Array.from(out).length).toBe(MAX_CHAT_LENGTH);
    expect(out).toBe("\u{1F480}".repeat(MAX_CHAT_LENGTH));
  });

  it("keeps HTML-looking text as plain text (rendering is the client's job)", () => {
    expect(sanitizeChatText("<b>hi</b>")).toBe("<b>hi</b>");
  });
});

describe("parseClientMessage chat", () => {
  it("accepts a chat message and sanitizes the text", () => {
    expect(parseClientMessage(JSON.stringify({ t: "chat", text: "  Ahoy!\n" }))).toEqual({ t: "chat", text: "Ahoy!" });
    expect(parseClientMessage({ type: "chat", text: "hi" })).toEqual({ t: "chat", text: "hi" });
  });

  it("drops unknown fields (a client cannot pick its own name)", () => {
    expect(parseClientMessage({ t: "chat", text: "hi", from: "Admin", sys: 1 })).toEqual({ t: "chat", text: "hi" });
  });

  it("rejects empty, non-string and absurdly long text", () => {
    expect(parseClientMessage({ t: "chat", text: "   " })).toBeNull();
    expect(parseClientMessage({ t: "chat", text: "\u0000" })).toBeNull();
    expect(parseClientMessage({ t: "chat", text: 5 })).toBeNull();
    expect(parseClientMessage({ t: "chat" })).toBeNull();
    expect(parseClientMessage({ t: "chat", text: "x".repeat(MAX_CHAT_LENGTH * 4 + 1) })).toBeNull();
  });

  it("cuts long-but-plausible text to the cap", () => {
    const m = parseClientMessage({ t: "chat", text: "y".repeat(MAX_CHAT_LENGTH + 50) });
    expect(m).toEqual({ t: "chat", text: "y".repeat(MAX_CHAT_LENGTH) });
  });
});

describe("parseChatLine (client side)", () => {
  it("accepts a broadcast line", () => {
    expect(parseChatLine({ t: "chat", id: 7, from: "Blackbeard", text: "Yarr", ts: 123 })).toEqual({
      t: "chat",
      id: 7,
      from: "Blackbeard",
      text: "Yarr",
      ts: 123,
    });
  });

  it("keeps the sys flag and defaults missing fields", () => {
    expect(parseChatLine({ t: "chat", text: "Slow down", sys: 1 })).toEqual({ t: "chat", id: 0, from: "", text: "Slow down", ts: 0, sys: 1 });
  });

  it("re-sanitizes text and name, rejects junk", () => {
    const long = "n".repeat(MAX_NAME_LENGTH + 5);
    const m = parseChatLine({ t: "chat", id: 1, from: long, text: "a\u0000b", ts: 1 })!;
    expect(m.text).toBe("ab");
    expect(m.from.length).toBe(MAX_NAME_LENGTH);
    expect(parseChatLine({ t: "chat", id: 1, from: "x", text: "", ts: 1 })).toBeNull();
    expect(parseChatLine({ t: "other", text: "hi" })).toBeNull();
    expect(parseChatLine(null)).toBeNull();
    expect(parseChatLine([1, 2])).toBeNull();
  });
});
