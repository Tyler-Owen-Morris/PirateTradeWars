import { WORLD_C, WORLD_H } from "./world/geo";

// World-related constants (wrapping Earth, docs/world/WORLD_SPEC.md §2). x wraps in [0, MAP_WIDTH);
// z in [0, MAP_HEIGHT] does NOT wrap (polar ice). Gameplay distances use metricDistSq (world/geo.ts).
export const MAP_WIDTH = WORLD_C;
export const MAP_HEIGHT = WORLD_H;
/** Trade/upgrade/repair allowed within this METRIC distance of a port's dock (WORLD_SPEC §5). */
export const PORT_INTERACTION_RADIUS = 300;

// Minimap constants
export const MINIMAP_SIZE = 200; // Size in pixels
export const MINIMAP_RADIUS = 1850; // View radius on the game map
export const MINIMAP_PLAYER_DOT_SIZE = 6;
export const MINIMAP_PORT_DOT_SIZE = 8;
export const MINIMAP_OTHER_PLAYER_DOT_SIZE = 4;

// Ship types
export const SHIP_TYPES = {
    SLOOP: "sloop",
    BRIGANTINE: "brigantine",
    GALLEON: "galleon",
    MAN_O_WAR: "man-o-war",
    DREADNAUGHT: "dreadnaught"
};

// Ship display names
export const SHIP_DISPLAY_NAMES = {
    [SHIP_TYPES.SLOOP]: "The Sloop",
    [SHIP_TYPES.BRIGANTINE]: "The Brigantine",
    [SHIP_TYPES.GALLEON]: "The Galleon",
    [SHIP_TYPES.MAN_O_WAR]: "The Man-o'-War",
    [SHIP_TYPES.DREADNAUGHT]: "The Dreadnaught"
};

// Ship descriptions
export const SHIP_DESCRIPTIONS = {
    [SHIP_TYPES.SLOOP]: "A small, rickety vessel for new pirates.It's a starting point for all free players.",
    [SHIP_TYPES.BRIGANTINE]: "A sturdy ship for aspiring captains, offering a balanced upgrade over the free Sloop.",
    [SHIP_TYPES.GALLEON]: "A formidable merchant vessel, blending cargo capacity with combat strength.",
    [SHIP_TYPES.MAN_O_WAR]: "The ultimate warship, a terror of the seas built for dominance.",
    [SHIP_TYPES.DREADNAUGHT]: "The ultimate warship, a terror of the seas built for dominance."
};

// Ship stats
export const SHIP_STATS = {
    [SHIP_TYPES.SLOOP]: {
        hullStrength: 50,
        armor: 5,
        cargoCapacity: 20,
        speed: 4,
        cannonCount: 1,
        cannonDamage: 5,
        cannonReload: 2.0,
        cannonRange: 300,
        repairCost: 100,
        startingGold: 200,
        isPaid: false,
        playerTTL: 1 * 15 * 60  // 15 minutes in seconds
    },
    [SHIP_TYPES.BRIGANTINE]: {
        hullStrength: 150,
        armor: 10,
        cargoCapacity: 40,
        speed: 5,
        cannonCount: 2,
        cannonDamage: 8,
        cannonReload: 1.8,
        cannonRange: 250,
        repairCost: 300,
        isPaid: true,
        startingGold: 500,
        playerTTL: 2 * 60 * 60  // 2 hours in seconds
    },
    [SHIP_TYPES.GALLEON]: {
        hullStrength: 300,
        armor: 15,
        cargoCapacity: 60,
        speed: 5.5,
        cannonCount: 3,
        cannonDamage: 12,
        cannonReload: 1.5,
        cannonRange: 200,
        repairCost: 600,
        isPaid: true,
        startingGold: 800,
        playerTTL: 4 * 60 * 60  // 4 hours in seconds
    },
    [SHIP_TYPES.MAN_O_WAR]: {
        hullStrength: 500,
        armor: 20,
        cargoCapacity: 80,
        speed: 7,
        cannonCount: 4,
        cannonDamage: 15,
        cannonReload: 1.2,
        cannonRange: 150,
        repairCost: 1000,
        isPaid: true,
        startingGold: 1000,
        playerTTL: 24 * 60 * 60  // 24 hours in seconds
    },
    [SHIP_TYPES.DREADNAUGHT]: {
        hullStrength: 800,
        armor: 30,
        cargoCapacity: 100,
        speed: 9,
        cannonCount: 5,
        cannonDamage: 20,
        cannonReload: 1.0,
        cannonRange: 200,
        repairCost: 2000,
        isPaid: true,
        startingGold: 2000,
        playerTTL: 48 * 60 * 60  // 48 hours in seconds
    }
};

export const SHIP_UPGRADE_PATH = [
    { from: SHIP_TYPES.SLOOP, to: SHIP_TYPES.BRIGANTINE, cost: 5000 },
    { from: SHIP_TYPES.BRIGANTINE, to: SHIP_TYPES.GALLEON, cost: 9000 },
    { from: SHIP_TYPES.GALLEON, to: SHIP_TYPES.MAN_O_WAR, cost: 12000 },
    { from: SHIP_TYPES.MAN_O_WAR, to: SHIP_TYPES.DREADNAUGHT, cost: 15000 }
];

export const SHIP_PRICES = {
    [SHIP_TYPES.BRIGANTINE]: 50,
    [SHIP_TYPES.GALLEON]: 100,
    [SHIP_TYPES.MAN_O_WAR]: 200,
    //[SHIP_TYPES.DREADNAUGHT]: 400 // not actually purchasable, just a placeholder to prevent possible errors
};

// Game goods. `group` drives the trade screen's sections (in GOOD_GROUPS order); a good with a missing or
// unknown group lands in the last section, so the world-expansion goods slot in by data alone.
export type GoodGroup = "staples" | "colonial" | "luxuries" | "specie" | "northern";
export const GOOD_GROUPS: readonly { id: GoodGroup; label: string; note: string }[] = [
    { id: "staples", label: "Staples", note: "bulk, cheap, everywhere" },
    { id: "colonial", label: "Colonial", note: "grown in the colonies and the wine islands" },
    { id: "luxuries", label: "Luxuries", note: "dear, light, from afar" },
    { id: "specie", label: "Specie", note: "silver and gold, in bars and coin" },
    { id: "northern", label: "Northern", note: "from the cold seas" },
];
export interface GoodDef { id: number; name: string; basePrice: number; fluctuation: number; group?: GoodGroup }
export const GOODS: GoodDef[] = [
    { id: 1, name: "Fish", basePrice: 10, fluctuation: 20, group: "staples" },
    { id: 2, name: "Wood", basePrice: 15, fluctuation: 10, group: "staples" },
    { id: 3, name: "Sugar", basePrice: 30, fluctuation: 25, group: "colonial" },
    { id: 4, name: "Cotton", basePrice: 40, fluctuation: 20, group: "staples" },
    { id: 5, name: "Rum", basePrice: 50, fluctuation: 30, group: "colonial" },
    { id: 6, name: "Tobacco", basePrice: 60, fluctuation: 35, group: "colonial" },
    { id: 7, name: "Spices", basePrice: 80, fluctuation: 40, group: "luxuries" },
    { id: 8, name: "Silk", basePrice: 100, fluctuation: 50, group: "luxuries" },
    // New Horizons phase 1 (2026-10-23). APPEND ONLY, NEVER renumber: player inventories and port goods rows
    // are keyed by goodId. The server seeds any id missing from Redis at boot (server/game/ports.ts seedGoods).
    // Where each is cheap / wanted / on sale: shared/world/goodMarkets.ts GOOD_MARKETS.
    { id: 9, name: "Silver", basePrice: 140, fluctuation: 25, group: "specie" },
    { id: 10, name: "Gold", basePrice: 180, fluctuation: 25, group: "specie" },
    { id: 11, name: "Cacao", basePrice: 55, fluctuation: 30, group: "colonial" },
    { id: 12, name: "Hides", basePrice: 25, fluctuation: 20, group: "colonial" },
    { id: 13, name: "Wine", basePrice: 45, fluctuation: 25, group: "colonial" },
];

// Ports live in shared/world/ports.ts (PORTS, generated ports.json; card W4). The old DEFAULT_PORTS
// (14 made-up torus ports) were removed. 