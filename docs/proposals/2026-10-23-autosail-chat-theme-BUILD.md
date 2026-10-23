# Build state: auto-sail, global chat, pirate theme (started 2026-10-23)

Goal: three player-requested features, built in parallel, merged into local integration branch `dev/2026-10-23-batch` (not main), tested in a local dev
build. NOT released until the user approves (a push to `main` without `[skip ci]` deploys to production).

| Card | Owner | Branch (worktree) | Status | Next step |
|---|---|---|---|---|
| A. Auto-sail (double-tap W) | subagent `autosail` | `worktree-agent-a739973aad9ca638a` @67565ac | DONE, merged into `dev/2026-10-23-batch` | feel-test in dev build |
| B. Global chat | subagent `chat` | `worktree-agent-a2a99e68d114d733d` @cedd0af | DONE, merged (Player.tsx conflict resolved: autosail uses isTextEntryActive) | try in dev build; add "Enter = chat" to help |
| C. Pirate visual theme (landing + in-game UI) | subagent `theme` | `worktree-agent-a9c1ee7e030ab19ea` @be8aba4 | DONE, merged (GameUI/HUD/HelpTooltip conflicts resolved) | TradeMenu excluded (card I) |
| F. Live own-ship km-scale snapping (netcode) | subagent `netcode` | `worktree-agent-ad19e3e3e2b2b5b20` @0044501 | SHIPPED to production 2026-10-23 (main b1121fe, deploy run 40009771476) | verify live with `?netdebug=1` |
| G. Port/starboard broadsides (Q/E/Space, per-side reload) | subagent `broadsides` | `worktree-agent-ac97195eb0cbb5bcb` @71b4013 | DONE, merged (docs/tests/bots conflicts resolved; starved-queue test fires one side) | feel-test in dev build |
| D. Merge + local dev build | main session | `dev/2026-10-23-batch`, dev server :5000 running | A,B,C,F,G merged | merge, `npm test`, `npm run check`, `npm run dev` |
| E. Theme ChatPanel, AutoSailIndicator, ReloadGauges + Enter=chat help | subagent `overlays` (sonnet) | `worktree-agent-ac1bc1b909bd7fc56` @3694d63 | DONE, merged | - |
| H. World expansion (cities + goods) | main session | pitch: https://claude.ai/artifact/UxuDRnMyjZBURp46ydXm5u | APPROVED (all recommendations), BLOCKED on card I | build Phase 1 after trade screen redesign |
| I. Trade screen redesign + style guide ("grounded in the world") | subagent `trade-design` | `worktree-agent-a493ec90cfbfb8a69` @efb5c7f | DONE, merged; 463 tests + bots pass | owner tests at :5000; follow-ups: CC0 sounds, anchor ship while trading, lint rules, leaderboard/game-over restyle, auth on POST /api/update-prices |
| J. Port city 3D models (style kit + per-city tweaks) | subagent `cities` | `worktree-agent-a66e927ba30cbb679` @96c9aee | DONE, merged | owner review in dev; follow-ups: tiny-islet ports (Nassau etc.), Dutch canals |

Each agent writes progress notes to `docs/proposals/2026-10-23-<card>-NOTES.md` in its worktree as it goes.

Local dev: Redis in Docker container `ptw-redis` (redis://localhost:6379), `STRIPE_SECRET_KEY=sk_test_dummy`.
Never point local runs at the Upstash URL in `.env`.
