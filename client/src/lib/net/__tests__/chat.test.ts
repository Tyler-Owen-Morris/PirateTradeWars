/** Global chat on the client: NetClient chat events, the useChat buffer, the text-entry focus check. */
import { beforeEach, describe, expect, it } from "vitest";
import { NetClient } from "../netClient";
import type { ChatMessage } from "@shared/protocol";
import { MAX_CLIENT_CHAT_LINES, useChat } from "../../stores/useChat";
import { isEditableElement, isTextEntryActive, useInputFocus } from "../../stores/useInputFocus";

function makeNet() {
  return new NetClient({
    url: "ws://test",
    createSocket: () => ({ readyState: 0, send() {}, close() {}, onopen: null, onclose: null, onerror: null, onmessage: null }) as any,
    now: () => 0,
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
  });
}

const line = (id: number, text = `line ${id}`, ts = id * 10): ChatMessage => ({ t: "chat", id, from: "Anne", text, ts });

describe("NetClient chat messages", () => {
  it("emits validated chat lines and never forwards them as legacy", () => {
    const net = makeNet();
    const got: ChatMessage[] = [];
    let legacy = 0;
    net.on("chat", (m) => got.push(m));
    net.on("legacy", () => legacy++);
    net.handleMessage({ t: "chat", id: 3, from: "Anne", text: "Ahoy\u0000!", ts: 5 });
    net.handleMessage({ t: "chat", id: 4, from: "Anne", text: "   ", ts: 6 }); // empty: dropped
    expect(got).toEqual([{ t: "chat", id: 3, from: "Anne", text: "Ahoy!", ts: 5 }]);
    expect(legacy).toBe(0);
  });

  it("emits chatHistory with malformed rows dropped", () => {
    const net = makeNet();
    let hist: ChatMessage[] | null = null;
    net.on("chatHistory", (l) => (hist = l));
    net.handleMessage({ t: "chatHistory", lines: [line(1), { nope: true }, line(2)] });
    expect(hist!.map((l) => l.id)).toEqual([1, 2]);
    net.handleMessage({ t: "chatHistory", lines: "bad" }); // ignored
    expect(hist!.length).toBe(2);
  });
});

describe("useChat buffer", () => {
  beforeEach(() => useChat.getState().clear());

  it("de-duplicates by server id and keeps private notices", () => {
    const s = useChat.getState();
    s.addLine(line(1));
    s.addLine(line(1));
    s.addLine({ t: "chat", id: 0, from: "", text: "slow down", ts: 15, sys: 1 });
    s.addLine({ t: "chat", id: 0, from: "", text: "slow down", ts: 16, sys: 1 });
    const lines = useChat.getState().lines;
    expect(lines.map((l) => l.id)).toEqual([1, 0, 0]);
    expect(new Set(lines.map((l) => l.key)).size).toBe(3);
  });

  it("merges a history replay in order without duplicates, as old (receivedAt 0)", () => {
    const s = useChat.getState();
    s.addLine(line(5), 999);
    s.mergeHistory([line(3), line(4), line(5)]);
    const lines = useChat.getState().lines;
    expect(lines.map((l) => l.id)).toEqual([3, 4, 5]);
    expect(lines[0].receivedAt).toBe(0);
    expect(lines[2].receivedAt).toBe(999);
  });

  it("caps the buffer", () => {
    const s = useChat.getState();
    for (let i = 1; i <= MAX_CLIENT_CHAT_LINES + 20; i++) s.addLine(line(i));
    const lines = useChat.getState().lines;
    expect(lines.length).toBe(MAX_CLIENT_CHAT_LINES);
    expect(lines[0].id).toBe(21);
  });
});

describe("text-entry focus", () => {
  it("chatFocused makes isTextEntryActive true", () => {
    expect(isTextEntryActive()).toBe(false); // node: no document
    useInputFocus.getState().setChatFocused(true);
    expect(isTextEntryActive()).toBe(true);
    useInputFocus.getState().setChatFocused(false);
    expect(isTextEntryActive()).toBe(false);
  });

  it("isEditableElement recognises text fields only", () => {
    const el = (tagName: string, extra: object = {}) => ({ tagName, ...extra }) as unknown as Element;
    expect(isEditableElement(el("INPUT", { type: "text" }))).toBe(true);
    expect(isEditableElement(el("INPUT", { type: "number" }))).toBe(true);
    expect(isEditableElement(el("INPUT", { type: "checkbox" }))).toBe(false);
    expect(isEditableElement(el("TEXTAREA"))).toBe(true);
    expect(isEditableElement(el("DIV", { isContentEditable: true }))).toBe(true);
    expect(isEditableElement(el("BUTTON"))).toBe(false);
    expect(isEditableElement(null)).toBe(false);
  });
});
