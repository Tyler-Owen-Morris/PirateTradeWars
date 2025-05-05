import { create } from "zustand";
import { ShipStats } from "@/types";
import { apiRequest } from "../queryClient";
import { SHIP_TYPES, SHIP_DISPLAY_NAMES, SHIP_DESCRIPTIONS, SHIP_STATS } from "@shared/gameConstants";

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
      console.log("API returned ships:", ships)

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
          name: SHIP_TYPES.SLOOP,
          displayName: SHIP_DISPLAY_NAMES[SHIP_TYPES.SLOOP],
          description: SHIP_DESCRIPTIONS[SHIP_TYPES.SLOOP],
          ...SHIP_STATS[SHIP_TYPES.SLOOP]
        },
        {
          id: 2,
          name: SHIP_TYPES.BRIGANTINE,
          displayName: SHIP_DISPLAY_NAMES[SHIP_TYPES.BRIGANTINE],
          description: SHIP_DESCRIPTIONS[SHIP_TYPES.BRIGANTINE],
          ...SHIP_STATS[SHIP_TYPES.BRIGANTINE]
        },
        {
          id: 3,
          name: SHIP_TYPES.GALLEON,
          displayName: SHIP_DISPLAY_NAMES[SHIP_TYPES.GALLEON],
          description: SHIP_DESCRIPTIONS[SHIP_TYPES.GALLEON],
          ...SHIP_STATS[SHIP_TYPES.GALLEON]
        },
        {
          id: 4,
          name: SHIP_TYPES.MAN_O_WAR,
          displayName: SHIP_DISPLAY_NAMES[SHIP_TYPES.MAN_O_WAR],
          description: SHIP_DESCRIPTIONS[SHIP_TYPES.MAN_O_WAR],
          ...SHIP_STATS[SHIP_TYPES.MAN_O_WAR]
        }
      ];

      set({ ships: fallbackShips });

      // Default to sloop
      set({ selectedShip: fallbackShips[0] });
    }
  },

  selectShip: (shipName: string) => {
    console.log("get ships", get().ships)
    const ship = get().ships.find(s => s.name === shipName);
    if (ship) {
      set({ selectedShip: ship });
    }
  }
}));
