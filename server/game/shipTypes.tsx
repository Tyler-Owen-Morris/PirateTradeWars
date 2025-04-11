import { redisStorage } from "../redisStorage";
import { ShipType } from "@shared/schema";

export const defaultShipTypes: Omit<ShipType, "id">[] = [
    {
        name: "sloop",
        displayName: "Sloop",
        description: "A small, fast ship perfect for beginners. Quick and maneuverable but lightly armed.",
        hullStrength: 100,
        armor: 0,
        cargoCapacity: 50,
        speed: 5,
        cannonCount: 2,
        cannonDamage: 10,
        cannonReload: 2,
        repairCost: 50,
        isPaid: false
    },
    {
        name: "brigantine",
        displayName: "Brigantine",
        description: "A medium-sized ship with balanced stats. Good all-rounder for trading and combat.",
        hullStrength: 150,
        armor: 10,
        cargoCapacity: 100,
        speed: 4,
        cannonCount: 4,
        cannonDamage: 15,
        cannonReload: 3,
        repairCost: 100,
        isPaid: false
    },
    {
        name: "galleon",
        displayName: "Galleon",
        description: "A large, powerful ship with heavy firepower and cargo space. Slower but deadly.",
        hullStrength: 200,
        armor: 20,
        cargoCapacity: 200,
        speed: 3,
        cannonCount: 6,
        cannonDamage: 20,
        cannonReload: 4,
        repairCost: 200,
        isPaid: true
    },
    {
        name: "man-o-war",
        displayName: "Man-O-War",
        description: "The ultimate warship. Massive firepower and durability but very slow.",
        hullStrength: 300,
        armor: 30,
        cargoCapacity: 150,
        speed: 2,
        cannonCount: 8,
        cannonDamage: 25,
        cannonReload: 5,
        repairCost: 300,
        isPaid: true
    }
];

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