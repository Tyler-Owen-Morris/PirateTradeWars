// Input list for shared/world/ports.json (spec §5). Real historical ports with their real
// coordinates and the power that held them c. 1700. build-world.ts places town/dock/spawn on the SDF.
//
// Nation notes (c. 1700):
// - Nassau: English colony that collapsed into the pirate "Republic of Pirates" (1706-1718) -> pirates.
// - Tortuga: nominally French by 1700, but the game's archetypal buccaneer haven -> pirates.
// - Ile Sainte-Marie (Madagascar): pirate base of the 1690s-1720s (Avery, Kidd, Misson) -> pirates.
// - Cape Town and Elmina: Dutch (VOC since 1652; WIC since 1637). Willemstad: Dutch.
// - Goa and Macau: Portuguese. Batavia: Dutch (VOC). Manila and Acapulco: Spanish (Manila galleon).
// New Horizons phase 1 (2026-10-23), era window 1650-1800:
// - Brazil (Salvador, Rio, Recife): Portuguese (Recife retaken from the Dutch in 1654).
// - Buenos Aires and Montevideo (founded 1724-26): Spanish, the River Plate.
// - Paramaribo: Dutch Suriname (ceded by England in 1667). New York: English since 1664.
// - Juan Fernández: the uninhabited Pacific island where pirates watered (Selkirk, 1704-09) -> pirates.
export type Nation = "england" | "spain" | "france" | "portugal" | "netherlands" | "pirates";
export type Region =
  | "caribbean"
  | "north_atlantic"
  | "europe"
  | "africa"
  | "indian_ocean"
  | "east_asia"
  | "americas_pacific"
  | "south_atlantic";

export interface PortDef {
  id: string;
  name: string;
  lat: number;
  lon: number;
  nation: Nation;
  region: Region;
}

export const PORT_DEFS: PortDef[] = [
  // Caribbean and Gulf (10)
  { id: "port_royal", name: "Port Royal", lat: 17.94, lon: -76.84, nation: "england", region: "caribbean" },
  { id: "havana", name: "Havana", lat: 23.14, lon: -82.36, nation: "spain", region: "caribbean" },
  { id: "cartagena", name: "Cartagena", lat: 10.42, lon: -75.55, nation: "spain", region: "caribbean" },
  { id: "veracruz", name: "Veracruz", lat: 19.2, lon: -96.13, nation: "spain", region: "caribbean" },
  { id: "nassau", name: "Nassau", lat: 25.08, lon: -77.34, nation: "pirates", region: "caribbean" },
  { id: "tortuga", name: "Tortuga", lat: 20.03, lon: -72.8, nation: "pirates", region: "caribbean" },
  { id: "bridgetown", name: "Bridgetown", lat: 13.1, lon: -59.62, nation: "england", region: "caribbean" },
  { id: "san_juan", name: "San Juan", lat: 18.47, lon: -66.11, nation: "spain", region: "caribbean" },
  { id: "willemstad", name: "Willemstad", lat: 12.11, lon: -68.93, nation: "netherlands", region: "caribbean" },
  { id: "saint_pierre", name: "Saint-Pierre", lat: 14.74, lon: -61.18, nation: "france", region: "caribbean" },
  // North American Atlantic coast
  { id: "charleston", name: "Charleston", lat: 32.78, lon: -79.93, nation: "england", region: "north_atlantic" },
  { id: "boston", name: "Boston", lat: 42.36, lon: -71.05, nation: "england", region: "north_atlantic" },
  // Europe
  { id: "lisbon", name: "Lisbon", lat: 38.71, lon: -9.14, nation: "portugal", region: "europe" },
  { id: "cadiz", name: "Cádiz", lat: 36.53, lon: -6.29, nation: "spain", region: "europe" },
  { id: "seville", name: "Seville", lat: 37.39, lon: -5.99, nation: "spain", region: "europe" },
  { id: "london", name: "London", lat: 51.51, lon: -0.08, nation: "england", region: "europe" },
  { id: "bristol", name: "Bristol", lat: 51.45, lon: -2.59, nation: "england", region: "europe" },
  { id: "amsterdam", name: "Amsterdam", lat: 52.37, lon: 4.9, nation: "netherlands", region: "europe" },
  { id: "saint_malo", name: "Saint-Malo", lat: 48.65, lon: -2.03, nation: "france", region: "europe" },
  // Africa
  { id: "elmina", name: "Elmina", lat: 5.08, lon: -1.35, nation: "netherlands", region: "africa" },
  { id: "cape_town", name: "Cape Town", lat: -33.92, lon: 18.42, nation: "netherlands", region: "africa" },
  // Indian Ocean
  { id: "sainte_marie", name: "Île Sainte-Marie", lat: -16.99, lon: 49.85, nation: "pirates", region: "indian_ocean" },
  { id: "goa", name: "Goa", lat: 15.5, lon: 73.83, nation: "portugal", region: "indian_ocean" },
  // East Asia
  { id: "batavia", name: "Batavia", lat: -6.13, lon: 106.81, nation: "netherlands", region: "east_asia" },
  { id: "macau", name: "Macau", lat: 22.19, lon: 113.54, nation: "portugal", region: "east_asia" },
  { id: "manila", name: "Manila", lat: 14.59, lon: 120.97, nation: "spain", region: "east_asia" },
  // Pacific coast of the Americas
  { id: "acapulco", name: "Acapulco", lat: 16.85, lon: -99.89, nation: "spain", region: "americas_pacific" },
  // --- New Horizons phase 1 (2026-10-23): the Americas, both coasts. APPEND ONLY: numeric port ids
  // are 1-based indices into ports.json, so new ports go at the end. ---
  // South Atlantic (Brazil and the River Plate)
  { id: "salvador", name: "Salvador da Bahia", lat: -12.97, lon: -38.51, nation: "portugal", region: "south_atlantic" },
  { id: "rio_de_janeiro", name: "Rio de Janeiro", lat: -22.91, lon: -43.17, nation: "portugal", region: "south_atlantic" },
  { id: "recife", name: "Recife", lat: -8.05, lon: -34.88, nation: "portugal", region: "south_atlantic" },
  { id: "buenos_aires", name: "Buenos Aires", lat: -34.6, lon: -58.37, nation: "spain", region: "south_atlantic" },
  { id: "montevideo", name: "Montevideo", lat: -34.9, lon: -56.19, nation: "spain", region: "south_atlantic" },
  // Caribbean (the Main and the Guianas)
  { id: "paramaribo", name: "Paramaribo", lat: 5.85, lon: -55.2, nation: "netherlands", region: "caribbean" },
  { id: "la_guaira", name: "La Guaira", lat: 10.6, lon: -66.93, nation: "spain", region: "caribbean" },
  { id: "portobelo", name: "Portobelo", lat: 9.55, lon: -79.65, nation: "spain", region: "caribbean" },
  // Pacific coast of the Americas (the South Sea)
  { id: "panama", name: "Panamá", lat: 8.95, lon: -79.53, nation: "spain", region: "americas_pacific" },
  { id: "guayaquil", name: "Guayaquil", lat: -2.19, lon: -79.88, nation: "spain", region: "americas_pacific" },
  { id: "callao", name: "Callao", lat: -12.06, lon: -77.15, nation: "spain", region: "americas_pacific" },
  { id: "valparaiso", name: "Valparaíso", lat: -33.05, lon: -71.62, nation: "spain", region: "americas_pacific" },
  { id: "juan_fernandez", name: "Juan Fernández", lat: -33.64, lon: -78.85, nation: "pirates", region: "americas_pacific" },
  // North Atlantic and Europe
  { id: "new_york", name: "New York", lat: 40.7, lon: -74.01, nation: "england", region: "north_atlantic" },
  { id: "porto", name: "Porto", lat: 41.15, lon: -8.61, nation: "portugal", region: "europe" },
  { id: "funchal", name: "Funchal", lat: 32.65, lon: -16.91, nation: "portugal", region: "europe" },
];

/** Named long-haul lanes (spec §6), in addition to each port's 4 nearest by sea. */
export const NAMED_LANES: [string, string][] = [
  ["lisbon", "bridgetown"], // Lisbon/Cádiz to the Caribbean
  ["cadiz", "san_juan"],
  ["london", "boston"],
  ["cadiz", "cape_town"], // the Cape route east
  ["cape_town", "goa"],
  ["goa", "batavia"],
  ["batavia", "macau"],
  ["cartagena", "havana"], // the treasure fleet
  ["havana", "seville"],
  ["acapulco", "manila"], // Manila galleon (bonus)
  // New Horizons phase 1
  ["lisbon", "rio_de_janeiro"], // the Brazil fleet (frota do Brasil)
  ["cadiz", "portobelo"], // the galeones to Tierra Firme (the Portobelo fair)
  ["callao", "panama"], // the Armada del Mar del Sur carrying Potosí silver north
  ["buenos_aires", "valparaiso"], // round Cape Horn
  ["rio_de_janeiro", "cape_town"], // across the South Atlantic to the Cape route
];
