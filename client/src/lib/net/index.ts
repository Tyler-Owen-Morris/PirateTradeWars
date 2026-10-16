/**
 * Client netcode entry point. `net` is the app-wide NetClient singleton; useSocket (zustand) wires
 * its events into React state, and game components read from it inside `useFrame`.
 * See client/CLIENT_CONTEXT.md "Netcode (client)".
 */
import { NetClient } from "./netClient";
import { clientLand } from "../world/landTiles";

export const net = new NetClient({ land: clientLand });

export { NetClient } from "./netClient";
export type { NetEvents } from "./netClient";
export * from "./controls";
export { ServerClock } from "./clock";
export { Predictor } from "./prediction";
export { InterpolationBuffer, RemoteWorld } from "./interpolation";
export type { RemotePose, RemoteEntity, RemoteMeta } from "./interpolation";
export { BallSim } from "./cannonballs";
export { Connection, backoffDelay } from "./connection";
