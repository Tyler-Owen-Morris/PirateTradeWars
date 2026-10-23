# Port cities upgrade — progress notes (2026-10-23)

Branch: `worktree-agent-a66e927ba30cbb679` (based on `dev/2026-10-23-batch`). Kit: `client/src/lib/city/`
(README there). Component: `client/src/components/game/PortCity.tsx`.

## How to resume
1. `PORT=5089 REDIS_CONN_STRING=redis://localhost:6379 STRIPE_SECRET_KEY=sk_test_dummy npm run dev`
2. Open `http://localhost:5089/?citydebug=1`, join, then in the console `__cityCam("havana", {dist: 380, height: 110})`.
3. Stats for all ports without a browser: `CITY_REPORT=1 npx vitest run client/src/lib/city`.
4. Per-city tweaks live in `client/src/lib/city/cities.ts`; mark the city done below.

## Status
- [x] Kit: mesh builder, styles, pieces, layout, shader placement, LOD/caching, dev camera.
- [ ] City-by-city pass (see table).

| Port | Style | Status | Notes |
|---|---|---|---|
