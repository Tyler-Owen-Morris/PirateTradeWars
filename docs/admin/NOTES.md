# Admin dashboard ("Harbour Master") - build notes

Progress log so any agent can resume. Branch: `worktree-agent-a0cb8c4b640d53151` (based on origin/main 92c09a4).
Draft (approved): https://claude.ai/artifact/5aL76y2dNjj9wNXykvkvyw (local source in the PM's scratchpad `admin-draft/project/`).
Rules: commit with `[skip ci]`, never push/merge/deploy, do NOT boot a game server or browser until the PM says so.
The feature doc is `README.md` next to this file.

## Status: READY FOR LIVE CHECK (2026-10-25)

- [x] server auth (`server/admin/auth.ts`)  - [x] state/actions (`state.ts`, `live.ts`)
- [x] stats/visit (`stats.ts`, `counters.ts`, redisStorage `incrDailyStat`/`getDailyStat`)  - [x] routes wiring (`routes.ts`, routes.tsx, index.ts logger)
- [x] source capture client (`client/src/lib/source.ts`, useSocket, protocol `source`/`campaign`)
- [x] admin page (`client/src/admin/`, lazy from main.tsx; App is lazy too)  - [x] `npm run admin:hash`
- [x] tests: 61 files / 737 tests pass (`npm test`); 8 new files under server/admin, shared, client/src/admin
- [x] `npm run check`: same error set as the 56-line baseline (no new errors)  - [x] `npm run build` passes;
      AdminPage chunk 16 kB JS + 7 kB CSS, imports only the index chunk (no three.js)
- [x] docs: README.md, SERVER_CONTEXT, CLIENT_CONTEXT, PROTOCOL §4, CLAUDE.md, PROJECT_CONTEXT
- [~] live check (2026-10-25, stopped early: owner said ship). Server :5160 on Redis DB 12 with a TEST hash, one
      Playwright browser; server stopped and DB 12 flushed afterwards. Verified live, no bugs found:
      `?utm_source=tiktok&utm_campaign=Trailer1` -> sessionStorage TikTok/trailer1 -> connect -> tiles "New captains 1,
      From social 1 (TikTok 1), 100% (1 of 1 link clicks)", row "Came from TikTok · trailer1", status In port / Havana;
      wrong password -> "Wrong password. 4 tries left..."; right password -> dashboard; gold +100/+1,000/+10,000/custom
      2,500 and 200,000 (confirm dialog; dismiss = no change), bad custom "12abc" refused inline; upgrade x4
      Sloop -> Dreadnaught, then "Already a Dreadnaught" (disabled). The player's own HUD showed every gold / hull /
      ship change within ~1.5 s. Screenshots `01-signin.png` ... `04-after-actions.png`.
      NOT verified live (unit/route tests only): repair full / +25% on a damaged ship, filters, pin click, hidden-tab
      pause, phone width, sign out, the 5-try lockout. (Script in the PM scratchpad `pw/admin-live.mjs` covers them; it
      stopped at the reconnect step because the game reconnects on its own and never shows `#playerName`; a test-script
      issue, not an app bug.)

## Decisions made while building
- Status signals: combat = fired (`firedAtTick`) or hit (new `hitAtTick`) in the last 15 s; idle = no NON-neutral
  input for 60 s (new `lastActiveWall`; the client sends neutral inputs at 20 Hz, so "any input" would never idle).
- Only connected, afloat humans are listed (ships in the 60 s disconnect grace are not).
- "Captains online" sub-line shows the NPC population (`npcRecords`, ~214, as in the draft); hover shows the active count.
- No `upgradeSuccess` sent to the player on an admin upgrade (the trade screen would treat it as its own refit reply);
  the snapshot `me` already carries everything.
- Client IP: own XFF parsing with 2 trusted hops in production (ALB + nginx), env-overridable; Express `trust proxy`
  left unset so nothing else changes.
- Login tries are charged before scrypt; max 2 concurrent verifications (16 MB each).
- Day boundary: America/Los_Angeles (Theo's PC is on Pacific time), `ADMIN_TZ` overrides.
- Noticed, not changed: `POST /api/update-prices` is unauthenticated (pre-existing; only re-runs the market update).

## Live check plan (only after the PM says go)
1. Docker Redis `ptw-redis` on a PRIVATE DB: `REDIS_CONN_STRING=redis://localhost:6379/12` (never the Upstash URL in `.env`).
2. `npm run admin:hash -- 'test password'` -> hash; any 64-hex secret.
3. `NODE_ENV=development STRIPE_SECRET_KEY=sk_test_dummy PORT=5160 ADMIN_PASSWORD_HASH=... ADMIN_SESSION_SECRET=... npx tsx server/index.ts`
4. A few bots (`scripts/run-bot-test.ts` / `scripts/bots.ts` against :5160) or a browser player with `?utm_source=tiktok`.
5. `/admin`: sign in (and a wrong password), every action (repair full, +25%, gold presets + custom, upgrade x4 to
   Dreadnaught), filters, pin select, sign out; check the player's HUD updates; Playwright screenshots to `docs/admin/`
   (desktop + phone width).
