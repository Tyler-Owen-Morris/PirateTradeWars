import { create } from "zustand";
import { ShipStats } from "@/types";
import { apiRequest } from "../queryClient";

interface ShipState {
  ships: ShipStats[];
  selectedShip: ShipStats | null;
  loading: boolean;
  error: string | null;
  
  fetchShips: () => Promise<void>;
  selectShip: (shipName: string) => void;
}

export const useShip = create<ShipState>((set, get) => ({
  ships: [],
  selectedShip: null,
  loading: false,
  error: null,
  
  fetchShips: async () => {
    try {
      set({ loading: true, error: null });
      
      const response = await apiRequest('GET', '/api/ship-types', undefined);
      const ships = await response.json();
      
      set({ ships, loading: false });
      
      // Default to sloop if no ship is selected
      if (!get().selectedShip && ships.length > 0) {
        const sloop = ships.find((ship: ShipStats) => ship.name === 'sloop');
        if (sloop) {
          set({ selectedShip: sloop });
        }
      }
    } catch (error) {
      console.error('Failed to fetch ships:', error);
      set({ 
        loading: false, 
        error: 'Failed to load ship types. Please try again.'
      });
      
      // Fallback to hardcoded ship types if API fails
      const fallbackShips: ShipStats[] = [
        {
          id: 1,
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
          id: 2,
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
          id: 3,
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
          id: 4,
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
      
      set({ ships: fallbackShips });
      
      // Default to sloop
      set({ selectedShip: fallbackShips[0] });
    }
  },
  
  selectShip: (shipName: string) => {
    const ship = get().ships.find(s => s.name === shipName);
    if (ship) {
      set({ selectedShip: ship });
    }
  }
}));
