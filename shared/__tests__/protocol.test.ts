import { describe, expect, it } from "vitest";
import {
  FLAG_DISCONNECTED,
  FLAG_FIRING,
  FLAG_SUNK,
  GOLD_INTEREST_RADIUS,
  GRID_CELL,
  INTEREST_RADIUS,
  INTERP_DELAY_MS,
  MAX_INPUT_QUEUE,
  MAX_NAME_LENGTH,
  clientMessageKind,
  hasFlag,
  isInputMessage,
  makeFlags,
  packEntityRow,
  parseClientMessage,
  roundPos,
  roundRot,
  unpackEntityRow,
} from "@shared/protocol";

describe("constants", () => {
  it("match PROTOCOL.md", () => {
    expect(INTEREST_RADIUS).toBe(2000);
    expect(GOLD_INTEREST_RADIUS).toBe(1000);
    expect(GRID_CELL).toBe(500);
    expect(INTERP_DELAY_MS).toBe(100);
    expect(MAX_INPUT_QUEUE).toBe(40); // 2 s (was 10; bug 2026-10-23)
    expect([FLAG_SUNK, FLAG_DISCONNECTED, FLAG_FIRING]).toEqual([1, 2, 4]);
  });
});

describe("rounding + entity rows", () => {
  it("rounds x/z to 1 decimal and r to 3", () => {
    expect(roundPos(1234.5678)).toBe(1234.6);
    expect(roundRot(1.23456)).toBe(1.235);
  });

  it("pack/unpack round-trips (with rounding)", () => {
    const row = packEntityRow({ eid: 7, x: 10.04, z: 9999.96, r: -3.14159, v: -3.999, hp: 49.6, flags: 5 });
    expect(row).toEqual([7, 10, 10000, -3.142, -4, 50, 5]);
    expect(unpackEntityRow(row)).toEqual({ eid: 7, x: 10, z: 10000, r: -3.142, v: -4, hp: 50, flags: 5 });
    expect(JSON.parse(JSON.stringify(row))).toEqual(row);
  });

  it("flags compose and test", () => {
    const f = makeFlags(true, false, true);
    expect(f).toBe(5);
    expect(hasFlag(f, FLAG_SUNK)).toBe(true);
    expect(hasFlag(f, FLAG_DISCONNECTED)).toBe(false);
    expect(hasFlag(f, FLAG_FIRING)).toBe(true);
  });
});

describe("parseClientMessage", () => {
  it("accepts a well-formed input (string or object)", () => {
    const m = { t: "input", s: 12, th: 1, ru: -1, f: 1 };
    expect(parseClientMessage(JSON.stringify(m))).toEqual(m);
    expect(parseClientMessage(m)).toEqual(m);
    expect(isInputMessage(parseClientMessage(m))).toBe(true);
  });

  it("clamps input th/ru/f and floors seq", () => {
    expect(parseClientMessage({ t: "input", s: 3.9, th: 50, ru: -2, f: 9 })).toEqual({
      t: "input", s: 3, th: 1, ru: -1, f: 1,
    });
    expect(parseClientMessage({ t: "input", s: 0, th: "1", ru: null, f: "yes" })).toEqual({
      t: "input", s: 0, th: 0, ru: 0, f: 0,
    });
    expect(parseClientMessage({ t: "input", s: 1, th: NaN, ru: Infinity, f: true })).toEqual({
      t: "input", s: 1, th: 0, ru: 1, f: 1,
    });
  });

  it("drops extra fields (client can never send position/speed)", () => {
    const m = parseClientMessage({ t: "input", s: 1, th: 0, ru: 0, f: 0, x: 5, speed: 999, rotationY: 2 });
    expect(m).toEqual({ t: "input", s: 1, th: 0, ru: 0, f: 0 });
  });

  it("rejects inputs with a bad seq", () => {
    for (const s of [-1, "1", NaN, Infinity, 2 ** 40, undefined]) {
      expect(parseClientMessage({ t: "input", s, th: 1, ru: 0, f: 0 })).toBeNull();
    }
  });

  it("rejects garbage", () => {
    for (const g of [
      null, undefined, 42, "not json", "[]", "null", [], {}, { t: "nope" }, { type: 5 },
      "x".repeat(5000), { t: "ping" }, { t: "ping", c: "now" },
    ]) {
      expect(parseClientMessage(g)).toBeNull();
    }
  });

  it("parses ping", () => {
    expect(parseClientMessage({ t: "ping", c: 123.5 })).toEqual({ t: "ping", c: 123.5 });
  });

  it("parses legacy connect / reconnect, trimming and length-limiting names", () => {
    expect(parseClientMessage({ type: "connect", name: "  Jack ", shipType: "sloop" })).toEqual({
      type: "connect", name: "Jack", shipType: "sloop",
    });
    expect(parseClientMessage({ type: "connect", name: "Jack", shipType: "sloop", tempPlayerId: "abc" })).toEqual({
      type: "connect", name: "Jack", shipType: "sloop", tempPlayerId: "abc",
    });
    expect(parseClientMessage({ type: "connect", name: "x".repeat(MAX_NAME_LENGTH + 1), shipType: "sloop" })).toBeNull();
    expect(parseClientMessage({ type: "connect", name: "Jack", shipType: 3 })).toBeNull();
    expect(parseClientMessage({ type: "connect", name: "Jack", shipType: "sloop", tempPlayerId: 9 })).toBeNull();
    expect(parseClientMessage({ type: "reconnect", id: "p1", name: "Jack" })).toEqual({
      type: "reconnect", id: "p1", name: "Jack",
    });
    expect(parseClientMessage({ type: "reconnect", name: "Jack" })).toBeNull();
  });

  it("validates trade / upgrade / repair / scuttle", () => {
    expect(parseClientMessage({ type: "trade", portId: 1, action: "buy", goodId: 2, quantity: 3 })).toEqual({
      type: "trade", portId: 1, action: "buy", goodId: 2, quantity: 3,
    });
    expect(parseClientMessage({ type: "trade", portId: 1, action: "steal", goodId: 2, quantity: 3 })).toBeNull();
    expect(parseClientMessage({ type: "trade", portId: 1, action: "sell", goodId: 2, quantity: -3 })).toBeNull();
    expect(parseClientMessage({ type: "trade", portId: 1, action: "sell", goodId: 2, quantity: 0 })).toBeNull();
    expect(parseClientMessage({ type: "upgradeShip", portId: 4 })).toEqual({ type: "upgradeShip", portId: 4 });
    expect(parseClientMessage({ type: "repairShip", portId: "4" })).toBeNull();
    expect(parseClientMessage({ type: "scuttle", extra: 1 })).toEqual({ type: "scuttle" });
  });

  it("trading (2026-10-23): trade ref / expectedPrice and sellAll", () => {
    expect(parseClientMessage({ type: "trade", portId: 1, action: "buy", goodId: 2, quantity: 3, ref: 5, expectedPrice: 18 })).toEqual({
      type: "trade", portId: 1, action: "buy", goodId: 2, quantity: 3, ref: 5, expectedPrice: 18,
    });
    expect(parseClientMessage({ type: "trade", portId: 1, action: "buy", goodId: 2, quantity: 3, ref: 0 })).toBeNull();
    expect(parseClientMessage({ type: "trade", portId: 1, action: "buy", goodId: 2, quantity: 3, expectedPrice: "18" })).toBeNull();
    expect(parseClientMessage({ type: "sellAll", portId: 2 })).toEqual({ type: "sellAll", portId: 2 });
    expect(parseClientMessage({ type: "sellAll", portId: 2, ref: 1, lines: [{ goodId: 1, quantity: 4, expectedPrice: 9 }] })).toEqual({
      type: "sellAll", portId: 2, ref: 1, lines: [{ goodId: 1, quantity: 4, expectedPrice: 9 }],
    });
    expect(parseClientMessage({ type: "sellAll", portId: 2, lines: [{ goodId: 1, quantity: 0 }] })).toBeNull();
    expect(parseClientMessage({ type: "sellAll", portId: 2, lines: "all" })).toBeNull();
  });

  it("clientMessageKind reads either discriminator", () => {
    expect(clientMessageKind({ t: "ping", c: 1 })).toBe("ping");
    expect(clientMessageKind({ type: "scuttle" })).toBe("scuttle");
  });
});
