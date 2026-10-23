# Global chat - progress notes (2026-10-23)

Branch: `worktree-agent-a2a99e68d114d733d` (agent worktree). Not pushed, not merged.

## Plan
1. shared/protocol.ts: `ChatSendMessage` (c->s `{t:"chat", text}`), `ChatMessage` (s->c), `ChatHistoryMessage`,
   `sanitizeChatText`, `parseChatLine`; validated in `parseClientMessage`.
2. server/game/chat.ts: pure `ChatService` (token bucket, profanity mask, repeat collapse, ring buffer 30).
   Wired in socketHandler (message path, not the tick) + `gameState.broadcast` + history on (re)connect.
3. client: `useInputFocus` store (`chatFocused`, `isTextEntryActive()`), `useChat` store, NetClient `chat`
   events, useSocket wiring + `sendChat`, `ChatPanel.tsx`, one mount line in GameUI, Player.tsx neutral keys.
4. Tests (shared parse, server chat service, client netClient chat), bot round-trip, docs.

## Log
- Started. Worktree reset to main e5ddb6e. node_modules is a junction to the main checkout (gitignored).
- tsc baseline in this worktree: 59 `error TS` lines (the CLAUDE.md "~113" counts continuation lines).
- Done 1-4. All plan items implemented.
- Decisions:
  - T does NOT open chat: T is already "trade at port" in GameUI and TradingToast (it would toast
    "too far from port"). Enter only.
  - Focus flag lives in its own store `useInputFocus` (`chatFocused` + `isTextEntryActive()`), separate
    from the chat buffer, so the auto-sail / hotkey code can import it without pulling in chat.
  - Input stops keydown propagation only; keyup propagates so drei sees releases of keys held when
    chat opened (otherwise W would stick after closing chat).
  - No join/leave system lines (would spam with many players/bots); `sys` is used for the throttle
    notice and `ChatService.systemLine()` is available for future broadcasts.
  - Pirate words (bastard, damn, hell, bloody, cock) are not masked; "!" and "|" are not leet-folded.
  - Chat is in-memory only; a deploy/restart clears history.
- Results: `npm test` 39 files / 374 tests pass; `npm run test:bots` (30 bots, local Redis) all assertions
  pass, `CHAT {"heard":30,"audience":30,"spamDelivered":5,"spamNotices":1}`; `npm run check` 59 errors,
  same as baseline, none in touched files; `npm run build` OK.
- Not done / follow-ups: no browser play-test of ChatPanel (no UI automation here); the help overlay in
  GameUI does not list Enter = chat (left GameUI alone for the restyle agent).
