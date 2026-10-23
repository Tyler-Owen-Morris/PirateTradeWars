# Broadsides on both sides (2026-10-23) - progress notes

Branch: `worktree-agent-ac97195eb0cbb5bcb`, based on the local `dev/2026-10-23-batch` (b0b7317). Not pushed.
Status: **done**. Code, tests and docs are committed. Nothing is pending.

## Root cause of "cannons only fire right"
`shared/physics.ts` `spawnBroadside` hard-coded the gun direction `rotationY + π/2`. In the sim's
conventions the heading vector is `(sin r, cos r)`, and negative velocity means forward, so the bow
points along `(-sin r, -cos r)`. With Three.js y up, `r + π/2` gives `(cos r, -sin r)`, which is the ship's
RIGHT (starboard). The server (`World.tryFire`) kept a single `lastFired`/`reloadTime`, so there was
never a port side. NPC tactics knew this: `GUN_SIDES = ["starboard"]`.

## Design
- **Wire input `f`** is a bit set (`shared/physics.ts`):
  - `FIRE_ALL = 1` fires every loaded side. It is the legacy `f:1`, so old cached clients keep working.
  - `FIRE_PORT = 2` (Q) and `FIRE_STARBOARD = 4` (E).
  - `parseClientMessage` uses `fireFlags()`: booleans become 1, numbers are floored and masked to 7, a
    positive value with no known bit becomes 1, and junk becomes 0.
- **Side selection:** `fireSides(f, portReady, starboardReady)`. `broadsideAngle(r, side)` gives port = r − π/2 and starboard = r + π/2.
  `spawnBroadside(ship, n, side = "starboard")` keeps starboard as the default, so the old behaviour is unchanged.
- **Server** (`server/game/world.ts`):
  - Each battery has its own last-fired time (`WorldPlayer.lastFiredPort` / `lastFiredStarboard`), and each reloads in `reloadTime`.
  - `lastFired` is still set to the latest volley, so persistence and NPC aim-slack keep working.
  - When a tick consumes two inputs (catch-up), their fire flags are OR-ed.
  - Every side volley is its own `fire` event, carrying `side`.
  - The snapshot `me` gains `reloadPortMs` and `reloadStarboardMs`. `canFire` means at least one side is loaded. `reloadMs` is the smaller of the two.
- **NPCs** (`server/game/npc/tactics.ts`, `index.ts`):
  - `GUN_SIDES` is now both sides.
  - `chooseSide` has a `SIDE_SWITCH_MARGIN` of 25° of hysteresis. The current side is kept in `ActiveNpc.gunSide`.
  - `engage` takes the reload state per side and uses the chosen side's.
  - `aim` sends `FIRE_PORT` or `FIRE_STARBOARD`, never `FIRE_ALL`. Firing both would shoot the far battery at nothing, and could hit allies.
- **Client:**
  - `App.tsx` keyboard map: `firePort` is KeyQ and `fireStarboard` is KeyE. Q and E were unbound before: the KeyboardControls map had no Q or E, and no keydown listener in `GameUI`, `TradingToast`, `WorldMap` or `sidebar` uses them.
  - `lib/net/controls.ts` maps `fire` to 1, `firePort` to 2 and `fireStarboard` to 4. The new `ControlState` fields are optional, so the touch and HUD sources are untouched.
  - The `FireLatch` class is used by `NetClient.frame`. A tap shorter than one 50 ms step still reaches the server, which makes rhythmic Space tapping reliable.
  - `useSocket` mirrors the per-side reloads into the store player. It forces a UI sync when a side changes ready state. It plays one bang per (eid, tick).
  - `ui/ReloadGauges.tsx` shows the L and R gauges, which fill while reloading and turn green when ready. `HUD.tsx` swaps its old "Cannons Ready/Reloading" block for it.
  - Help text was updated in `HelpTooltip.tsx`, the `GameUI.tsx` H overlay and the `ShipSelection.tsx` combat blurb.
- **Bots** (`scripts/bots.ts`) send fire flags 1, 1, 2 or 4 at random.

## Balance (NPC firepower: 60 s duels, pirate NPC vs a player sloop, 6 seeds, scratch vitest harness)
| NPC ship / player mode | before: hits/min, dmg/min, first hit | after |
|---|---|---|
| sloop still | 14.2, 71, 2.9 s | 14.3, 72, 2.7 s |
| sloop straight (stern chase) | 0.5, 3, 30.1 s | 0.7, 3, 20.2 s |
| sloop circle | 16.8, 84, 4.0 s | 16.7, 83, 3.6 s |
| sloop zigzag | 16.7, 83, 3.6 s | 16.5, 83, 1.8 s |
| brigantine still | 28.8, 231, 2.5 s | 29.7, 237, 1.7 s |
| brigantine straight | 27.2, 217, 8.5 s | 29.2, 233, 3.1 s |
| brigantine circle | 24.5, 196, 3.2 s | 23.8, 191, 2.7 s |
| brigantine zigzag | 20.7, 165, 2.3 s | 21.5, 172, 1.7 s |
| galleon still | 27.8, 306, 2.2 s | 29.5, 325, 1.5 s |
| galleon straight | 36.2, 398, 6.3 s | 38.7, 425, 3.2 s |
| galleon circle | 27.0, 297, 2.9 s | 27.5, 303, 2.8 s |
| galleon zigzag | 22.7, 249, 3.0 s | 23.3, 257, 1.7 s |

- **NPCs:** sustained damage changes by −3 % to +8 %. The first hit comes clearly sooner (up to ~2.7× sooner on a chase), because an NPC no longer has to swing its starboard side round.
- **Players get the bigger buff.** Space now empties BOTH batteries, so a player with the target abeam on one side gets no extra hits. A player who fights with both sides gets up to twice the volleys per reload. That is the intended design.
- **Friendly fire:** `live-world.test` (200 packed players and 153 NPCs) once saw a pirate sunk by an allied pirate's stray ball. The test now counts sunk records instead of assuming none.

## Tests
- `shared/__tests__/broadsides.test.ts`: side geometry at 7 headings (cross product against the actual sailing direction, spawn on the hull side), `fireSides`, and `f:1` back-compat with `fireFlags` clamping.
- `server/game/__tests__/world.test.ts`, "broadsides" describe:
  - legacy `f:1` fires both batteries
  - Q, then Space, fires the other side
  - holding Space alternates as each side reloads
  - holding E fires starboard only
  - catch-up inputs OR their flags
  - existing tests now use `FIRE_STARBOARD` where they meant one ball
- `server/game/npc/__tests__/tactics.test.ts`: port guns, `chooseSide` hysteresis, per-side reload gate.
- `client/src/lib/net/__tests__/broadsides.test.ts`: Q/E/Space mapping, `FireLatch`, and NetClient sending a short tap exactly once.
- Results:
  - `npm test`: 369 pass.
  - `npm run test:bots -- --port 5063`: all assertions pass with 30 bots.
  - `npm run check`: 59 error lines, identical to the baseline.

## Merge notes for the integrator
- **HUD.tsx:** the theme agent restyles this file. My change replaces only the inner "Cannons" status `<div>` with `<ReloadGauges …/>`, plus one import. On conflict, keep their container and drop in `<ReloadGauges reloadPortMs={player.reloadPortMs ?? player.reloadMs} reloadStarboardMs={player.reloadStarboardMs ?? player.reloadMs} reloadTime={player.reloadTime} />`.
- **netClient.ts `frame()`:** the netcode agent also works here. My change is the FireLatch lines around `predictor.advance`.
- **Chat:** keyboard keys still reach drei KeyboardControls while a text input has focus. That means typing "q" or "e" in chat would fire, just as WASD would steer. The chat agent should gate the keyboard source in `Player.tsx`, for example with `textInputFocused()`, which already exists there.
