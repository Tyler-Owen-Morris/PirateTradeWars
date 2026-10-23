/**
 * ChatPanel: global chat (docs/netcode/PROTOCOL.md "Global chat"). Self-contained; mounted once in
 * GameUI. Styled with the pirate theme: collapsed = fading message slips, open = a "Ship's Log" HudPanel
 * (ledger rows) plus a parchment input.
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
import { HudPanel, Kbd, PirateButton } from "./pirate";

/** A line stays in the collapsed log this long after it arrived (ms)... */
const FADE_AFTER_MS = 10_000;
/** ...and fades out over the last part of that. */
const FADE_DURATION_MS = 2_000;
/** Lines shown while collapsed / open. */
const COLLAPSED_LINES = 5;
const OPEN_LINES = 50;

/** One message slip: a tarred-leather scrap with a brass edge (wax-red for server notices). */
function LineView({ line, self, slip }: { line: ChatLine; self: boolean; slip: boolean }) {
  const base = slip
    ? "w-fit max-w-full rounded-r border-l-[3px] bg-ptw-wood-dark/90 px-2 py-0.5 shadow-[0_1px_3px_rgba(0,0,0,0.5)] [text-shadow:0_1px_1px_rgba(0,0,0,0.9)] "
    : "ptw-ledger__row py-0.5 ";
  if (line.sys)
    return (
      <div className={base + (slip ? "border-ptw-bad/80 " : "") + "font-body italic text-ptw-gold break-words"}>{line.text}</div>
    );
  return (
    <div className={base + (slip ? (self ? "border-ptw-gold " : "border-ptw-brass/70 ") : "") + "font-body text-ptw-cream break-words"}>
      <span className={"font-label tracking-wide " + (self ? "text-ptw-gold" : "text-ptw-brass-hi")}>{line.from}</span>
      <span>: {line.text}</span>
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
    <div className="absolute left-2 bottom-36 sm:left-[16rem] sm:bottom-4 z-[55] w-[min(24rem,calc(100vw-1rem))] sm:w-[min(26rem,calc(100vw-18rem))] pointer-events-none text-[0.8rem] sm:text-base">
      {open ? (
        <HudPanel className="mb-1.5 p-2 pointer-events-auto" data-testid="chat-log">
          <div className="flex items-baseline justify-between gap-2 pb-1 mb-1 border-b border-ptw-brass/40">
            <h3 className="ptw-hud-label text-base text-ptw-brass-hi">Ship&apos;s Log</h3>
            <span className="hidden sm:flex items-center gap-1 text-xs ptw-hud-label">
              <Kbd>Enter</Kbd> send <Kbd>Esc</Kbd> close
            </span>
          </div>
          <div ref={logRef} className="ptw-ledger max-h-28 sm:max-h-48 overflow-y-auto pr-1">
            {shown.length === 0 && <div className="py-1 italic text-ptw-cream/70">No entries yet. Hail the seas!</div>}
            {shown.map((l) => (
              <LineView key={l.key} line={l} self={!l.sys && !!myName && l.from === myName} slip={false} />
            ))}
          </div>
        </HudPanel>
      ) : (
        shown.length > 0 && (
          <div className="mb-1.5 flex flex-col items-start gap-1">
            {shown.map((l) => {
              const age = now - l.receivedAt;
              const fade = Math.max(0, Math.min(1, (FADE_AFTER_MS - age) / FADE_DURATION_MS));
              return (
                <div key={l.key} style={{ opacity: fade }} className="max-w-full">
                  <LineView line={l} self={!l.sys && !!myName && l.from === myName} slip />
                </div>
              );
            })}
          </div>
        )
      )}

      <div className="flex items-center gap-1.5 pointer-events-auto">
        <PirateButton
          variant="porthole"
          size="sm"
          type="button"
          aria-label={open ? "Close chat" : "Open chat"}
          aria-pressed={open}
          title="Chat (Enter)"
          // Keep focus in the input while tapping the button, so blur doesn't fight the toggle.
          onPointerDown={(e) => e.preventDefault()}
          onClick={toggle}
          className="shrink-0 touch-manipulation"
        >
          <MessageSquare size={16} />
        </PirateButton>
        {open && (
          <input
            ref={inputRef}
            type="text"
            value={draft}
            maxLength={MAX_CHAT_LENGTH}
            placeholder="Say something to all pirates..."
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
            className="ptw-input min-h-0 h-9 min-w-0 flex-1 text-base"
          />
        )}
      </div>
    </div>
  );
}
