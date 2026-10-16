// Input list for shared/world/ports.json (spec §5). Real historical ports with their real
// coordinates and the power that held them c. 1700. build-world.ts places town/dock/spawn on the SDF.
//
// Nation notes (c. 1700):
// - Nassau: English colony that collapsed into the pirate "Republic of Pirates" (1706-1718) -> pirates.
// - Tortuga: nominally French by 1700, but the game's archetypal buccaneer haven -> pirates.
// - Ile Sainte-Marie (Madagascar): pirate base of the 1690s-1720s (Avery, Kidd, Misson) -> pirates.
// - Cape Town and Elmina: Dutch (VOC since 1652; WIC since 1637). Willemstad: Dutch.
// - Goa and Macau: Portuguese. Batavia: Dutch (VOC). Manila and Acapulco: Spanish (Manila galleon).
export type Nation = "england" | "spain" | "france" | "portugal" | "netherlands" | "pirates";
export type Region =
  | "caribbean"
  | "north_atlantic"
  | "europe"
  | "africa"
  | "indian_ocean"
  | "east_asia"
  | "americas_pacific";

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
];
