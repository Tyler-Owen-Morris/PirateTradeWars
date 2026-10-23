/**
 * Per-city MINOR customisation for the port-city kit (README.md). Keyed by the port's string id
 * (`port.key`, = shared/world/ports.json `id`). Every field is optional except `note`:
 *  - `style`: use another style than the nation default (styles.ts STYLES key);
 *  - `size`: multiplies the town radius and house cap (1 = style default);
 *  - `tweak`: shallow overrides of style fields (colours, landmark, fort kind, extras…);
 *  - `fortSide`: which way along the coast the harbour fort goes (+1 / −1; default = the more
 *    seaward side); `fortWhere: "highpoint"` puts it on the highest ground instead; `fortScale`;
 *  - `landmarkScale`: size of the main landmark;
 *  - `extras`: extra pieces (pieces.ts EXTRA_PIECES) added to the style's extras;
 *  - `note`: what the tweak represents (keep it honest and short).
 * A port without an entry gets its style's generic town.
 */
import type { CityStyle, ExtraRef } from "./styles";

export interface CityCustom {
  style?: string;
  size?: number;
  tweak?: Partial<CityStyle>;
  fortSide?: 1 | -1;
  fortWhere?: "mouth" | "highpoint";
  fortScale?: number;
  /** Size multiplier for the main landmark. */
  landmarkScale?: number;
  extras?: ExtraRef[];
  note: string;
}

export const CITY_CUSTOM: Record<string, CityCustom> = {
  // --- Caribbean -------------------------------------------------------------------------------
  port_royal: {
    size: 0.95,
    tweak: { trees: "palm", walls: ["#9a4b35", "#a65a40", "#e8e0cc", "#d9cdb0", "#b25e45"], landmark: "steeple" },
    fortScale: 1.1,
    extras: [{ piece: "ship", where: "water", count: 1 }],
    note: "Brick and whitewash on the sandspit; Fort Charles (bastion battery) guarding the harbour.",
  },
  havana: {
    size: 1.2,
    tweak: { fort: "morro", landmark: "bell_tower" },
    fortScale: 1.25,
    extras: [{ piece: "fort_star", where: "coast", scale: 0.7 }],
    note: "El Morro (stepped fortress + lighthouse) at the harbour mouth; La Fuerza star fort on the quay; baroque cathedral.",
  },
  cartagena: {
    size: 1.1,
    tweak: { cityWalls: true },
    fortWhere: "highpoint",
    fortScale: 1.2,
    note: "Las Murallas ramparts round the town; San Felipe de Barajas fortress on the hill.",
  },
  veracruz: {
    tweak: { fort: "star", roofKinds: { flat: 0.55, hip: 0.3, gable: 0.15 } },
    fortScale: 1.15,
    note: "Flat-roofed town; San Juan de Ulúa star fort at the harbour.",
  },
  nassau: {
    size: 1.05,
    tweak: { shipsAtAnchor: 4 },
    extras: [{ piece: "fort_bastion", where: "highpoint", scale: 0.8 }],
    note: "The Republic of Pirates: shacks, gallows, careening beach and four pirate ships at anchor; Fort Nassau above.",
  },
  tortuga: {
    size: 0.9,
    fortWhere: "highpoint",
    tweak: { fort: "bastion", fortStone: "#8a7a62" },
    note: "Buccaneer shacks below Fort de Rocher on the hillside.",
  },
  bridgetown: {
    size: 0.9,
    tweak: { walls: ["#e8e0cc", "#d9c7a3", "#f0e6d2", "#9a4b35", "#c9e0d8"], trees: "palm" },
    extras: [{ piece: "lighthouse", where: "mouth" }],
    note: "Pastel and coral-stone houses round the Careenage; St Ann's battery and a harbour light.",
  },
  san_juan: {
    tweak: { fort: "morro", cityWalls: true, walls: ["#f2e6c8", "#e8c27a", "#a8d0c8", "#f0b8a0", "#d8e0f0", "#f4e3c4"] },
    fortScale: 1.15,
    note: "El Morro at the bay mouth, city walls and colourful houses.",
  },
  willemstad: {
    size: 0.9,
    tweak: {
      walls: ["#e8a040", "#d8586a", "#5a9ad0", "#f0d060", "#7ac0a0", "#f0ece0", "#e07040"],
      trees: "palm",
      extras: [],
    },
    note: "Handelskade: pastel Dutch gabled fronts on the waterfront; Fort Amsterdam; palms instead of windmills.",
  },
  saint_pierre: {
    tweak: { trees: "palm", walls: ["#e0d4bc", "#d0c0a0", "#efe6d2", "#c9b090"], roofs: ["#a65a3a", "#b4643a", "#3f4652"] },
    note: "Stone houses with tile roofs, twin-towered cathedral, Fort Saint-Pierre battery.",
  },

  // --- North Atlantic --------------------------------------------------------------------------
  charleston: {
    tweak: { walls: ["#f0c8c0", "#c8e0d0", "#f0e0a0", "#c8d8f0", "#f4f0e6", "#e8b8a0"], roofs: ["#5a5d63", "#7a4a3a"] },
    note: "Rainbow Row pastels; St Michael's white steeple.",
  },
  boston: {
    size: 1.1,
    tweak: { trees: "mixed" },
    extras: [{ piece: "ship", where: "water" }],
    note: "Brick and clapboard, Old North Church steeple, a merchantman in the roads.",
  },

  // --- Europe ----------------------------------------------------------------------------------
  lisbon: {
    size: 1.25,
    tweak: { fort: "none" },
    extras: [{ piece: "belem_tower", where: "mouth" }, { piece: "fort_castle", where: "highpoint", scale: 0.8 }],
    note: "Whitewash and terracotta on the hills; Belém Tower guards the river mouth; São Jorge castle on the height.",
  },
  cadiz: {
    tweak: { roofKinds: { flat: 0.75, hip: 0.25 }, landmark: "dome", landmarkRoof: "#c9a640", walls: ["#f6f3ea", "#f2ecdc", "#efe6d2"] },
    note: "White flat-roofed sea city with the golden-domed cathedral.",
  },
  seville: {
    size: 1.1,
    tweak: { fort: "none", roofKinds: { hip: 0.5, flat: 0.5 } },
    landmarkScale: 1.5,
    extras: [{ piece: "round_tower", where: "coast" }],
    note: "Torre del Oro on the Guadalquivir; the Giralda bell tower over the cathedral (no sea fort, it's a river port).",
  },
  london: {
    size: 1.35,
    tweak: { landmark: "dome", landmarkWall: "#ddd6c4", landmarkRoof: "#6a7070", fort: "none", warehouses: 6, piers: 3 },
    extras: [{ piece: "keep", where: "coast" }],
    note: "St Paul's dome over brick streets; the Tower (keep) by the river; a long row of warehouses.",
  },
  bristol: {
    tweak: { landmark: "gothic_tower", fort: "none", warehouses: 5 },
    extras: [{ piece: "ship", where: "water" }],
    note: "Brick warehouses on the quay, the cathedral's gothic tower; a merchantman ('shipshape and Bristol fashion').",
  },
  amsterdam: {
    size: 1.3,
    tweak: { fort: "none", extras: [{ piece: "windmill", where: "outskirts", count: 4 }] },
    note: "Canal houses with step and bell gables, Westerkerk tower, windmills on the edge of town.",
  },
  saint_malo: {
    tweak: { cityWalls: true, fortStone: "#8a8478", walls: ["#a8a090", "#b8b0a0", "#9a9284", "#c8c0b0"], landmark: "gothic_tower" },
    note: "Granite corsair town inside its ramparts; cathedral spire; Fort National battery.",
  },

  // --- Africa / Indian Ocean / East Asia / Pacific ---------------------------------------------
  elmina: {
    style: "portuguese",
    size: 0.75,
    tweak: { trees: "palm", landmark: "chapel", landmarkWall: "#f0ece2" },
    fortScale: 1.5,
    extras: [{ piece: "fort_bastion", where: "highpoint", scale: 0.7 }],
    note: "São Jorge da Mina: the great white castle on the point (Dutch-held now); Fort Coenraadsburg on the hill.",
  },
  cape_town: {
    tweak: {
      walls: ["#f4f1ea", "#efe8d8", "#f6f3ea"],
      roofs: ["#5a5048", "#6a5a48"],
      roofKinds: { bellgable: 1 },
      house: "house",
      houseW: [10, 14],
      floors: [1, 2],
      extras: [{ piece: "windmill", where: "outskirts", count: 1 }],
    },
    fortScale: 1.2,
    note: "Whitewashed Cape Dutch houses with curved gables; the Castle of Good Hope (star fort). Table Mountain is terrain.",
  },
  sainte_marie: {
    size: 0.75,
    tweak: { shipsAtAnchor: 3 },
    note: "Île Sainte-Marie pirate base: stockade, huts, careened ship, ships at anchor.",
  },
  goa: {
    tweak: { trees: "palm" },
    extras: [{ piece: "basilica_facade", where: "plaza", scale: 0.9 }, { piece: "lighthouse", where: "mouth" }],
    note: "Whitewashed churches in the palms; the laterite Bom Jesus basilica front; Aguada fort with its light.",
  },
  batavia: {
    tweak: {
      trees: "palm",
      walls: ["#efe8d8", "#e6dcc6", "#d8ccb0", "#b0653f", "#c9a27a", "#f4efe2"],
      roofs: ["#a8482a", "#8a4430", "#7a3a26"],
      extras: [{ piece: "windmill", where: "outskirts", count: 1 }],
    },
    fortScale: 1.2,
    note: "Dutch canal town in the tropics (plastered fronts, tile roofs); the Kasteel (star fort) on the waterfront.",
  },
  macau: {
    tweak: { roofKinds: { hip: 0.6, tiered: 0.4 }, walls: ["#f0d58a", "#f6f3ea", "#e8c27a", "#f2a88a", "#efe4cc"] },
    extras: [{ piece: "facade", where: "highpoint" }, { piece: "lighthouse", where: "mouth" }, { piece: "pagoda", where: "outskirts", scale: 0.6 }],
    note: "Ruins of São Paulo (facade on its stair) on the hill, Guia light, a temple pagoda; Portuguese town with Chinese roofs.",
  },
  manila: {
    tweak: { cityWalls: true, trees: "palm", roofKinds: { hip: 0.7, tiered: 0.3 } },
    note: "Intramuros: walled Spanish city with Fort Santiago; some tiered roofs.",
  },
  acapulco: {
    size: 0.85,
    tweak: { trees: "palm" },
    fortScale: 1.2,
    extras: [{ piece: "ship", where: "water", scale: 1.2 }],
    note: "Fort San Diego (star fort) over the bay; the Manila galleon at anchor.",
  },

  // --- New Horizons phase 1 (2026-10-23): the Americas, both coasts --------------------------------
  // South Atlantic
  salvador: {
    size: 1.15,
    tweak: { trees: "palm" },
    extras: [{ piece: "church_twin_towers", where: "highpoint", scale: 0.9 }, { piece: "church_bell_tower", where: "highpoint", scale: 0.8 }],
    note: "Capital of Brazil: the upper town's churches on the escarpment above the lower town's quay (the split is the real terrain).",
  },
  rio_de_janeiro: {
    tweak: { trees: "palm" },
    fortScale: 1.15,
    extras: [{ piece: "ship", where: "water" }],
    note: "Gold-rush port of Minas: whitewash and tile round Guanabara Bay, Santa Cruz fort at the mouth. Sugarloaf is terrain.",
  },
  recife: {
    tweak: { trees: "palm", walls: ["#f6f3ea", "#f0d58a", "#e8c27a", "#f2a88a"] },
    note: "The 'Brazilian Mauritsstad': tall pastel fronts on the reef-sheltered river island, Forte do Brum on the sand.",
  },
  buenos_aires: {
    tweak: { roofKinds: { flat: 0.85, hip: 0.15 }, floors: [1, 1], fort: "bastion", trees: "broadleaf" },
    fortScale: 1.2,
    note: "A low flat-roofed town on the pampa's edge; the Fuerte (bastioned) on the river bank.",
  },
  montevideo: {
    size: 0.85,
    tweak: { cityWalls: true, roofKinds: { flat: 0.7, hip: 0.3 }, fort: "star" },
    note: "Walled Spanish citadel town on its peninsula across the River Plate.",
  },
  // Caribbean (the Main and the Guianas)
  paramaribo: {
    size: 0.85,
    tweak: { trees: "palm", walls: ["#f4f1ea", "#efe8d8", "#f6f3ea", "#e6dcc6"], roofs: ["#3f4652", "#5a5048"], extras: [] },
    fortScale: 1.1,
    note: "White timber Dutch houses on the Suriname river; Fort Zeelandia (star fort); no windmills in the tropics.",
  },
  la_guaira: {
    size: 0.8,
    fortWhere: "highpoint",
    tweak: { trees: "palm", fort: "bastion" },
    note: "Caracas's port squeezed under the mountain wall; the Castillo de San Carlos above the town.",
  },
  portobelo: {
    size: 0.8,
    tweak: { trees: "palm", fort: "bastion" },
    extras: [{ piece: "fort_bastion", where: "mouth", scale: 0.8 }, { piece: "fort_bastion", where: "coast", scale: 0.7 }],
    note: "Fair town of the treasure fleet: shore batteries round the bay (Santiago, San Jerónimo, San Fernando).",
  },
  // Pacific coast of the Americas
  panama: {
    tweak: { cityWalls: true, trees: "palm" },
    landmarkScale: 1.1,
    note: "Panamá Viejo's successor on its walled peninsula: sea walls round the town, the cathedral's bell tower.",
  },
  guayaquil: {
    size: 0.9,
    tweak: { trees: "palm", roofKinds: { hip: 0.7, gable: 0.3 } },
    extras: [{ piece: "careened_ship", where: "coast" }],
    note: "Timber town and shipyard of the South Sea on the Guayas (a hull on the slip).",
  },
  callao: {
    tweak: { fort: "star" },
    fortScale: 1.6,
    note: "Lima's port; the Real Felipe fortress (pentagonal star fort, built 1747) dominates the waterfront.",
  },
  valparaiso: {
    size: 0.85,
    fortWhere: "highpoint",
    tweak: { fort: "bastion", trees: "broadleaf" },
    note: "Small port under the hills; Castillo San José on the height.",
  },
  juan_fernandez: {
    size: 1,
    tweak: {
      maxHouses: 1, warehouses: 0, piers: 1, boats: 1, shipsAtAnchor: 0, fort: "none", landmark: "none",
      trees: "broadleaf", treeCount: 45, extras: [{ piece: "lookout", where: "highpoint" }],
    },
    note: "Uninhabited: one lonely hut on Cumberland Bay and a lookout on the ridge, where Selkirk was marooned (1704–09).",
  },
  // North Atlantic and Europe
  new_york: {
    size: 1.1,
    tweak: { fort: "star", extras: [{ piece: "windmill", where: "outskirts", count: 1 }] },
    fortScale: 1.1,
    extras: [{ piece: "ship", where: "water" }],
    note: "Fort George (Fort Amsterdam, four bastions) at the tip of Manhattan; Trinity's steeple; a Dutch windmill left over.",
  },
  porto: {
    tweak: { fort: "none", warehouses: 6, boats: 6 },
    extras: [{ piece: "boat", where: "water", count: 3 }, { piece: "church_bell_tower", where: "highpoint", scale: 1.1 }],
    note: "The Ribeira riverfront: wine lodges on the Douro quay, port-wine barges (rabelos) moored off, the Clérigos tower above.",
  },
  funchal: {
    size: 0.9,
    tweak: { walls: ["#f6f3ea", "#f4f1ea", "#efe8d8"], trees: "broadleaf", treeCount: 90 },
    note: "Madeira: a whitewashed town with tile roofs under green terraced hills; São Lourenço fort on the bay.",
  },
};
