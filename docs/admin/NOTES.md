# Admin dashboard ("Harbour Master") - build notes

Progress log so any agent can resume. Branch: `worktree-agent-a0cb8c4b640d53151` (based on origin/main 92c09a4).
Draft (approved): https://claude.ai/artifact/5aL76y2dNjj9wNXykvkvyw (local source in the PM's scratchpad `admin-draft/project/`).
Rules: commit with `[skip ci]`, never push/merge/deploy, do NOT boot a game server or browser until the PM says so.

## Plan (files)
- `shared/source.ts` - traffic source classifier (utm/ref/referrer) + sanitizer, shared by client and server.
- `server/admin/auth.ts` - scrypt hash format/verify, HMAC session tokens, login rate limiter, client IP from XFF.
- `server/admin/state.ts` - pure: admin player rows (status/where/lat/lon) + action validation/apply.
- `server/admin/stats.ts` - daily counters (Redis hashes, 90 d TTL) + visit limiter.
- `server/admin/routes.ts` - `/api/admin/*` + `/api/visit` (deps injected, testable without Redis/world).
- `scripts/admin-hash.ts` - `npm run admin:hash -- <password>`.
- client: `client/src/admin/*` lazy page at `/admin`; `client/src/lib/source.ts` landing capture + beacon.
- world.ts: small additions (hitAtTick, lastActiveWall, source/campaign/joinedAtWall on WorldPlayer).

## Status
- [ ] server auth  - [ ] state/actions  - [ ] stats/visit  - [ ] routes wiring  - [ ] source capture client
- [ ] admin page  - [ ] tests  - [ ] docs  - [ ] check/build  - [ ] live check (waits for PM)
