# Build state: auto-sail, global chat, pirate theme (started 2026-10-23)

Goal: three player-requested features, built in parallel, merged into local integration branch `dev/2026-10-23-batch` (not main), tested in a local dev
build. RELEASED to production 2026-10-23 (main fc9c918, deploy run 40029362322) on the owner's go-ahead.

| Card | Owner | Branch (worktree) | Status | Next step |
|---|---|---|---|---|
| A. Auto-sail (double-tap W) | subagent `autosail` | `worktree-agent-a739973aad9ca638a` @67565ac | DONE, merged into `dev/2026-10-23-batch` | feel-test in dev build |
| B. Global chat | subagent `chat` | `worktree-agent-a2a99e68d114d733d` @cedd0af | DONE, merged (Player.tsx conflict resolved: autosail uses isTextEntryActive) | try in dev build; add "Enter = chat" to help |
| C. Pirate visual theme (landing + in-game UI) | subagent `theme` | `worktree-agent-a9c1ee7e030ab19ea` @be8aba4 | DONE, merged (GameUI/HUD/HelpTooltip conflicts resolved) | TradeMenu excluded (card I) |
| F. Live own-ship km-scale snapping (netcode) | subagent `netcode` | `worktree-agent-ad19e3e3e2b2b5b20` @0044501 | SHIPPED to production 2026-10-23 (main b1121fe, deploy run 40009771476) | verify live with `?netdebug=1` |
| G. Port/starboard broadsides (Q/E/Space, per-side reload) | subagent `broadsides` | `worktree-agent-ac97195eb0cbb5bcb` @71b4013 | DONE, merged (docs/tests/bots conflicts resolved; starved-queue test fires one side) | feel-test in dev build |
| D. Merge + local dev build | main session | `dev/2026-10-23-batch`, dev server :5000 running | A,B,C,F,G merged | merge, `npm test`, `npm run check`, `npm run dev` |
| E. Theme ChatPanel, AutoSailIndicator, ReloadGauges + Enter=chat help | subagent `overlays` (sonnet) | `worktree-agent-ac1bc1b909bd7fc56` @3694d63 | DONE, merged | - |
| H. World expansion (cities + goods) | main session | pitch: https://claude.ai/artifact/UxuDRnMyjZBURp46ydXm5u | Phase 1 DONE, merged (6603623; 43 ports, 13 goods, 185 NPCs). Phase 2 "North of everything" STARTED 2026-10-24: subagent `horizons-p2` (opus, worktree agent branch from dev @2c48d61), notes in `docs/world/expansion-phase2/NOTES.md` | review + merge Phase 2; Phase 3 later |
| I. Trade screen redesign + style guide ("grounded in the world") | subagent `trade-design` | `worktree-agent-a493ec90cfbfb8a69` @efb5c7f | DONE, merged; 463 tests + bots pass | owner tests at :5000; handwritten bill of sale merged (7abf9d7); follow-ups: CC0 sounds, anchor ship while trading, lint rules, leaderboard/game-over restyle, auth on POST /api/update-prices |
| J. Port city 3D models (style kit + per-city tweaks) | subagent `cities` | `worktree-agent-a66e927ba30cbb679` @96c9aee | DONE, merged | owner review in dev; follow-ups: tiny-islet ports (Nassau etc.), Dutch canals |
| K. Kid-safe chat (library filter, drop tiers, PII/links, mutes, name check) | subagent `chat-safety` | `worktree-agent-a6ec272c6816ed76b` @193e7d0 | DONE, released (main 2c1fd9a, run 40032613343) | watch `[chat] dropped` log volume |
| L. Dismissable in-port trade prompt (auto-hide + x) | subagent `trade-prompt` (sonnet) | `worktree-agent-a09c3d51e17342b06` @3d54b76 | DONE, released with K (main 2c1fd9a) | - |
| M. Social trailer (16:9 ~45s + 9:16 ~30s) | subagent `trailer-prep` (sonnet, worktree from dev) | prep only: storyboard, deterministic capture script, ffmpeg pipeline, CC0 music; notes `docs/trailer/NOTES.md` | PREP DONE, squash-merged (pipeline self-test OK; capture untested live) | record after Phase 2 merges (main session; one server at a time for memory) |

Each agent writes progress notes to `docs/proposals/2026-10-23-<card>-NOTES.md` in its worktree as it goes.

Local dev: Redis in Docker container `ptw-redis` (redis://localhost:6379), `STRIPE_SECRET_KEY=sk_test_dummy`.
Never point local runs at the Upstash URL in `.env`.
