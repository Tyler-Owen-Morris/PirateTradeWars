import { storage } from "../storage";

// Define ship types based on the game design document
export async function setupShipTypes() {
  const shipTypes = [
    {
      name: "sloop",
      displayName: "The Sloop",
      description: "A small, rickety vessel for new pirates. Cheap but vulnerable, it's a starting point for all free players.",
      hullStrength: 50,
      armor: 0,
      cargoCapacity: 20,
      speed: 5,
      cannonCount: 1,
      cannonDamage: 5,
      cannonReload: 2.0,
      repairCost: 100,
      isPaid: false
    },
    {
      name: "brigantine",
      displayName: "The Brigantine",
      description: "A sturdy ship for aspiring captains, offering a balanced upgrade over the free Sloop.",
      hullStrength: 150,
      armor: 10,
      cargoCapacity: 40,
      speed: 6,
      cannonCount: 2,
      cannonDamage: 8,
      cannonReload: 1.8,
      repairCost: 300,
      isPaid: true
    },
    {
      name: "galleon",
      displayName: "The Galleon",
      description: "A formidable merchant vessel, blending cargo capacity with combat strength.",
      hullStrength: 300,
      armor: 20,
      cargoCapacity: 60,
      speed: 7,
      cannonCount: 3,
      cannonDamage: 12,
      cannonReload: 1.5,
      repairCost: 600,
      isPaid: true
    },
    {
      name: "man-o-war",
      displayName: "The Man-o'-War",
      description: "The ultimate warship, a terror of the seas built for dominance.",
      hullStrength: 500,
      armor: 30,
      cargoCapacity: 80,
      speed: 8,
      cannonCount: 4,
      cannonDamage: 15,
      cannonReload: 1.2,
      repairCost: 1000,
      isPaid: true
    }
  ];

  // Get existing ship types
  const existingShipTypes = await storage.getShipTypes();
  if (existingShipTypes.length === 0) {
    // Insert ship types if none exist
    for (const shipType of shipTypes) {
      await storage.createShipType(shipType);
    }
    console.log("Ship types initialized successfully");
  }
}

// Trade goods
export const goodTypes = [
  { name: "Rum", basePrice: 50, fluctuation: 30 },
  { name: "Sugar", basePrice: 30, fluctuation: 25 },
  { name: "Spices", basePrice: 80, fluctuation: 40 },
  { name: "Wood", basePrice: 15, fluctuation: 10 },
  { name: "Silk", basePrice: 100, fluctuation: 50 },
  { name: "Fish", basePrice: 10, fluctuation: 20 },
  { name: "Tobacco", basePrice: 60, fluctuation: 35 },
  { name: "Cotton", basePrice: 40, fluctuation: 20 }
];

// Default port locations in the core map (5000x5000)
export const defaultPorts = [
  { name: "Tortuga", x: 1000, y: 0, z: 1200, safeRadius: 200 },
  { name: "Port Royale", x: 4000, y: 0, z: 300, safeRadius: 200 },
  { name: "Nassau", x: 2500, y: 0, z: 4500, safeRadius: 200 },
  { name: "Havana", x: 4200, y: 0, z: 4000, safeRadius: 200 },
  { name: "Kingston", x: 800, y: 0, z: 3500, safeRadius: 200 },
  { name: "Santo Domingo", x: 2800, y: 0, z: 1500, safeRadius: 200 },
  { name: "Barbados", x: 1500, y: 0, z: 2500, safeRadius: 200 },
  { name: "Puerto Rico", x: 3500, y: 0, z: 2800, safeRadius: 200 }
];
