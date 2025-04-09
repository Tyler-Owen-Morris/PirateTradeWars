# Pirate Trade Wars - Game Design Document (Ship Stats)

## Player Ships
Ships are the heart of *Pirate Trade Wars*, defining a player’s trading capacity, combat prowess, and survivability. Stats are designed to balance free-to-play accessibility with premium incentives, while allowing progression through upgrades. Below are the starting ships, their stats, and how those stats integrate into gameplay mechanics.

### Stat Definitions
- **Hull Strength (HP)**: Total health points. When reduced to 0, the ship sinks, losing all cargo and respawning at the nearest port with a gold penalty (10% of current gold, min 50 gold).
- **Armor (%)**: Damage reduction percentage. Incoming damage is reduced by this amount (e.g., 10% armor reduces 10 damage to 9).
- **Cargo Capacity (Units)**: Maximum goods that can be carried (1 unit = 1 stack of any good, e.g., 1 Rum = 1 unit).
- **Speed (Pixels/Frame)**: Movement speed across the map, calculated at 60 FPS. Higher speed means faster travel between ports.
- **Cannons (Count/Damage/Reload)**: 
  - **Count**: Number of cannons firing simultaneously.
  - **Damage**: Damage per shot.
  - **Reload**: Time in seconds between shots (lower is faster).
- **Repair Cost (Gold)**: Base cost to repair a fully damaged ship, scaling with max Hull Strength.

### Starting Ships
#### Free Ship: "The Sloop"
- **Description**: A small, rickety vessel for new pirates. Cheap but vulnerable, it’s a starting point for all free players.
- **Stats**:
  - Hull Strength: 50 HP
  - Armor: 0%
  - Cargo Capacity: 20 units
  - Speed: 5 pixels/frame (300 pixels/second at 60 FPS)
  - Cannons: 1 / 5 damage / 2.0s reload
  - Repair Cost: 100 gold
- **Gameplay Impact**: Slow and fragile, with minimal combat ability. Ideal for short, cautious trade runs near safe ports.

#### Paid Ship Tier 1: "The Brigantine"
- **Description**: A sturdy ship for aspiring captains, offering a balanced upgrade over the free Sloop.
- **Stats**:
  - Hull Strength: 150 HP
  - Armor: 10%
  - Cargo Capacity: 40 units
  - Speed: 6 pixels/frame (360 pixels/second)
  - Cannons: 2 / 8 damage / 1.8s reload
  - Repair Cost: 300 gold
- **Gameplay Impact**: Faster and tougher, with double the cannons for better defense. Suited for longer trade routes and light PvP skirmishes.

#### Paid Ship Tier 2: "The Galleon"
- **Description**: A formidable merchant vessel, blending cargo capacity with combat strength.
- **Stats**:
  - Hull Strength: 300 HP
  - Armor: 20%
  - Cargo Capacity: 60 units
  - Speed: 7 pixels/frame (420 pixels/second)
  - Cannons: 3 / 12 damage / 1.5s reload
  - Repair Cost: 600 gold
- **Gameplay Impact**: A tanky trader that can fend off multiple attackers. High cargo capacity supports profitable runs, though repair costs are steep.

#### Paid Ship Tier 3: "The Man-o’-War"
- **Description**: The ultimate warship, a terror of the seas built for dominance.
- **Stats**:
  - Hull Strength: 500 HP
  - Armor: 30%
  - Cargo Capacity: 80 units
  - Speed: 8 pixels/frame (480 pixels/second)
  - Cannons: 4 / 15 damage / 1.2s reload
  - Repair Cost: 1000 gold
- **Gameplay Impact**: Fast, heavily armored, and lethal. Excels in both trading and PvP, capable of taking on multiple foes or chasing down prey.

### Gameplay Mechanics Driven by Stats
#### Movement
- **Formula**: `Distance Moved = Speed * Frames Elapsed` (at 60 FPS, 1 second = 60 frames).
- **Example**: The Sloop moves 300 pixels in 1 second, while the Man-o’-War moves 480 pixels, making it 60% faster. This affects travel time between ports (e.g., a 1200-pixel trip takes 4s for the Sloop, 2.5s for the Man-o’-War).

#### Combat
- **Damage Calculation**: 
  - Raw Damage = `Cannons * Damage` per volley.
  - Adjusted Damage = `Raw Damage * (1 - Target Armor)` per hit.
  - DPS = `Adjusted Damage / Reload Time`.
- **Example**:
  - Sloop vs. Brigantine: 5 damage * 1 cannon = 5 raw damage; Brigantine’s 10% armor reduces it to 4.5 damage every 2s (2.25 DPS).
  - Man-o’-War vs. Galleon: 15 damage * 4 cannons = 60 raw damage; Galleon’s 20% armor reduces it to 48 damage every 1.2s (40 DPS).
- **Range**: All cannons have a fixed range (e.g., 200 pixels), requiring ships to close distance for combat.

#### Survivability
- **Damage Taken**: `Incoming Damage * (1 - Armor)` reduces Hull Strength.
- **Example**: 50 damage hits the Galleon (20% armor): 50 * 0.8 = 40 HP lost. The Sloop (0% armor) takes the full 50 HP and sinks.
- **Sinking Penalty**: Respawn at nearest port, lose all cargo, pay repair cost.

#### Trading
- **Profit Potential**: Higher Cargo Capacity allows more goods per trip, amplifying earnings. The Man-o’-War’s 80 units vs. the Sloop’s 20 units means 4x the potential profit per run, assuming full loads.

### Balance Notes
- **Free vs. Paid**: The Sloop is viable for cautious play near ports, but paid ships dominate open-sea PvP and long trades. Free players can upgrade to match paid ships over time (see upgrade system in full GDD).
- **Progression**: Stats scale linearly (e.g., Hull Strength triples from Brigantine to Galleon), but costs and risks (repair, PvP losses) scale similarly to keep gameplay fair.
- **PvP Incentive**: Higher-tier ships are tempting targets due to larger cargo holds, encouraging attacks on premium players.