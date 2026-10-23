# Build state: auto-sail, global chat, pirate theme (started 2026-10-23)

Goal: three player-requested features, built in parallel, merged into local integration branch `dev/2026-10-23-batch` (not main), tested in a local dev
build. NOT released until the user approves (a push to `main` without `[skip ci]` deploys to production).

| Card | Owner | Branch (worktree) | Status | Next step |
|---|---|---|---|---|
| A. Auto-sail (double-tap W) | subagent `autosail` | `worktree-agent-a739973aad9ca638a` @67565ac | DONE, merged into `dev/2026-10-23-batch` | feel-test in dev build |
| B. Global chat | subagent `chat` | `worktree-agent-a2a99e68d114d733d` @cedd0af | DONE, merged (Player.tsx conflict resolved: autosail uses isTextEntryActive) | try in dev build; add "Enter = chat" to help |
| C. Pirate visual theme (landing + in-game UI) | subagent `theme` | agent worktree | in progress | theme tokens, fonts, restyle |
| F. Live own-ship km-scale snapping (netcode) | subagent `netcode` | agent worktree | investigating | root cause, repro test, fix |
| G. Port/starboard broadsides (Q/E/Space, per-side reload) | subagent `broadsides` | agent worktree (based on dev branch) | in progress | protocol flags, server cooldowns, HUD |
| D. Merge + local dev build | main session | `main` | waiting on A-C | merge, `npm test`, `npm run check`, `npm run dev` |
| E. Apply theme to chat panel | after merge | `main` | not started | restyle `ChatPanel` with card C's classes |

Each agent writes progress notes to `docs/proposals/2026-10-23-<card>-NOTES.md` in its worktree as it goes.

Local dev: Redis in Docker container `ptw-redis` (redis://localhost:6379), `STRIPE_SECRET_KEY=sk_test_dummy`.
Never point local runs at the Upstash URL in `.env`.
| H. World expansion pitch (cities + goods) | main session | n/a | research + pitch page | user decides scope before any build |
