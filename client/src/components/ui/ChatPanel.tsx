/**
 * ChatPanel: global chat (docs/netcode/PROTOCOL.md "Global chat"). Self-contained; mounted once in
 * GameUI. Styling is plain Tailwind kept inside this file so it is easy to restyle.
 *
 * - Collapsed: the last few lines, bottom-left, each fading out FADE_AFTER_MS after it arrived.
 * - Enter opens the input (T is already "trade at port"), Enter sends, Esc closes (draft kept).
 *   The small chat button toggles it on touch devices.
 * - While the input has focus `useInputFocus.chatFocused` is true, so Player.tsx feeds neutral
 *   keyboard controls (drei KeyboardControls listens on window and would otherwise steer/fire).
 *   Key DOWN events are also stopped from reaching window listeners (GameUI's H/M/Tab/T hotkeys,
 *   WorldMap Esc). Key UP events are left alone so drei still sees releases of keys held before.
 * - Lines are rendered as React text nodes only; never as HTML.
 * - On unmount: focus flag cleared, listeners/timers removed, chat buffer cleared (the server replays
 *   its history on the next join).
 */
import { useEffect, useRef, useState } from "react";
import { MessageSquare } from "lucide-react";
import { MAX_CHAT_LENGTH } from "@shared/protocol";
import { useChat, type ChatLine } from "@/lib/stores/useChat";
import { useInputFocus, isTextEntryActive } from "@/lib/stores/useInputFocus";
import { useSocket } from "@/lib/stores/useSocket";
import { useGameState } from "@/lib/stores/useGameState";

/** A line stays in the collapsed log this long after it arrived (ms)... */
const FADE_AFTER_MS = 10_000;
/** ...and fades out over the last part of that. */
const FADE_DURATION_MS = 2_000;
/** Lines shown while collapsed / open. */
const COLLAPSED_LINES = 5;
const OPEN_LINES = 50;

function LineView({ line, self }: { line: ChatLine; self: boolean }) {
  if (line.sys) return <div className="text-amber-300 italic break-words">{line.text}</div>;
  return (
    <div className="break-words">
      <span className={self ? "font-semibold text-sky-300" : "font-semibold text-amber-200"}>{line.from}</span>
      <span className="text-white">: {line.text}</span>
    </div>
  );
}

export default function ChatPanel() {
  const lines = useChat((s) => s.lines);
  const sendChat = useSocket((s) => s.sendChat);
  const myName = useSocket((s) => s.playerName);
  const isSunk = useGameState((s) => s.isSunk);
  const setChatFocused = useInputFocus((s) => s.setChatFocused);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // Enter opens chat (only when nothing else is being typed into, and not while trading / sunk).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (open || e.key !== "Enter" || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTextEntryActive()) return;
      const gs = useGameState.getState();
      if (gs.isTrading || gs.isSunk) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Focus the input when opened.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Re-render 4x a second so collapsed lines fade out (only while something is still visible).
  const newest = lines.length ? lines[lines.length - 1].receivedAt : 0;
  useEffect(() => {
    if (open || Date.now() - newest > FADE_AFTER_MS) return;
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t - newest > FADE_AFTER_MS) window.clearInterval(id);
    }, 250);
    return () => window.clearInterval(id);
  }, [open, newest]);

  // Keep the open log scrolled to the newest line.
  useEffect(() => {
    if (open && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [open, lines.length]);

  // Close if the ship sinks while typing.
  useEffect(() => {
    if (isSunk) setOpen(false);
  }, [isSunk]);

  // Unmount: never leave the game thinking we are still typing; drop the buffer.
  useEffect(
    () => () => {
      useInputFocus.getState().setChatFocused(false);
      useChat.getState().clear();
    },
    [],
  );

  const close = () => {
    setOpen(false);
    inputRef.current?.blur();
  };

  const submit = () => {
    if (draft.trim()) {
      sendChat(draft);
      setDraft("");
    }
    close();
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Keep typed keys away from window listeners (game hotkeys, drei keydown).
    e.stopPropagation();
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  const toggle = () => {
    if (open) close();
    else if (!isSunk) setOpen(true);
  };

  const shown = open
    ? lines.slice(-OPEN_LINES)
    : lines.slice(-COLLAPSED_LINES).filter((l) => now - l.receivedAt < FADE_AFTER_MS);

  return (
    <div className="absolute left-2 sm:left-4 bottom-24 z-[55] w-[min(24rem,calc(100vw-1rem))] pointer-events-none text-xs sm:text-sm">
      {shown.length > 0 && (
        <div
          ref={logRef}
          className={
            open
              ? "mb-1 max-h-48 overflow-y-auto rounded bg-black/60 p-2 space-y-0.5 pointer-events-auto"
              : "mb-1 space-y-0.5 [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]"
          }
        >
          {shown.map((l) => {
            const age = now - l.receivedAt;
            const fade = open ? 1 : Math.max(0, Math.min(1, (FADE_AFTER_MS - age) / FADE_DURATION_MS));
            return (
              <div key={l.key} style={{ opacity: fade }}>
                <LineView line={l} self={!l.sys && !!myName && l.from === myName} />
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-1 pointer-events-auto">
        <button
          type="button"
          aria-label={open ? "Close chat" : "Open chat"}
          title="Chat (Enter)"
          // Keep focus in the input while tapping the button, so blur doesn't fight the toggle.
          onPointerDown={(e) => e.preventDefault()}
          onClick={toggle}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-black/50 text-white hover:bg-black/70 touch-manipulation"
        >
          <MessageSquare size={16} />
        </button>
        {open && (
          <input
            ref={inputRef}
            type="text"
            value={draft}
            maxLength={MAX_CHAT_LENGTH}
            placeholder="Say something to all pirates... (Enter to send, Esc to close)"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="send"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onInputKeyDown}
            onFocus={() => setChatFocused(true)}
            onBlur={() => {
              setChatFocused(false);
              setOpen(false);
            }}
            className="h-8 min-w-0 flex-1 rounded bg-black/70 px-2 text-white placeholder:text-gray-400 outline-none ring-1 ring-white/20 focus:ring-amber-400"
          />
        )}
      </div>
    </div>
  );
}
