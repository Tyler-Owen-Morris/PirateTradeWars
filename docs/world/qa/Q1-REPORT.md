# Q1 report: browser play-test of the wrapping-Earth world (+ NPCs)

Date 2026-10-16. Agent Q1. Branch `worktree-agent-a36d07bc9afd46740`. The world tests ran on main at fa928da, and the NPC section ran after merging main at 3ed63dc (NPC2).

## How it was run
- **Server:** dev mode on :5601 (`NODE_ENV=development npx tsx server/index.ts`) with local Docker Redis, `STRIPE_SECRET_KEY=sk_test_dummy` and `PTW_DEV_TELEPORT=1`.
- **Browser:** Playwright 1.64.1 (installed with `--no-save`) driving headless Chromium on the **real GPU** (`--use-angle=d3d11 --enable-gpu`, RTX 3060).
  - SwiftShader is not usable for this check: it ran at about 10 fps, and the CPU starvation produced fake netcode snaps of up to 1,250 units.
  - The QA scripts are in `qa/scripts/` (`lib.mjs`, `t1`–`t8b`, `n1`, `n2`).
- **Instrumentation:** dev mode lets the page `import('/src/lib/net/index.ts')`, which is the same `net` singleton the app uses. The scripts:
  - wrap `predictor.reconcile` to log every correction distance
  - run a rAF loop that logs the rendered position and frame time
  - listen to `net.on('splash'|'fire'|'hit')`
- **Teleport:** a QA-only `{t:"devtp",x,z,r,v}` hook in `server/game/socketHandler.tsx`, gated on `PTW_DEV_TELEPORT=1`. It is **uncommitted** and saved as `qa/scripts/devtp.patch`.

## Results per area
| # | Area | Result |
|---|------|--------|
| 1 | Join flow | PASS |
| 2 | Coast collision / cannons at land | PASS with one bug (B1, the slide is too sticky) |
| 3 | Docking / trade | PASS |
| 4 | Navigation UI | PASS (one cosmetic note, B4) |
| 5 | Seam + polar ice | PASS (the ice slide has the same B1 stickiness) |
| 6 | Two clients + bots | PASS |
| 7 | Performance | PASS |
| 8 | Reload / restore | PASS |
| N | NPCs | PARTIAL: pirates don't fight (B2) |

### 1. Join flow: PASS
- Ships spawned at starter ports (Tortuga, Havana, Bridgetown seen), in water (land distance 177–240), facing seaward.
- The town and nation flag are visible on the coast, along with beach, grass, shallows and surf.
- No console errors. The only warnings were Stripe's HTTP warning and a GL ReadPixels warning from the screenshots.
- Screenshot: `t1-spawn.jpg`.

### 2. Coast collision: PASS, with bug B1
- **Head-on (Florida west coast):** the ship stops at exactly land distance 12.0 (the sloop's hull radius) with velocity about 0 and hp unchanged. Reconcile corrections were at most 12 units (one tick), with 0 snaps over 22 s at 59 fps. No jitter. (`t2-headon.jpg`)
- **Glancing, 40° to the coast:** no damage and no corrections, but the ship barely moves (see B1). (`t2-glancing.jpg`)
- **Cannons at land:** 4 broadsides produced 4 `splash {land:1}` events at the coast, and every ball was removed.

### 3. Docking: PASS
- The trade prompt is shown at 200–322 units from the dock and gone by 406. (The polling interval is 250 ms, so the edge is within one sample.)
- Pressing T opens the trading post. Buy Max (20 Fish, 200 gold) and Sell Max both returned `tradeSuccess`.
- At 1,020 units from the dock, raw trade buy, trade sell, repair and upgrade messages were each refused with "Too far from port", and T does nothing. (`t3-trade.jpg`)

### 4. Navigation UI: PASS
- **Compass vs actual motion:**

  | Compass reading | Δz | Δx | Motion |
  |---|---|---|---|
  | 0° | −207 | — | north (stopped by Jamaica) |
  | 87° | — | +381 | east |
  | 187° | +371 | — | south |
  | 265° | — | −376 | west |

- **Lat/lon:** the Port Royal spawn reads `17°47′N 76°45′W`, which matches the computed position (17.776, −76.750).
- **Minimap** matches the 3D coast. (`t4-portroyal.jpg`)
- **World map (M):** the player marker is drawn at the exact `mapWorldToScreen` pixel (colour #4caf50). The map image is aligned with real geography: Havana is on Cuba's north coast and Port Royal on Jamaica's south coast (`t4-worldmap-zoom.jpg`).
- Clicking Havana sets the target and shows "Havana 455 nm · 316° NW", which equals the independent calculation (455.1 nm, 316°).
- Esc closes the map, and M toggles it.

### 5. Seam and ice: PASS
- **Seam:** I placed the ship at x=399,000 near the equator heading east, and parked a second client at x=700 just across the seam.
  - The ship crossed x=0: render x went 399,997.8 → 1.6, the focus shift per frame was ≤ 10.4, and the run had 0 corrections, 0 snaps and 60 fps.
  - The other ship's render position is continuous across the crossing (residual jump 0.01 units per frame).
  - Each client saw the other.
  - The ocean, camera and HUD (`0°30′N 179°58′W`) show no pop. (`t5-seam-after.jpg`)
- **Ice:** at 69.3°N, 5°E heading north, the ship stopped at z=22,234.2, exactly 12 from the ice line (Z_ICE_N 22,222.2), with no damage and 0 corrections.
  - The ice-shelf wall and pack ice render, and the minimap shows the ice as white. (`t5-ice-wall.jpg`)
  - Sliding along the ice at 45° covered only 116 metric units in 6 s (B1).

### 6. Two clients + bots: PASS
- 30 bots (`scripts/bots.ts --url ws://localhost:5601/game-ws`, 150 s) plus 2 browsers near Port Royal.
- **Bots:** all assertions passed (30/30 connected, 20 snapshots/s, worst gap 67 ms, 0 % asymmetric visibility). Server tick averaged 0.4–1.7 ms.
- **Client B watching A sail a circle:** A was visible in 1,003 of 1,004 frames with 0 direction reversals. The interpolated speed was p50 231 u/s (true speed 240), p95 347 and max 575. That spread comes mostly from frame-time noise; I saw no visible stutter.
- Both clients ran at 58.5–58.8 fps with 0 snaps. (`t6-two-clients.jpg`)

### 7. Performance (RTX 3060, headless Chromium, 1024×640)
| Scenario | fps | frames > 50 ms | max frame | corrections > 5 / snaps |
|---|---|---|---|---|
| Port Royal with bots, terrain (17 meshes) | 59.7 | 0 | 33 ms | 0 / 0 |
| Open Atlantic (0 meshes) | 60.0 | 0 | 17 ms | 0 / 0 |
| Sailing west along Cuba, 12 s | 59.9 | 0 | 33 ms | 0 / 0 |
| Lesser Antilles chain, 20 s | 58.5 | 3 | 100 ms | 0 / 0 |
| Bahamas, 20 s | 59.8 | 0 | 33 ms | 0 / 0 |
| Aegean, 20 s (84 chunks / 84 meshes) | 59.9 | 0 | 33 ms | 0 / 0 |
| With NPCs in view (n1, 40 s) | 60.0 | 0 | 17 ms | 0 / 0 |

- `?terrainStats=1` gave 63–84 chunks, 0–84 meshes, queued 0 and `lastUpdateMs` ≤ 0.4 ms while sailing. Terrain is never the bottleneck.
- The only long frames (200–1,000 ms) came right after a **teleport** into unloaded tiles, or at first load. Normal sailing at 240 u/s crosses a 12,500-unit tile only every ~52 s.
- Server tick with NPCs on and 1 player: 0.8–1.0 ms average, 5.1 ms max for the NPC system.

### 8. Reload: PASS
- **Reload within the grace period:** the player is restored at the identical position and heading, with 3/20 cargo and 173 gold. It went straight back into the game with no join screen.
- **After the 60 s grace removal**, which persists the player to Redis, a new page with the same localStorage restored the player from Redis at the identical position, with cargo 2/20 and gold 184.

## NPCs (after the NPC2 merge, 3ed63dc)
| Check | Result |
|---|---|
| NPCs near Caribbean starter ports, nameplate + flag | PASS. At Bridgetown spawn, "Dutch Navy — Man-o'-War" (name "Speedwell") with a blue flag was 116 units away (`n1-npcs-spawn.jpg`). Lane scans found Spanish, French and English merchants, navies, privateers and pirates. |
| Merchants flee when fired on | PASS. Fired-on merchants turn and run straight away (the cos of motion vs the away-from-me direction is 0.95–1.0) for about 5–10 s, then return to their lane, sometimes passing back within about 300 of the shooter. Seen 3 times. Once, a merchant hit to 25/50 hp stopped dead (v=0) about 350 away for at least 9 s; I did not reproduce it (see B3). |
| Pirates attack, break off when hurt | **FAIL (B2).** A provoked pirate never fired and never broke off. |
| NPCs not stuck on coasts | PASS within the sample: 4 tracked NPCs × 40 s, plus about 10 more seen during the lane scans. None made under 20 units of progress in 5 s within 60 of land, and the minimum land distance seen was 24. The sample is small; NPC2's 100-NPC, 3-minute sim test is the stronger evidence. |
| Frame rate with NPCs in view | PASS, 58–60 fps. |
| Console errors | PASS, none. The server log has no errors either. |

## Bugs (ranked)
**B2 (high, NPC gameplay): a provoked pirate orbits a stationary player out of range and never fires or breaks off.**
- **Repro:** run `qa/scripts/n2.mjs pirate`. It finds a full-hp pirate sloop with no navy within 2,500, more than 1,500 from any dock. It provokes the pirate with 2 hits (hp 50→28, later 17), then the player sits still.
- **Actual:** over 45 s the pirate ran a regular loop: distance 1,060 → 375 → 1,060 with a period of about 9 s, at full speed, approaching and leaving almost radially (cos ±0.9–0.99).
  - It fired 0 broadsides and caused 0 hits on me.
  - At 17/50 hp (34 %) it still did not break off.
  - The same thing happened in an earlier run at 8/50 hp, where the pirate passed within 45–108 units and still did not fire.
- **Expected:**
  - It holds a broadside range band (0.4–1.0 × 600) and fires.
  - It disengages when hurt, or keeps fighting if that is the archetype's courage setting. Pirate courage is 0.9, so with `scores()` in brain.ts:104–108 flee stays small unless `shouldDisengage` fires. Check whether "pirates break off" is actually reachable.
- **Suspect:**
  - `server/game/npc/tactics.ts:123–142`, the orbit controller: the hold band is `range * HOLD_*`, gain `RANGE_GAIN`, clamped −π/3..π/2.
  - Against a stationary target, the sloop's turn radius at full speed seems to be comparable to the band, so it overshoots into big in/out loops and is never broadside-on within `FIRE_ARC`.
  - Pacing speed in the band (lines 132–139) may also never engage, because it always sees the range error.
  - NPC2's tactics tests probably use moving targets. Add a sim test of a pirate engaging a stationary sloop, asserting fires within N seconds.
- NPC-vs-NPC fire does happen: a Dutch navy fired at and hit an NPC.

**B1 (medium, feel): sliding along a coast or the ice is about 10× too slow.**
- **Repro:** sail into a coast at 40° (or the ice at 45°) holding W.
- **Expected:** a slide at about cos(angle) × max speed, i.e. ~3.0 units per frame.
- **Actual:** velocity settles at 0.2–0.6 units per frame (ice: 0.32). That is 116 metric units in 6 s instead of about 1,000. The ship feels glued to the coast.
- **Cause:** `shared/physics.ts:198–201`. `velocity *= sqrt(1 − hn²)` runs on every sub-step (180 times a second) while in contact, so it compounds. The equilibrium is `FORWARD_ACCEL·c/(1−c)`, which is 0.49 at c=0.77. The push-out already removes the into-land component of the motion.
- **Suggested fix:** clamp instead of multiplying:
  `if (hn*velocity < 0) velocity = Math.sign(velocity) * Math.min(Math.abs(velocity), stats.maxSpeed * Math.sqrt(1 - hn*hn))`
  Head-on still stops, and the glancing slide is about 3.06.
- I did **not** fix it: the current code follows WORLD_SPEC §4.3 literally ("velocity *= |cos|"), and it changes shared physics on both client and server. This needs a producer decision or spec clarification, plus updated physics tests.

**B3 (low, unconfirmed): a damaged merchant was dead in the water once.**
- After 2 hits (25/50 hp, above SURRENDER_HP 0.3), the merchant fled about 2 s, then sat at v=0 for at least 9 s.
- I saw it once and could not reproduce it in 3 more runs, and I didn't record its land distance. It may be a surrender or a dock state. Check `brain.ts` decide when hpFrac is 0.5.

**B4 (cosmetic):**
- **Minimap label:** "Edge = 600.0 km" is the centre-to-edge radius (`Minimap.tsx:135`, `radius*100/1000`); the minimap actually spans 1,200 km. Rename it to "Radius" or show 2r.
- **Graticule lines:** the minimap's map PNG has baked 15° graticule lines, which show as dark stripes through the minimap.

**B5 (cosmetic, pre-existing): the HUD speed is labelled "knots" but shows raw units per frame** (4.0 at max = 240 u/s). Not a world regression.

**Note (visual):** the sloop model is 40 long, but its hull radius is 12. When a ship is bow-on to a coast, about 8 units of bow overlap the beach. This is worse for big ships: a dreadnought is 130 long with radius 30. It is acceptable, but noticeable in shallow bays.

## Fixes committed
None. Every finding is either a spec-level physics change (B1), NPC tactics (B2), or cosmetic. The QA teleport hook is **not** committed.
