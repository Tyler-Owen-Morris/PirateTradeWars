import { pgTable, text, serial, integer, boolean, timestamp, unique, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// User table - basic authentication
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

// Player table - game state for each player
export const players = pgTable("players", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  name: text("name").notNull().unique(),
  shipType: text("ship_type").notNull().default("sloop"),
  gold: integer("gold").notNull().default(500),
  isActive: boolean("is_active").notNull().default(true),
  lastSeen: timestamp("last_seen").defaultNow().notNull(),
});

export const insertPlayerSchema = createInsertSchema(players).pick({
  userId: true,
  name: true,
  shipType: true,
});

// Leaderboard table - high scores
export const leaderboard = pgTable("leaderboard", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").references(() => players.id),
  playerName: text("player_name").notNull(),
  score: integer("score").notNull(),
  achievedAt: timestamp("achieved_at").defaultNow().notNull(),
});

export const insertLeaderboardSchema = createInsertSchema(leaderboard).pick({
  playerId: true,
  playerName: true,
  score: true,
  achievedAt: true,
});

// Ship types reference table
export const shipTypes = pgTable("ship_types", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  displayName: text("display_name").notNull(),
  description: text("description").notNull(),
  hullStrength: integer("hull_strength").notNull(),
  armor: integer("armor").notNull(),
  cargoCapacity: integer("cargo_capacity").notNull(),
  speed: integer("speed").notNull(),
  cannonCount: integer("cannon_count").notNull(),
  cannonDamage: integer("cannon_damage").notNull(),
  cannonReload: integer("cannon_reload").notNull(),
  repairCost: integer("repair_cost").notNull(),
  isPaid: boolean("is_paid").notNull().default(false),
});

// Ports reference table
export const ports = pgTable("ports", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  x: integer("x").notNull(),
  y: integer("y").notNull(),
  z: integer("z").notNull(),
  safeRadius: integer("safe_radius").notNull().default(200),
});

// Goods reference table
export const goods = pgTable("goods", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  basePrice: integer("base_price").notNull(),
  fluctuation: integer("fluctuation").notNull(), // Price fluctuation percentage
});

// Port goods - links ports with goods and their current prices
export const portGoods = pgTable("port_goods", {
  id: serial("id").primaryKey(),
  portId: integer("port_id").references(() => ports.id).notNull(),
  goodId: integer("good_id").references(() => goods.id).notNull(),
  currentPrice: integer("current_price").notNull(),
  stock: integer("stock").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => {
  return {
    // Each port should have unique goods
    portGoodUnique: unique().on(table.portId, table.goodId),
  };
});

// Player inventory - what goods each player has
export const playerInventory = pgTable("player_inventory", {
  playerId: integer("player_id").references(() => players.id).notNull(),
  goodId: integer("good_id").references(() => goods.id).notNull(),
  quantity: integer("quantity").notNull().default(0),
}, (table) => {
  return {
    pk: primaryKey(table.playerId, table.goodId),
  };
});

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type Player = typeof players.$inferSelect;
export type InsertPlayer = z.infer<typeof insertPlayerSchema>;

export type Leaderboard = typeof leaderboard.$inferSelect;
export type InsertLeaderboard = z.infer<typeof insertLeaderboardSchema>;

export type ShipType = typeof shipTypes.$inferSelect;
export type Port = typeof ports.$inferSelect;
export type Good = typeof goods.$inferSelect;
export type PortGood = typeof portGoods.$inferSelect;
export type PlayerInventory = typeof playerInventory.$inferSelect;
