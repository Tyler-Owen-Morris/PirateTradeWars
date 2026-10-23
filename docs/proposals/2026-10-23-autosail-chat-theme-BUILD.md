# Build state: auto-sail, global chat, pirate theme (started 2026-10-23)

Goal: three player-requested features, built in parallel, merged to `main` locally, tested in a local dev
build. NOT released until the user approves (a push to `main` without `[skip ci]` deploys to production).

| Card | Owner | Branch (worktree) | Status | Next step |
|---|---|---|---|---|
| A. Auto-sail (double-tap W) | subagent `autosail` | agent worktree | in progress | implement + tests |
| B. Global chat | subagent `chat` | agent worktree | in progress | protocol + server + client panel |
| C. Pirate visual theme (landing + in-game UI) | subagent `theme` | agent worktree | in progress | theme tokens, fonts, restyle |
| F. Live own-ship km-scale snapping (netcode) | subagent `netcode` | agent worktree | investigating | root cause, repro test, fix |
| D. Merge + local dev build | main session | `main` | waiting on A-C | merge, `npm test`, `npm run check`, `npm run dev` |
| E. Apply theme to chat panel | after merge | `main` | not started | restyle `ChatPanel` with card C's classes |

Each agent writes progress notes to `docs/proposals/2026-10-23-<card>-NOTES.md` in its worktree as it goes.

Local dev: Redis in Docker container `ptw-redis` (redis://localhost:6379), `STRIPE_SECRET_KEY=sk_test_dummy`.
Never point local runs at the Upstash URL in `.env`.
