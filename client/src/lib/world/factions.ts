/**
 * NPC2: client-side faction presentation for NPC nameplates and flags (pure).
 * Faction ids are WORLD_SPEC §8 (server/game/npc/factions.ts); unknown ids get a neutral colour.
 */
import { SHIP_DISPLAY_NAMES } from '@shared/gameConstants';

/** Flag colours: main field and a stripe/accent. */
export const FACTION_FLAG_COLORS: Record<string, { field: string; accent: string }> = {
  england: { field: '#ffffff', accent: '#c8102e' }, // St George's cross
  spain: { field: '#f1bf00', accent: '#aa151b' },
  france: { field: '#ffffff', accent: '#1f3a93' }, // white ensign, royal blue trim
  portugal: { field: '#ffffff', accent: '#00529b' },
  netherlands: { field: '#21468b', accent: '#ae1c28' },
  pirates: { field: '#111111', accent: '#f5f5f5' }, // the black flag
  merchants_guild: { field: '#2e7d32', accent: '#ffd54f' },
  // New Horizons phase 2 (2026-10-24). Russia is a fighting faction (St Andrew's ensign: white, blue saltire);
  // the others are display-only (port cards, city flags): the field + cross reads as their Nordic crosses.
  russia: { field: '#ffffff', accent: '#2a5aa8' },
  sweden: { field: '#2f6fc0', accent: '#f2c230' },
  denmark_norway: { field: '#c63a3a', accent: '#ffffff' },
  hawaii: { field: '#c8202a', accent: '#f4f1ea' },
};

const NEUTRAL = { field: '#9e9e9e', accent: '#424242' };

export function factionFlagColors(faction: string | undefined): { field: string; accent: string } {
  return (faction && FACTION_FLAG_COLORS[faction]) || NEUTRAL;
}

/** Ship class name without the article ("Galleon", "Man-o'-War"). */
export function shipClassName(shipType: string): string {
  const n = (SHIP_DISPLAY_NAMES as Record<string, string>)[shipType];
  return n ? n.replace(/^The\s+/, '') : shipType;
}

/** Nameplate title line for an NPC: "Spanish Navy — Galleon". */
export function npcNameplate(title: string | undefined, shipType: string): string {
  const cls = shipClassName(shipType);
  return title ? `${title} — ${cls}` : cls;
}
