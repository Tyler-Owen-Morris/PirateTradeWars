/**
 * WebSocket transport with exponential-backoff reconnect and RTT pings (PROTOCOL §3, §7).
 * Framework-free: the WebSocket constructor, timers and clock are injectable for tests.
 *
 * - Connects to `${ws|wss}://${host}/game-ws`.
 * - On an unexpected close it reconnects after 0.5 s, 1 s, 2 s, 4 s, 8 s, 8 s, ... (reset on open).
 *   The owner re-sends `reconnect` with the stored player id from its `onOpen` handler.
 * - While open it sends `{t:"ping", c:now}` every PING_INTERVAL_MS; `pong` handling is the owner's
 *   (it feeds ServerClock.onPong).
 * - `close()` is a deliberate disconnect: no reconnect until `open()` is called again.
 */
import { PING_INTERVAL_MS } from "@shared/protocol";

export const BACKOFF_BASE_MS = 500;
export const BACKOFF_MAX_MS = 8000;

/** Delay before reconnect attempt `attempt` (0-based): 500, 1000, 2000, 4000, 8000, 8000, ... ms. */
export function backoffDelay(attempt: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * Math.pow(2, Math.max(0, attempt)));
}

/** Minimal WebSocket surface we use (the DOM WebSocket satisfies it). */
export interface SocketLike {
  readyState: number;
  onopen: ((ev: any) => void) | null;
  onclose: ((ev: any) => void) | null;
  onerror: ((ev: any) => void) | null;
  onmessage: ((ev: { data: any }) => void) | null;
  send(data: string): void;
  close(): void;
}

export interface ConnectionHandlers {
  onOpen?: () => void;
  onClose?: (willReconnect: boolean) => void;
  onError?: (ev: unknown) => void;
  /** Parsed JSON frame. */
  onMessage?: (msg: any) => void;
}

export interface ConnectionOptions {
  url?: string;
  createSocket?: (url: string) => SocketLike;
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => any;
  clearTimeout?: (h: any) => void;
  setInterval?: (fn: () => void, ms: number) => any;
  clearInterval?: (h: any) => void;
}

const OPEN = 1;

export function defaultGameSocketUrl(): string {
  const loc = (globalThis as any).location;
  if (!loc) return "ws://localhost:5000/game-ws";
  const protocol = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${loc.host}/game-ws`;
}

export class Connection {
  socket: SocketLike | null = null;
  attempt = 0;
  private wantOpen = false;
  private reconnectTimer: any = null;
  private pingTimer: any = null;
  private readonly opts: Required<ConnectionOptions>;

  constructor(private readonly handlers: ConnectionHandlers, options: ConnectionOptions = {}) {
    this.opts = {
      url: options.url ?? defaultGameSocketUrl(),
      createSocket: options.createSocket ?? ((url) => new WebSocket(url) as unknown as SocketLike),
      now: options.now ?? (() => Date.now()),
      setTimeout: options.setTimeout ?? ((fn, ms) => setTimeout(fn, ms)),
      clearTimeout: options.clearTimeout ?? ((h) => clearTimeout(h)),
      setInterval: options.setInterval ?? ((fn, ms) => setInterval(fn, ms)),
      clearInterval: options.clearInterval ?? ((h) => clearInterval(h)),
    };
  }

  get isOpen(): boolean {
    return !!this.socket && this.socket.readyState === OPEN;
  }

  /** Open (or re-open) the connection; enables auto-reconnect. */
  open(): void {
    this.wantOpen = true;
    if (this.reconnectTimer !== null) {
      this.opts.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket && this.socket.readyState <= OPEN) return; // CONNECTING or OPEN
    this.createSocket();
  }

  /** Deliberate disconnect; disables auto-reconnect. */
  close(): void {
    this.wantOpen = false;
    if (this.reconnectTimer !== null) {
      this.opts.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopPing();
    const s = this.socket;
    this.socket = null;
    if (s) {
      s.onopen = s.onclose = s.onerror = s.onmessage = null;
      try {
        s.close();
      } catch {
        /* ignore */
      }
    }
  }

  /** Send a JSON message if open. Returns false if it could not be sent. */
  send(msg: unknown): boolean {
    if (!this.socket || this.socket.readyState !== OPEN) return false;
    try {
      this.socket.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  private createSocket(): void {
    let s: SocketLike;
    try {
      s = this.opts.createSocket(this.opts.url);
    } catch (err) {
      this.handlers.onError?.(err);
      this.scheduleReconnect();
      return;
    }
    this.socket = s;
    s.onopen = () => {
      if (this.socket !== s) return;
      this.attempt = 0;
      this.startPing();
      this.handlers.onOpen?.();
    };
    s.onmessage = (ev) => {
      if (this.socket !== s) return;
      let msg: any;
      try {
        msg = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
      } catch {
        return;
      }
      if (msg && typeof msg === "object") this.handlers.onMessage?.(msg);
    };
    s.onerror = (ev) => {
      if (this.socket !== s) return;
      this.handlers.onError?.(ev);
    };
    s.onclose = () => {
      if (this.socket !== s) return;
      this.socket = null;
      this.stopPing();
      const willReconnect = this.wantOpen;
      this.handlers.onClose?.(willReconnect);
      if (willReconnect) this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (!this.wantOpen || this.reconnectTimer !== null) return;
    const delay = backoffDelay(this.attempt);
    this.attempt++;
    this.reconnectTimer = this.opts.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.wantOpen) this.createSocket();
    }, delay);
  }

  private startPing(): void {
    this.stopPing();
    this.sendPing();
    this.pingTimer = this.opts.setInterval(() => this.sendPing(), PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      this.opts.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private sendPing(): void {
    this.send({ t: "ping", c: this.opts.now() });
  }
}
