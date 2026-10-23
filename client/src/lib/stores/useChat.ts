/**
 * useChat: client-side global chat buffer (docs/netcode/PROTOCOL.md "Global chat").
 *
 * Lines arrive through `net` (`chat` / `chatHistory` events, wired in useSocket.tsx) already
 * validated by `parseChatLine`. Broadcast lines are de-duplicated by their server `id` (history is
 * replayed on every connect/reconnect); private system notices (id 0) get a local key. The buffer is
 * capped at MAX_CLIENT_CHAT_LINES. Text is plain text: render it as a React text node, never as HTML.
 */
import { create } from "zustand";
import type { ChatMessage } from "@shared/protocol";

export const MAX_CLIENT_CHAT_LINES = 100;

export interface ChatLine extends ChatMessage {
  /** Stable React key ("s<id>" for server lines, "l<n>" for private notices). */
  key: string;
  /** Local receive time (Date.now()), used for the fade-out of the collapsed log. */
  receivedAt: number;
}

interface ChatState {
  lines: ChatLine[];
  /** Add one line (ignored if a line with the same server id is already present). */
  addLine: (m: ChatMessage, receivedAt?: number) => void;
  /** Merge a history replay (oldest first). Replayed lines count as old: they do not pop the log. */
  mergeHistory: (lines: ChatMessage[], receivedAt?: number) => void;
  clear: () => void;
}

let localSeq = 0;

function toLine(m: ChatMessage, receivedAt: number): ChatLine {
  return { ...m, key: m.id > 0 ? `s${m.id}` : `l${++localSeq}`, receivedAt };
}

function cap(lines: ChatLine[]): ChatLine[] {
  return lines.length > MAX_CLIENT_CHAT_LINES ? lines.slice(lines.length - MAX_CLIENT_CHAT_LINES) : lines;
}

export const useChat = create<ChatState>((set) => ({
  lines: [],
  addLine: (m, receivedAt = Date.now()) =>
    set((s) => {
      if (m.id > 0 && s.lines.some((l) => l.id === m.id)) return s;
      return { lines: cap([...s.lines, toLine(m, receivedAt)]) };
    }),
  mergeHistory: (history, receivedAt = 0) =>
    set((s) => {
      const have = new Set(s.lines.filter((l) => l.id > 0).map((l) => l.id));
      const fresh = history.filter((m) => m.id > 0 && !have.has(m.id)).map((m) => toLine(m, receivedAt));
      if (fresh.length === 0) return s;
      // Every line carries the server time `ts` (notices too); order by ts, then server id.
      const merged = [...s.lines, ...fresh].sort((a, b) => a.ts - b.ts || a.id - b.id);
      return { lines: cap(merged) };
    }),
  clear: () => set({ lines: [] }),
}));
