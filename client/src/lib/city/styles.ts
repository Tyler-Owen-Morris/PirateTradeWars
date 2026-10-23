/**
 * City STYLES (one generic look per city type) for the port-city kit. Pure data: the layout
 * (layout.ts) and pieces (pieces.ts) read these fields; nothing here knows about three.js.
 *
 * Which style a port gets: `CITY_CUSTOM[key].style` (cities.ts) if set, else STYLE_BY_NATION by
 * `port.nation` (+ `region` refinements in `styleIdForPort`).
 *
 * ADDING A STYLE (e.g. "russian_timber", "ottoman", "chinese", "japanese", "arctic_trading_post"):
 *  1. Add an entry to STYLES below (copy the closest one; every field is documented on CityStyle).
 *  2. If it needs a new silhouette, add a RoofKind / LandmarkKind / FortKind / HouseKind case in
 *     pieces.ts (each is one small function) — e.g. "onion" domes, "tiered" pagoda roofs (already in),
 *     "minaret" landmarks, "log" houses.
 *  3. Map ports to it: a region rule in `styleIdForPort`, or `style` in cities.ts for single ports.
 *  The kit unit test (lib/city/__tests__/city.test.ts) builds every style for every port's site, so
 *  a new style is covered automatically once a port uses it.
 */

export type RoofKind = "gable" | "hip" | "flat" | "tiered" | "shed" | "stepgable" | "bellgable";
export type HouseKind = "house" | "shack" | "canal";
export type LandmarkKind =
  | "bell_tower" // Spanish/Portuguese church: nave + square bell tower with open belfry and cap
  | "twin_towers" // cathedral facade with two towers (Saint-Pierre, Cádiz)
  | "steeple" // English/colonial church: tower + tall spire
  | "gothic_tower" // square tower with corner pinnacles (Bristol, Saint-Malo)
  | "dome" // big dome on a drum with lantern (St Paul's, Cádiz cathedral, Goa)
  | "windmill"
  | "pagoda" // tiered roofs (future East Asian styles)
  | "chapel" // small timber chapel (pirate havens, trading posts)
  | "none";
export type FortKind =
  | "star" // bastioned trace (4–5 arrowhead bastions) — Spanish/Dutch
  | "bastion" // smaller battery with two bastions (English, French)
  | "castle" // high walls + corner towers + keep (Portuguese, medieval)
  | "morro" // stepped triangular headland fortress + lighthouse (El Morro)
  | "palisade" // timber stockade + earth battery (pirates, trading posts)
  | "none";
export type TreeKind = "palm" | "broadleaf" | "conifer" | "mixed";

export interface CityStyle {
  id: string;
  label: string;
  /** House body kind: normal houses, ramshackle shacks, or narrow tall canal houses. */
  house: HouseKind;
  /** Wall colours (picked per house) and trim/shutter colours. */
  walls: string[];
  trim: string[];
  /** Foundation / plinth colour (stone, brick or timber piles). */
  plinth: string;
  /** Roof colours and roof shapes with weights. */
  roofs: string[];
  roofKinds: Partial<Record<RoofKind, number>>;
  /** Roof rise / half-depth (0.5 ≈ 27°, 1 ≈ 45°). */
  pitch: number;
  /** Eave overhang (metric units). */
  eaves: number;
  /** House footprint ranges [min, max] (width along the street, depth), floors, storey height. */
  houseW: [number, number];
  houseD: [number, number];
  floors: [number, number];
  floorH: number;
  /** Probability a house has a chimney; window colour; whether windows get coloured shutters. */
  chimneys: number;
  window: string;
  shutters: boolean;
  /** Town layout: lot pitch along the street, streets every N lots, jitter (0 = grid, 1 = chaos), fill 0..1. */
  lot: number;
  streetEvery: number;
  irregularity: number;
  density: number;
  /** Town radius (metric units) and house cap before per-city `size`. */
  radius: number;
  maxHouses: number;
  /** Waterfront: warehouses (count), their colours, piers. */
  warehouses: number;
  warehouseWalls: string[];
  warehouseRoofs: string[];
  piers: number;
  /** Small boats moored at the piers / ships at anchor offshore. */
  boats: number;
  shipsAtAnchor: number;
  /** Main landmark (on the plaza) and its colours. */
  landmark: LandmarkKind;
  landmarkWall: string;
  landmarkRoof: string;
  /** Fort at the harbour mouth. */
  fort: FortKind;
  fortStone: string;
  /** Ramparts around the town (Cartagena, Saint-Malo). */
  cityWalls: boolean;
  /** Tree kind ("auto" by latitude: palms < 26°, conifers > 47°, broadleaf otherwise) and count. */
  trees: TreeKind | "auto";
  treeCount: number;
  /** Extra pieces placed by the layout (see pieces.ts EXTRA_PIECES): e.g. windmills, gallows. */
  extras: ExtraRef[];
}

/** An extra piece: registry name + where to put it + count. */
export interface ExtraRef {
  piece: string;
  /** "outskirts" (edge of town), "highpoint" (highest ground), "coast" (beside the quay, on land),
   *  "water" (offshore), "plaza" (next to the landmark), "mouth" (the far side from the fort). */
  where: "outskirts" | "highpoint" | "coast" | "water" | "plaza" | "mouth";
  count?: number;
  /** Size multiplier. */
  scale?: number;
}

const SPANISH: CityStyle = {
  id: "spanish_colonial",
  label: "Spanish colonial",
  house: "house",
  walls: ["#f2ead8", "#ead7a8", "#e9c98a", "#f4e3c4", "#dfb886", "#f0e0d0", "#d8c2a0"],
  trim: ["#5a3a22", "#2f5a7a", "#6b2a1e"],
  plinth: "#b9a68a",
  roofs: ["#b4522e", "#a8482a", "#c0643a", "#9a4428"],
  roofKinds: { hip: 0.45, gable: 0.25, flat: 0.3 },
  pitch: 0.42,
  eaves: 0.9,
  houseW: [10, 16],
  houseD: [9, 13],
  floors: [1, 2],
  floorH: 5.2,
  chimneys: 0,
  window: "#3a2a1e",
  shutters: true,
  lot: 15,
  streetEvery: 3,
  irregularity: 0.12,
  density: 0.82,
  radius: 210,
  maxHouses: 85,
  warehouses: 3,
  warehouseWalls: ["#e3d2ae", "#d6c094"],
  warehouseRoofs: ["#a8482a"],
  piers: 2,
  boats: 3,
  shipsAtAnchor: 1,
  landmark: "bell_tower",
  landmarkWall: "#f3ecdc",
  landmarkRoof: "#b4522e",
  fort: "star",
  fortStone: "#c9b48a",
  cityWalls: false,
  trees: "auto",
  treeCount: 40,
  extras: [],
};

const ENGLISH: CityStyle = {
  id: "english",
  label: "English / North Atlantic",
  house: "house",
  walls: ["#9a4b35", "#a65a40", "#8c4430", "#d9d2c0", "#c9c2b0", "#b25e45", "#ece6d6"],
  trim: ["#f2efe6", "#2d3a4a"],
  plinth: "#6e6458",
  roofs: ["#4a4f58", "#565b63", "#3f444c", "#5d5048"],
  roofKinds: { gable: 0.75, hip: 0.25 },
  pitch: 0.85,
  eaves: 0.5,
  houseW: [8, 12],
  houseD: [8, 11],
  floors: [2, 3],
  floorH: 4.6,
  chimneys: 0.85,
  window: "#26303a",
  shutters: false,
  lot: 12.5,
  streetEvery: 4,
  irregularity: 0.1,
  density: 0.85,
  radius: 220,
  maxHouses: 95,
  warehouses: 4,
  warehouseWalls: ["#8c4430", "#7d3f2e", "#9a5a40"],
  warehouseRoofs: ["#4a4f58"],
  piers: 3,
  boats: 3,
  shipsAtAnchor: 1,
  landmark: "steeple",
  landmarkWall: "#d8d2c2",
  landmarkRoof: "#4a4f58",
  fort: "bastion",
  fortStone: "#9c9182",
  cityWalls: false,
  trees: "auto",
  treeCount: 35,
  extras: [],
};

const DUTCH: CityStyle = {
  id: "dutch",
  label: "Dutch",
  house: "canal",
  walls: ["#8a4430", "#9d5236", "#7a3a2a", "#b0653f", "#6a4234", "#d8ccb0", "#c9a27a", "#e6dcc6"],
  trim: ["#f0ece0", "#2f4a3a"],
  plinth: "#5a5048",
  roofs: ["#3e3a38", "#7a3a26", "#4a3a34"],
  roofKinds: { stepgable: 0.6, bellgable: 0.4 },
  pitch: 1.2,
  eaves: 0.2,
  houseW: [6.5, 8.5],
  houseD: [11, 15],
  floors: [2, 3],
  floorH: 4.3,
  chimneys: 0.5,
  window: "#1f2830",
  shutters: false,
  lot: 8.5,
  streetEvery: 6,
  irregularity: 0.03,
  density: 0.92,
  radius: 200,
  maxHouses: 120,
  warehouses: 5,
  warehouseWalls: ["#6a3226", "#7a3a2a"],
  warehouseRoofs: ["#3e3a38"],
  piers: 3,
  boats: 4,
  shipsAtAnchor: 1,
  landmark: "gothic_tower",
  landmarkWall: "#8d4532",
  landmarkRoof: "#2f6a5a",
  fort: "star",
  fortStone: "#7a6a58",
  cityWalls: false,
  trees: "auto",
  treeCount: 25,
  extras: [{ piece: "windmill", where: "outskirts", count: 2 }],
};

const FRENCH: CityStyle = {
  id: "french",
  label: "French",
  house: "house",
  walls: ["#d8cdb6", "#c9bca2", "#e4dccb", "#b8ab92", "#efe6d2"],
  trim: ["#3c5a78", "#e8e2d4", "#5a6a4a"],
  plinth: "#7c7468",
  roofs: ["#3f4652", "#4a515c", "#a65a3a"],
  roofKinds: { hip: 0.5, gable: 0.5 },
  pitch: 1.0,
  eaves: 0.4,
  houseW: [9, 13],
  houseD: [9, 12],
  floors: [2, 3],
  floorH: 4.8,
  chimneys: 0.75,
  window: "#29323c",
  shutters: true,
  lot: 13,
  streetEvery: 3,
  irregularity: 0.12,
  density: 0.85,
  radius: 190,
  maxHouses: 80,
  warehouses: 3,
  warehouseWalls: ["#bfb39a", "#a8a08c"],
  warehouseRoofs: ["#3f4652"],
  piers: 2,
  boats: 3,
  shipsAtAnchor: 1,
  landmark: "twin_towers",
  landmarkWall: "#d2c8b2",
  landmarkRoof: "#3f4652",
  fort: "bastion",
  fortStone: "#9a9080",
  cityWalls: false,
  trees: "auto",
  treeCount: 30,
  extras: [],
};

const PORTUGUESE: CityStyle = {
  id: "portuguese",
  label: "Portuguese",
  house: "house",
  walls: ["#f6f3ea", "#f2ecdc", "#f0d58a", "#f7f5ef", "#e8c27a", "#f4efe2"],
  trim: ["#2b5aa0", "#d9a032", "#2b5aa0", "#7a3a22"],
  plinth: "#c9b48e",
  roofs: ["#c0603a", "#b4522e", "#cc6c42"],
  roofKinds: { hip: 0.55, gable: 0.45 },
  pitch: 0.45,
  eaves: 0.8,
  houseW: [9, 14],
  houseD: [8, 12],
  floors: [2, 3],
  floorH: 4.8,
  chimneys: 0.15,
  window: "#2a2420",
  shutters: true,
  lot: 13,
  streetEvery: 3,
  irregularity: 0.18,
  density: 0.85,
  radius: 210,
  maxHouses: 90,
  warehouses: 3,
  warehouseWalls: ["#efe8d8", "#e4d6b8"],
  warehouseRoofs: ["#b4522e"],
  piers: 2,
  boats: 3,
  shipsAtAnchor: 1,
  landmark: "bell_tower",
  landmarkWall: "#f7f4ec",
  landmarkRoof: "#c0603a",
  fort: "castle",
  fortStone: "#e8e0cc",
  cityWalls: false,
  trees: "auto",
  treeCount: 35,
  extras: [],
};

const PIRATE: CityStyle = {
  id: "pirate_haven",
  label: "Pirate haven",
  house: "shack",
  walls: ["#7a5a3a", "#6a4c30", "#8a6a44", "#5c4430", "#9a7a50"],
  trim: ["#3a2a1c"],
  plinth: "#4a3a2a",
  roofs: ["#8a7a52", "#6e5a3a", "#9a8a5e", "#5a4a32"],
  roofKinds: { shed: 0.5, gable: 0.5 },
  pitch: 0.6,
  eaves: 0.9,
  houseW: [6, 10],
  houseD: [5, 8],
  floors: [1, 1],
  floorH: 4.2,
  chimneys: 0,
  window: "#1c140e",
  shutters: false,
  lot: 13,
  streetEvery: 2,
  irregularity: 0.7,
  density: 0.6,
  radius: 170,
  maxHouses: 50,
  warehouses: 2,
  warehouseWalls: ["#6a4c30"],
  warehouseRoofs: ["#6e5a3a"],
  piers: 2,
  boats: 3,
  shipsAtAnchor: 3,
  landmark: "chapel",
  landmarkWall: "#7a5a3a",
  landmarkRoof: "#5a4a32",
  fort: "palisade",
  fortStone: "#6a5034",
  cityWalls: false,
  trees: "auto",
  treeCount: 55,
  extras: [
    { piece: "gallows", where: "coast" },
    { piece: "careened_ship", where: "coast" },
  ],
};

/**
 * East Asian treaty-port mix (Macau, Manila touches): stucco blocks with tiered tile roofs. Not a
 * default for any nation yet; ports opt in via cities.ts or future "chinese"/"japanese" styles.
 */
const EAST_ASIAN: CityStyle = {
  ...PORTUGUESE,
  id: "east_asian",
  label: "East Asian",
  walls: ["#e8dcc4", "#d8c8a8", "#c8b08a", "#efe4cc", "#b8a080"],
  trim: ["#8a2a1e", "#2a3a2a"],
  roofs: ["#4a4a48", "#5a5450", "#3a3e44"],
  roofKinds: { tiered: 0.35, hip: 0.65 },
  pitch: 0.6,
  eaves: 1.4,
  landmark: "pagoda",
  landmarkWall: "#b8402e",
  landmarkRoof: "#3a3e44",
  trees: "broadleaf",
};

export const STYLES: Record<string, CityStyle> = {
  spanish_colonial: SPANISH,
  english: ENGLISH,
  dutch: DUTCH,
  french: FRENCH,
  portuguese: PORTUGUESE,
  pirate_haven: PIRATE,
  east_asian: EAST_ASIAN,
};

export const STYLE_BY_NATION: Record<string, string> = {
  spain: "spanish_colonial",
  england: "english",
  netherlands: "dutch",
  france: "french",
  portugal: "portuguese",
  pirates: "pirate_haven",
};

/** Style id for a port: explicit override, else by nation (fallback English). */
export function styleIdForPort(nation: string | undefined, _region: string | undefined, override?: string): string {
  if (override && STYLES[override]) return override;
  return STYLE_BY_NATION[nation ?? ""] ?? "english";
}
