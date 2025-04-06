
import { PlayerState, GameState } from "@/types";

const STORAGE_KEYS = {
  GAME_STATE: 'pirate_game_state',
  PLAYER_ID: 'pirate_player_id',
  SHIP_TYPE: 'pirate_ship_type',
  PLAYER_NAME: 'pirate_player_name'
};

export const persistGameState = (gameState: GameState, playerId: string | null, shipType: string) => {
  if (!gameState.player) return;
  
  localStorage.setItem(STORAGE_KEYS.GAME_STATE, JSON.stringify({
    player: gameState.player,
    isPlaying: true,
    isSunk: gameState.player.sunk || false
  }));
  
  if (playerId) {
    localStorage.setItem(STORAGE_KEYS.PLAYER_ID, playerId);
  }
  
  localStorage.setItem(STORAGE_KEYS.SHIP_TYPE, shipType);
};

export const clearGameState = () => {
  localStorage.removeItem(STORAGE_KEYS.GAME_STATE);
  localStorage.removeItem(STORAGE_KEYS.PLAYER_ID);
  localStorage.removeItem(STORAGE_KEYS.SHIP_TYPE);
};

export const loadGameState = () => {
  const savedState = localStorage.getItem(STORAGE_KEYS.GAME_STATE);
  const playerId = localStorage.getItem(STORAGE_KEYS.PLAYER_ID);
  const shipType = localStorage.getItem(STORAGE_KEYS.SHIP_TYPE);
  
  return {
    savedState: savedState ? JSON.parse(savedState) : null,
    playerId,
    shipType
  };
};
