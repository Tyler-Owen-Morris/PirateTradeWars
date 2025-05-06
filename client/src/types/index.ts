// Player ship stats
export interface ShipStats {
  id: number;
  name: string;
  displayName: string;
  description: string;
  hullStrength: number;
  armor: number;
  cargoCapacity: number;
  speed: number;
  cannonCount: number;
  cannonDamage: number;
  cannonReload: number;
  cannonRange: number;
  repairCost: number;
  isPaid: boolean;
  playerTTL: number;
}

// Player state
export interface PlayerState {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  rotation: number;
  shipType: string;
  health: number;
  gold: number;
  sunk: boolean;
  scuttled: boolean;
  inventory: InventoryItem[];
}

// Cannon ball
export interface CannonBall {
  id: string;
  ownerId: string;
  damage: number;
  x: number;
  y: number;
  z: number;
  direction: Vector3;
  speed: number;
  range: number;
  created: number;
}

// Gold object
export interface GoldObject {
  id: string;
  x: number;
  y: number;
  z: number;
  gold: number;
}
// Port
export interface Port {
  id: number;
  name: string;
  x: number;
  y: number;
  z: number;
  safeRadius: number;
}

// Trade good
export interface Good {
  id: number;
  name: string;
  basePrice: number;
  fluctuation: number;
}

// Port good with current price
export interface PortGood {
  id: number;
  portId: number;
  goodId: number;
  currentPrice: number;
  stock: number;
}

// Player inventory item
export interface InventoryItem {
  playerId: string;
  goodId: number;
  quantity: number;
  good?: Good;
}

// Leaderboard entry
export interface LeaderboardEntry {
  id: number;
  playerId: string;
  playerName: string;
  score: number;
  achievedAt: string;
}

// Simple Vector3 type
export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

// Game state
export interface GameState {
  player: PlayerState | null;
  otherPlayers: Record<string, PlayerState>;
  cannonBalls: CannonBall[];
  goldObjects: GoldObject[];
  ports: Port[];
  goods: Good[];
  inventory: InventoryItem[];
  nearestPort: Port | null;
  isNearPort: boolean;
  leaderboard: LeaderboardEntry[];
}

// Socket messages
export interface SocketRegisterMessage {
  type: 'register';
  name: string;
  shipType: string;
}

export interface SocketInputMessage {
  type: 'input';
  rotationY?: number;
  speed?: number;
  direction?: Vector3;
  firing?: boolean;
}

export interface SocketTradeMessage {
  type: 'trade';
  portId: number;
  action: 'buy' | 'sell';
  goodId: number;
  quantity: number;
}

export interface SocketGameUpdateMessage {
  type: 'gameUpdate';
  players: Record<string, PlayerState>;
  cannonBalls: CannonBall[];
  goldObjects: GoldObject[];
  timestamp: number;
}

export interface SocketErrorMessage {
  type: 'error';
  message: string;
  timestamp: number;
}

export interface SocketWelcomeMessage {
  type: 'welcome';
  message: string;
  timestamp: number;
}

export interface SocketRegisteredMessage {
  type: 'registered';
  playerId: string;
  timestamp: number;
}

export interface SocketTradeSuccessMessage {
  type: 'tradeSuccess';
  gold: number;
  inventory: InventoryItem[];
  timestamp: number;
}

export interface SocketGameEndMessage {
  type: 'gameEnd';
  reason: 'scuttle' | 'sunk';
  score: number;
  message: string;
  leaderboard: LeaderboardEntry[];
  timestamp: number;
}

// Connect message
export interface SocketConnectMessage {
  type: 'connect';
  name: string;
  shipType: string;
}

// Reconnect message
export interface SocketReconnectMessage {
  type: 'reconnect';
  id: string;
  name: string;
}

// Connected message
export interface SocketConnectedMessage {
  type: 'connected';
  playerId: string;
  name: string;
  ship: ShipStats;
  gold: number;
  players: Record<string, PlayerState>;
  cannonBalls: CannonBall[];
  goldObjects?: GoldObject[];
  timestamp: number;
}

// Reconnected message
export interface SocketReconnectedMessage {
  type: 'reconnected';
  playerId: string;
  name: string;
  ship: ShipStats;
  gold: number;
  players: Record<string, PlayerState>;
  cannonBalls: CannonBall[];
  timestamp: number;
}

// Full sync message
export interface SocketFullSyncMessage {
  type: 'fullSync';
  players: Record<string, PlayerState>;
  cannonBalls: CannonBall[];
  goldObjects: GoldObject[];
  timestamp: number;
}

// Player dead message
export interface SocketPlayerDeadMessage {
  type: 'playerDead';
  id: string;
  players: Record<string, PlayerState>;
  timestamp: number;
}

// Name error message
export interface SocketNameErrorMessage {
  type: 'nameError';
  message: string;
  timestamp: number;
}

// Upgrade ship message
export interface SocketUpgradeShipMessage {
  type: 'upgradeShip';
  portId: number;
}

// Repair ship message
export interface SocketRepairShipMessage {
  type: 'repairShip';
  portId: number;
}

// Upgrade success message
export interface SocketUpgradeSuccessMessage {
  type: 'upgradeSuccess';
  newShipType: string;
  gold: number;
  timestamp: number;
}

// Repair success message
export interface SocketRepairSuccessMessage {
  type: 'repairSuccess';
  gold: number;
  hp: number;
  timestamp: number;
}

// Scuttle message
export interface SocketScuttleMessage {
  type: 'scuttle';
}

// Gold collected message
export interface SocketGoldCollectedMessage {
  type: 'goldCollected';
  gold: number;
  newTotalGold: number;
  timestamp: number;
}

// Update SocketMessage union type
export type SocketMessage =
  | SocketRegisterMessage
  | SocketConnectMessage
  | SocketReconnectMessage
  | SocketConnectedMessage
  | SocketReconnectedMessage
  | SocketFullSyncMessage
  | SocketInputMessage
  | SocketTradeMessage
  | SocketUpgradeShipMessage
  | SocketRepairShipMessage
  | SocketScuttleMessage
  | SocketGameUpdateMessage
  | SocketPlayerDeadMessage
  | SocketErrorMessage
  | SocketNameErrorMessage
  | SocketWelcomeMessage
  | SocketRegisteredMessage
  | SocketTradeSuccessMessage
  | SocketUpgradeSuccessMessage
  | SocketRepairSuccessMessage
  | SocketGoldCollectedMessage
  | SocketGameEndMessage;
