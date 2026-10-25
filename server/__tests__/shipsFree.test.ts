// SHIPS_FREE runtime switch: env parsing and the Stripe payment-intent refusal while ships are free.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { shipsFree } from "../config";

// stripeRoutes imports Redis and Segment at load; stub them so no connection is attempted.
vi.mock("../redisStorage", () => ({ redisStorage: {} }));
vi.mock("../segmentClient", () => ({ identifyPlayer() {}, trackEvent() {}, flushSegment: async () => {} }));

const saved = process.env.SHIPS_FREE;
afterEach(() => {
  if (saved === undefined) delete process.env.SHIPS_FREE;
  else process.env.SHIPS_FREE = saved;
});

describe("shipsFree()", () => {
  it("is false when unset or empty (charge, today's behaviour)", () => {
    delete process.env.SHIPS_FREE;
    expect(shipsFree()).toBe(false);
    process.env.SHIPS_FREE = "";
    expect(shipsFree()).toBe(false);
  });
  it("is true for true/1 in any case, trimmed", () => {
    for (const v of ["true", "TRUE", "True", "1", " true "]) {
      process.env.SHIPS_FREE = v;
      expect(shipsFree()).toBe(true);
    }
  });
  it("is false for anything else", () => {
    for (const v of ["false", "0", "yes", "on", "tru"]) {
      process.env.SHIPS_FREE = v;
      expect(shipsFree()).toBe(false);
    }
  });
  it("is re-read on every call", () => {
    process.env.SHIPS_FREE = "true";
    expect(shipsFree()).toBe(true);
    process.env.SHIPS_FREE = "false";
    expect(shipsFree()).toBe(false);
  });
});

describe("POST /api/stripe/create-payment-intent", () => {
  let handler: (req: any, res: any) => Promise<any>;
  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY ||= "sk_test_dummy";
    const { registerStripeRoutes } = await import("../routes/stripeRoutes");
    const posts: Record<string, any> = {};
    const app: any = { use() {}, get() {}, post: (path: string, h: any) => { posts[path] = h; } };
    registerStripeRoutes(app);
    handler = posts["/api/stripe/create-payment-intent"];
  });
  const fakeRes = () => {
    const r: any = { code: 200, body: undefined };
    r.status = (c: number) => { r.code = c; return r; };
    r.json = (b: any) => { r.body = b; return r; };
    return r;
  };

  it("refuses with 409 while ships are free, before touching Stripe", async () => {
    process.env.SHIPS_FREE = "true";
    const res = fakeRes();
    await handler({ body: { shipName: "galleon", amount: 1, currency: "usd", playerName: "x", tempPlayerId: "y" } }, res);
    expect(res.code).toBe(409);
    expect(res.body).toEqual({ message: "Ships are free right now" });
  });
  it("does not use the free refusal when charging (falls through to normal validation)", async () => {
    delete process.env.SHIPS_FREE;
    const res = fakeRes();
    await handler({ body: {} }, res);
    expect(res.code).toBe(400);
  });
});
