export interface PlayerState {
    id: string;
    playerId: string;
    name: string;
    shipType: string;
    x: number;
    y: number;
    z: number;
    rotationY: number;
    speed: number;
    direction: { x: number; y: number; z: number };
    gold: number;
    cargoUsed: number;
    cargoCapacity: number;
    health: number;
    maxHealth: number;
    firing: boolean;
    dead: boolean;
    connected: boolean;
    isActive: boolean;
    lastSeen: number;
} 