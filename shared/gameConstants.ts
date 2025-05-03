// World-related constants
export const MAP_WIDTH = 10000;
export const MAP_HEIGHT = 10000;
export const PORT_INTERACTION_RADIUS = 200;

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
    MAN_O_WAR: "man-o-war"
};

// Ship display names
export const SHIP_DISPLAY_NAMES = {
    [SHIP_TYPES.SLOOP]: "The Sloop",
    [SHIP_TYPES.BRIGANTINE]: "The Brigantine",
    [SHIP_TYPES.GALLEON]: "The Galleon",
    [SHIP_TYPES.MAN_O_WAR]: "The Man-o'-War"
};

// Ship descriptions
export const SHIP_DESCRIPTIONS = {
    [SHIP_TYPES.SLOOP]: "A small, rickety vessel for new pirates. Cheap but vulnerable, it's a starting point for all free players.",
    [SHIP_TYPES.BRIGANTINE]: "A sturdy ship for aspiring captains, offering a balanced upgrade over the free Sloop.",
    [SHIP_TYPES.GALLEON]: "A formidable merchant vessel, blending cargo capacity with combat strength.",
    [SHIP_TYPES.MAN_O_WAR]: "The ultimate warship, a terror of the seas built for dominance."
};

// Ship stats
export const SHIP_STATS = {
    [SHIP_TYPES.SLOOP]: {
        hullStrength: 50,
        armor: 5,
        cargoCapacity: 20,
        speed: 6,
        cannonCount: 1,
        cannonDamage: 5,
        cannonReload: 2.0,
        cannonRange: 300,
        repairCost: 100,
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
        playerTTL: 1 * 60 * 60  // 1 hour in seconds
    },
    [SHIP_TYPES.GALLEON]: {
        hullStrength: 300,
        armor: 15,
        cargoCapacity: 60,
        speed: 4,
        cannonCount: 3,
        cannonDamage: 12,
        cannonReload: 1.5,
        cannonRange: 200,
        repairCost: 600,
        isPaid: true,
        playerTTL: 4 * 60 * 60  // 4 hours in seconds
    },
    [SHIP_TYPES.MAN_O_WAR]: {
        hullStrength: 500,
        armor: 20,
        cargoCapacity: 80,
        speed: 3.5,
        cannonCount: 4,
        cannonDamage: 15,
        cannonReload: 1.2,
        cannonRange: 150,
        repairCost: 1000,
        isPaid: true,
        playerTTL: 24 * 60 * 60  // 24 hours in seconds
    }
};

// Game goods
export const GOODS = [
    { id: 1, name: "Fish", basePrice: 10, fluctuation: 20 },
    { id: 2, name: "Wood", basePrice: 15, fluctuation: 10 },
    { id: 3, name: "Sugar", basePrice: 30, fluctuation: 25 },
    { id: 4, name: "Cotton", basePrice: 40, fluctuation: 20 },
    { id: 5, name: "Rum", basePrice: 50, fluctuation: 30 },
    { id: 6, name: "Tobacco", basePrice: 60, fluctuation: 35 },
    { id: 7, name: "Spices", basePrice: 80, fluctuation: 40 },
    { id: 8, name: "Silk", basePrice: 100, fluctuation: 50 }
];

// Default ports (fallback)
export const DEFAULT_PORTS = [
    { id: 1, name: "Tortuga", x: 1000, y: 0, z: 1200, safeRadius: 200 },
    { id: 2, name: "Port Royale", x: 4000, y: 0, z: 300, safeRadius: 200 },
    { id: 3, name: "Nassau", x: 2500, y: 0, z: 4500, safeRadius: 200 },
    { id: 4, name: "Havana", x: 4200, y: 0, z: 4000, safeRadius: 200 },
    { id: 5, name: "Kingston", x: 800, y: 0, z: 3500, safeRadius: 200 },
    { id: 6, name: "Santo Domingo", x: 2800, y: 0, z: 1500, safeRadius: 200 },
    { id: 7, name: "Barbados", x: 1500, y: 0, z: 2500, safeRadius: 200 },
    { id: 8, name: "Puerto Rico", x: 3500, y: 0, z: 2800, safeRadius: 200 },
    { id: 9, name: "Bermuda", x: 6000, y: 0, z: 1000, safeRadius: 200 },
    { id: 10, name: "Martinique", x: 5500, y: 0, z: 3500, safeRadius: 200 },
    { id: 11, name: "St. Lucia", x: 3500, y: 0, z: 5500, safeRadius: 200 },
    { id: 12, name: "St. Vincent", x: 2200, y: 0, z: 6800, safeRadius: 200 },
    { id: 13, name: "St. Martin", x: 6500, y: 0, z: 2000, safeRadius: 200 },
    { id: 14, name: "St. Thomas", x: 9000, y: 0, z: 5500, safeRadius: 200 }
]; 