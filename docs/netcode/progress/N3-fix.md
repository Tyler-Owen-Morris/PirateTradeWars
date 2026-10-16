# N3-fix progress (worktree agent-a2fab96baf13f66b3, branch worktree-agent-a2fab96baf13f66b3)

STATUS: DONE. Commit 30c95d2 on branch worktree-agent-a2fab96baf13f66b3 (not pushed). Ready to merge.

## Root cause #2 (input rate < 20/s at low fps)
- Ship.tsx, Port.tsx, PortCity.tsx, Island.tsx called `clock.getElapsedTime()` inside useFrame.
  THREE.Clock.getElapsedTime() calls getDelta() (three/src/core/Clock.js:33-36), which moves `oldTime`.
  R3F 8.18 computes each frame's delta with `state.clock.getDelta()` at frame start
  (@react-three/fiber/dist/events-*.esm.js:1532). So every frame's delta skipped the useFrame work done
  before the last getElapsedTime call in the previous frame. Player's net.frame(delta) was starved:
  7.7 inputs/s at 9 fps. Hitches over 250 ms can't explain a ~60% deficit; the accumulator logic is correct
  (unit test: 9 fps steady frames for 3 s give 59-60 inputs).
- Reproduced in frameRate.test.ts with a real THREE.Clock and a mocked performance.now:
  fewer than 30 inputs vs 56 or more.

## Changes
- getElapsedTime() replaced with clock.elapsedTime in the 4 components.
- NetClient.frameNow(controls) measures its own wall-clock dt. Player uses it. Un-hiding resets it (dt 0).
- Clamp is now MAX_FRAME_DT_SEC = MAX_STEPS_PER_FRAME * TICK_DT (0.25, same as before).
- Hitch policy: excess time is dropped (unchanged), now documented. The server extrapolates gaps with the last input,
  so replaying the backlog would double-step the ship.
- Camera: client/src/lib/cameraFollow.ts CameraFollow. Exp smoothing k = -60 ln(1 - 0.1) / -60 ln(1 - 0.05).
  Focus error <= 100 u, camera error <= 400 u. Snaps on net `spawned` and on any jump > 500 u
  (wrap-aware). Seam shift is handled. GameScene uses it.
- Docs: client/CLIENT_CONTEXT.md Netcode section.

## Tests
- npm test: 115 passed. New: frameRate.test.ts (6), cameraFollow.test.ts (6).
- npm run build: OK.
- npm run test:bots: all assertions pass.
- tsc: only the pre-existing Ship.tsx:100 Howl.volume error.
