// Re-export shared game constants
export {
  MAP_WIDTH,
  MAP_HEIGHT,
  PORT_INTERACTION_RADIUS,
  SHIP_TYPES,
  SHIP_DISPLAY_NAMES,
  SHIP_DESCRIPTIONS,
  SHIP_STATS,
  GOODS,
  DEFAULT_PORTS
} from '@shared/gameConstants';

// Game mechanics constants
export const CANNON_RANGE = 200;
export const CANNON_SPEED = 15;

// Ship type definition
export type ShipType = 'sloop' | 'brigantine' | 'galleon' | 'man-o-war' | 'dreadnaught';

// Ship dimensions
export const SHIP_DIMENSIONS: Record<ShipType, { length: number; width: number; height: number; mastHeight: number }> = {
  sloop: { length: 40, width: 15, height: 20, mastHeight: 50 },
  brigantine: { length: 60, width: 20, height: 25, mastHeight: 60 },
  galleon: { length: 80, width: 30, height: 30, mastHeight: 70 },
  'man-o-war': { length: 100, width: 40, height: 35, mastHeight: 80 },
  dreadnaught: { length: 130, width: 55, height: 40, mastHeight: 90 }
} as const;

// Ship colors
export const SHIP_COLORS: Record<ShipType, string> = {
  sloop: '#8B4513',
  brigantine: '#A0522D',
  galleon: '#CD853F',
  'man-o-war': '#D2691E',
  dreadnaught: '#8B0000'
} as const;

// Number of masts per ship type
export const SHIP_MAST_COUNTS: Record<ShipType, number> = {
  sloop: 1,
  brigantine: 2,
  galleon: 3,
  'man-o-war': 4,
  dreadnaught: 5
} as const;
