import { redisStorage } from "../redisStorage";
import { ShipType } from "@shared/schema";
import { DEFAULT_PORTS } from "@shared/gameConstants";

export const defaultShipTypes: Omit<ShipType, "id">[] = [
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

// Trade goods
export const goodTypes = [
    { name: "Fish", basePrice: 10, fluctuation: 20 },
    { name: "Wood", basePrice: 15, fluctuation: 10 },
    { name: "Sugar", basePrice: 30, fluctuation: 25 },
    { name: "Cotton", basePrice: 40, fluctuation: 20 },
    { name: "Rum", basePrice: 50, fluctuation: 30 },
    { name: "Tobacco", basePrice: 60, fluctuation: 35 },
    { name: "Spices", basePrice: 80, fluctuation: 40 },
    { name: "Silk", basePrice: 100, fluctuation: 50 }
];

// Use ports from gameConstants
export const defaultPorts = DEFAULT_PORTS;

export async function setupShipTypes() {
    try {
        const existingShipTypes = await redisStorage.getShipTypes();
        if (existingShipTypes.length === 0) {
            console.log("Initializing ship types...");
            for (const shipType of defaultShipTypes) {
                await redisStorage.createShipType(shipType);
            }
            console.log("Ship types initialized");
        }
    } catch (err) {
        console.error("Error initializing ship types:", err);
    }
} 