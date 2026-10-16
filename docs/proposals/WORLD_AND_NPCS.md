# Proposal: a real globe and NPC ships

Status: **proposal, awaiting Theo's decisions** (2026-10-16). Nothing is built yet.
The research came from three agents: one mapping the current code, one on globe and land approaches, and one on NPC AI.
The build ledger is `docs/netcode/BUILD_STATE.md`.

## 1. Why the map jumps today

The world is a 10000×10000 torus (`shared/gameConstants.ts:2-3`). Ships and cannonballs are drawn relative to your own ship, so they wrap correctly. Everything else is drawn at its raw coordinates:
- ports and islands (`Port.tsx:67-75`)
- gold (`GameScene.tsx:117-124`)
- the fixed 30000² ocean plane (`Ocean.tsx`)

When you cross the edge, your ship and the camera move 10000 units in one frame. The far side's islands and ports only appear once you're across, and the wave pattern shifts.

The server doesn't know land exists: there's no collision, and spawns can land on islands. Ships are also faster than they look. Speed is measured per 1/60 s frame, so speeds of 4–9 mean 240–540 units/s, and a ship crosses the whole world in 20–40 s. That's why it feels small and the seam comes up so often.

## 2. The world: a globe you can sail around

### Recommendation: an east–west wrapping world with sphere-correct movement and polar ice

| Option | Feels like a globe | Real continents | Risk to netcode | Verdict |
|---|---|---|---|---|
| A. True 3D sphere (position as a unit vector) | Yes, exact | Yes | **High**: rewrite of physics, protocol and prediction; the compass drifts on a "straight" course | Keep in reserve |
| B. Fix the torus rendering only | No (the Arctic joins Antarctica) | No | None | Do it now as step W0 |
| **C+. Cylinder with sphere metric** | **Yes, in play** | **Yes** | **Low**: state stays `{x,z,rot,v}` | **Recommended** |

How C+ works:
- `x` is longitude and wraps all the way round. `z` is latitude, blocked by pack ice at ±70°.
- Movement is `dz = v·cosθ`, `dx = v·sinθ / cos(lat)`. That is exact sphere motion along a constant compass heading, which is how age-of-sail navigators actually sailed.
- Sail east forever and you come back to where you started, with no seam.
- The world map is simply the equirectangular texture.
- Civilization and other strategy games use this cylinder model. The `1/cos(lat)` term is what makes the continents the right size.

### Scale (adjustable)

C = 720,000 units round the equator (2000 units per degree):

| Trip | Time at average speed |
|---|---|
| Round the world (equator) | ~36 min (dreadnought 22, sloop 50) |
| Lisbon to the Caribbean | ~5.5 min |
| Across the Caribbean | ~2.5 min |

**Trade-off:** the world becomes about 5000× bigger than today, so players will be spread thin. Spawns, ports and NPCs should cluster in the Caribbean and North Atlantic first. Alternatively, a smaller C (about 400k) halves the times.

### Land masses: the real world's continents, not just islands

The map is **the real Earth's geography**: the Americas, Europe, Africa and Asia as full continents with their real coastlines, plus the real islands (the Caribbean chain, the Azores, the British Isles and so on). Today's hand-placed `.glb` decoration islands go away.

- **Source data:** Natural Earth land polygons (public domain). Use 1:10m detail in the Caribbean and European waters, where small islands and inlets matter, and 1:50m elsewhere.
- **Offline build step:** a Node script rasterizes the land into one world-sized **signed distance field**: for every point, how far it is to the nearest coast, negative on land.
  - **Size:** 8192×4096 at Int8 is about 32 MB in server memory, which fits easily in the 2 GB.
  - **Optional detail:** if coastlines look too coarse at sailing height (about 88 units per pixel at the 720k scale), add a higher-resolution overlay just for the Caribbean.
  - **Delivery:** it is cut into 256² tiles that the client loads as you sail, with a version hash so client and server always use the same land.
- **Rendering:**
  - a land mesh for each visible chunk, raised from the distance field: beaches at the waterline, then grass, forest and rock inland, with low hills; mountains can come later from elevation data
  - shallow-water tint and surf foam along every coast
- **Ports** are coastal cities at real historical sites on the continents and islands, each with a harbour you sail into. The docking zone is the water just off the town.
  - **Caribbean and Americas:** Port Royal, Havana, Cartagena, Veracruz, Nassau, Tortuga, Bridgetown, Boston, Charleston
  - **Europe and Africa:** Lisbon, Cádiz, Seville, London, Bristol, Amsterdam, Cape Town
  - **Indian Ocean and Asia:** Goa, Batavia, Macau
  - **Starting set:** about 15–25 ports, seeded around the Caribbean and Atlantic first.

### Land collision: you bump, you don't break

**Ships collide with land. Collision does no damage.**

- **Where it lives:** in the shared physics (`stepShip`), so the server and your own client compute the same result and there's no rubber-banding at the coast. After each physics substep, the ship's position is checked against the distance field.
- **What happens on contact:**
  1. The ship is pushed back out to the shoreline.
  2. The part of its velocity heading into the land is removed, so it **slides along the coast** instead of sticking. The slide direction comes from the field's gradient.
  3. A head-on hit leaves the ship nearly stopped. A glancing hit lets it keep most of its speed.
- **Hull size:** the check uses the ship's hull radius, so big ships can't squeeze through gaps that only a sloop can pass. Narrow straits and harbour mouths therefore matter tactically.
- **Cannonballs** that hit land stop there, with a dust or splash effect, so islands and headlands give cover.
- **Spawning and respawning** always pick open water.
- **NPCs** use the same collision, and their steering looks ahead along the coastline so they avoid running aground.
- **Cost:** one bilinear lookup per ship per substep, which is negligible on the server.

### Seamless rendering (floating origin)

Every object is drawn at its position relative to the camera, and the ocean follows the camera. This removes the jump.

It is also required at the larger scale. At 720k units, raw coordinates make float32 vertices visibly jitter.

### Navigation

- **World map (M key):** the land texture with your marker, ports, and the regions you've discovered. Optionally, a spinning 3D globe using the same texture.
- **Minimap:** a north-up crop around your ship, scaled correctly for latitude.
- **Compass:** heading in degrees and a lat/lon readout, e.g. `17°56′N 76°50′W`. Select a port to see its distance and bearing.

## 3. NPC ships

### How they plug in

An NPC is an ordinary ship in the server's `World`: same entity id space, grid, physics, cannons and snapshot rows. An AI controller writes the **same thrust, rudder and fire inputs a player sends**, so NPCs get exactly the same turning circle and speed as players.

Clients need no new netcode. The `ent` message gains optional `npc`, `faction` and `title` fields, for example "Spanish Navy", which are used for flags and nameplates.

Code that currently assumes every ship is a player needs guards:
- firing requires a connection (`world.ts:578`)
- the disconnect timer, which would remove an NPC
- the Redis leaderboard writes when a ship sinks

### Keeping it cheap: simulation tiers

| Tier | When | Cost per NPC |
|---|---|---|
| Active | A player within 2500 units | Full physics and steering at 20 Hz; decisions at 4 Hz, staggered across ticks |
| On rails | No player near | Moves along its route once per 0.5 s; no physics |
| Docked | In port | A departure timer only |

- **Budget:** 300 persistent NPCs worldwide, with at most 60–80 active at once. That's about 1 ms per tick (the tick budget is 50 ms).
- **Density:** at most 8 NPCs in any one player's view, which keeps bandwidth flat.
- **Persistent fleet:** a 0.2 Hz "director" keeps each region's fleet topped up. It respawns sunk NPCs out of sight after 2–5 minutes, so trade lanes and patrols stay coherent.

### Brains: a state machine with scored transitions

States: `Travel`, `Patrol`, `Engage`, `Pursue`, `Flee`, `Loot`, `Surrender` (merchants only). Each 4 Hz decision scores the options from hp, relative firepower, threat, and the archetype's aggression and courage. Hysteresis stops the ships flip-flopping between states.

Steering uses standard Reynolds behaviours (seek, flee, intercept, evade, wander, arrive) plus coastline feelers that read the land distance field.

Broadside tactics:
- close to 60–85% of cannon range and turn to put the target beside the ship
- lead the target before firing; per-archetype aim error is the difficulty knob
- open the range while reloading
- break off when hurt or outgunned

| Archetype | Ship | Aggression / courage | Behaviour |
|---|---|---|---|
| Merchant | sloop / brigantine | 0.05 / 0.2 | Trades port to port in convoys of 1–3; flees, and surrenders cargo at low hp |
| Navy patrol | frigate / man-o-war | 0.6 / 0.9 | Patrols home waters, hunts players with bounties, defends allied merchants |
| Pirate raider | sloop / brig | 0.8 / 0.5 | Hunts merchants and weak players in lawless waters; breaks off when outgunned |
| Privateer | brig / frigate | 0.6 / 0.6 | Attacks enemies of its nation, and you if its nation's enemies like you |

### The threat system (groundwork for factions; factions themselves come later)

- **Per-NPC threat table** (up to 8 entries):
  - being hit adds damage × 2
  - being near adds hostility × time
  - entries decay 5% a second
  - a new target needs a 10% lead before the NPC switches to it, as in WoW
- **One hook decides hostility:** `baseHostility(npc, other)`. It reads a faction relation matrix (−100 to 100) and the player's reputation per faction.
  - **Phase 1:** a single "lawful vs pirate" relation.
  - **Later:** Spain, Portugal, England and others with reputations. Attacking an ally then raises threat for everyone allied within 1500 units ("call for help"), so "Spain likes you, so Portugal attacks you" emerges with no new AI code.
- **Fair-play rules:**
  - NPCs ignore new players for their first 10 minutes unless provoked
  - at most 2 NPCs attack one player at a time
  - hostile NPCs prefer targets of a similar ship class
  - no fighting inside port safe zones
  - NPC loot is capped per hour so farming can't beat trading
  - NPC kills don't count toward player-kill stats

## 4. Build plan (cards)

| Card | What | Depends on | Deployable alone? |
|---|---|---|---|
| **W0** | Seamless wrap on today's map: floating origin, ports and gold at wrapped offsets, ocean follows the camera. Client only. | — | Yes; quick win |
| W1 | Coordinate model: x wraps, z clamped at the ice, `1/cos(lat)` motion, sparse spatial grid, scale constants; tests and bots | W0 | With W2 |
| W2 | Real-world land and collision: Natural Earth continents and islands → distance field, tiles and map texture; **no-damage land collision with sliding** in shared physics; cannonballs stop on land; spawns at sea | W1 | With W1 |
| W3 | Continent and coast rendering (beaches, inland terrain, surf), ice wall, optional horizon drop | W2 | Yes |
| W4 | Coastal ports at real historical cities, with harbours, plus migrating the existing Redis port data and player positions | W2 | Yes |
| W5 | Navigation: world map, minimap, compass, lat/lon | W1 | Yes |
| N-A | NPC plumbing: controller field, guards, `ent` fields, one wandering NPC, steering tests | — (can start now) | Yes |
| N-B | Merchants and tiers: routes, rails, director; NPC load test in CI | N-A, W4 | Yes |
| N-C | Combat AI: broadsides, threat table, flee and surrender, pirates | N-B | Yes |
| N-D | Factions v1: relation matrix, rep in Redis, navy and privateers, fair-play rules | N-C | Yes |

**Parallel tracks:** W0 and N-A can start immediately, side by side. W1 and W2 are the core change (opus).

**Migration risk:** the world's coordinates change, so existing saved player positions get re-placed at a home port on first login under W4.

## 5. Decisions needed from Theo

1. **Approve C+** (wrapping cylinder with sphere-correct motion and real Earth), rather than a full 3D sphere.
2. **Scale:** 720k units (≈36-minute circumnavigation, sparse world), or about 400k (≈20 minutes, denser).
3. **Playable area at launch:** the whole globe, with spawns and ports concentrated in the Caribbean and Atlantic, or start with the Caribbean and Atlantic only and fence the rest until later.
4. **Ship W0 to production on its own** as soon as it's ready (it fixes the jump on today's map)?
