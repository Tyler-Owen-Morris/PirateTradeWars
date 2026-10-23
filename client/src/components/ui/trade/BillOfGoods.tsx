/**
 * The trade screen: the port's BILL OF GOODS on the harbourmaster's counter (2026-10-23; replaces TradeMenu).
 *
 * Design: docs/design/STYLE_GUIDE.md (rules) and docs/proposals/trade-redesign/ (PROPOSAL.md, prototype.html).
 * Styles: client/src/styles/trade.css. Pure rules: lib/trade/logic.ts (tested). Sounds: lib/trade/sounds.ts.
 *
 * - One ledger ("price current"): every good with what the port sells at and pays, grouped by GOOD_GROUPS.
 *   Pressing a price chooses `{good, side}` (the ONE selection). Pointer re-press clears; keyboard only chooses.
 * - The bill of sale (right on desktop/landscape, below on phones) holds the amount (stepper, 1/10/Max chips,
 *   slider on desktop), the limit, the purse/hold preview, and the single brass Sign button.
 * - Requests carry a `ref`; the screen is locked while one is out (`pending`) and unlocks on the matching
 *   `tradeResult` (or upgrade/repair reply), or after 5 s with a "no word" note.
 * - "Sell the whole hold" and the refit are two-step: the real confirm appears in a different place and
 *   ignores taps for 400 ms.
 * - Accessibility: focus trap, roving tabindex in the ledger, focus restored after re-renders, one persistent
 *   live region, aria-describedby for reasons.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { useGameState } from "@/lib/stores/useGameState";
import { useSocket, onTradeEvent, type TradeEvent } from "@/lib/stores/useSocket";
import { GOODS, SHIP_DISPLAY_NAMES, SHIP_STATS, SHIP_UPGRADE_PATH } from "@shared/gameConstants";
import { factionFlagColors } from "@/lib/world/factions";
import { KNOTS_PER_SPEED_UNIT } from "@/lib/nav";
import {
  buildLedger, groupLedger, limitFor, limitLine, rowSide, isCheap, paysWell, refusalText, selReducer, initialSel, fmt,
  FILTERS, type Filter, type LedgerGood, type PortGoodRow, type Side, type Purse,
} from "@/lib/trade/logic";
import { playTradeCue } from "@/lib/trade/sounds";

const GUARD_MS = 400;
const TIMEOUT_MS = 5000;
const REFRESH_MS = 30000;
let refSeq = 0;
const nextRef = () => (refSeq = (refSeq % 2_000_000_000) + 1);

type Pending = { ref?: number; kind: "trade" | "sellAll" | "repair" | "upgrade"; goodId?: number; side?: Side };
type Status = { kind: "ok" | "err"; text: string; side?: Side } | null;

const NATION: Record<string, string> = { england: "English", spain: "Spanish", france: "French", netherlands: "Dutch", portugal: "Portuguese" };
const REGION: Record<string, string> = {
  caribbean: "the Caribbean", north_atlantic: "the North Atlantic", europe: "Europe", africa: "Africa",
  indian_ocean: "the Indian Ocean", east_asia: "the East Indies", americas_pacific: "the Pacific coast",
};
const shipName = (t: string) => ((SHIP_DISPLAY_NAMES as Record<string, string>)[t] ?? t).replace(/^The\s+/, "");
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function Num({ n }: { n: number }) {
  return <span className="ptw-num">{fmt(n)}</span>;
}
function XIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" fill="none" /></svg>;
}
function WaxBlob() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 1.5c2 .3 2.6 1.6 4.3 1.9 1.9.4 3.6 2 3.4 4 .1 1.6 1.2 2.5.6 4.3-.6 1.9-2.4 2.3-3 4-.6 1.7-2.6 2.6-4.6 2.4-1.7.2-2.7 1-4.4.2-1.6-.8-1.8-2.4-3.2-3.5C1.6 13.6.9 12 1.4 10.2c.4-1.5-.3-2.8.6-4.3C3 4.3 4.6 4.1 5.8 2.9 7 1.7 8.3 1.3 10 1.5z" fill="#8e1a14" />
      <circle cx="10" cy="10" r="5" fill="none" stroke="#540a08" strokeWidth="1.2" />
    </svg>
  );
}
function Hand() {
  return <svg className="tb-hand" viewBox="0 0 26 18" aria-hidden="true"><path d="M1 6h9l2-3h3l-1 3h10a1.5 1.5 0 010 3h-7v1h5a1.5 1.5 0 010 3h-5v1h4a1.4 1.4 0 010 2.8H12c-3 0-5-1.5-6-3.8H1z" fill="currentColor" /></svg>;
}
function Quill() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 3C12 4 7 9 5 17l-2 4 4-2c8-2 12-7 13-16zM6 18l7-8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>;
}

/** Purse figure that rolls to a new value (450 ms; instant under reduced motion). */
function useRolled(value: number): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reducedMotion() || from.current === value) { from.current = value; setShown(value); return; }
    const a = from.current, t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 450);
      setShown(Math.round(a + (value - a) * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(step); else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); from.current = value; };
  }, [value]);
  return shown;
}

export default function BillOfGoods() {
  const { gameState, nearPortId, setIsTrading, loadPlayerInventory } = useGameState();
  const { sendTrade, sendSellAll, sendUpgradeShip, sendRepairShip } = useSocket();
  const player = gameState.player;
  const port = gameState.ports.find((p) => p.id === nearPortId) ?? null;
  const portId = port?.id ?? null;

  const [tab, setTab] = useState<"goods" | "yard">("goods");
  const [filter, setFilter] = useState<Filter>("all");
  const [portGoods, setPortGoods] = useState<PortGoodRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [sel, dispatch] = useReducer(selReducer, initialSel);
  const [order, setOrder] = useState<"repair" | "upgrade" | null>(null);
  const [arm, setArm] = useState<{ kind: "sellAll" | "refit"; at: number } | null>(null);
  const [armReady, setArmReady] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [cur, setCur] = useState<{ row: number; col: Side }>({ row: 0, col: "buy" });
  const [keysOpen, setKeysOpen] = useState(false);
  const [stamps, setStamps] = useState<{ key: number; goodId: number; side: Side }[]>([]);
  const [flash, setFlash] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const lastFk = useRef<string | null>(null);
  const focusNext = useRef<string | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const resetAfter = useRef(false);
  pendingRef.current = pending;
  const locked = !!pending;

  // ------------------------------------------------------------------ data
  const loadGoods = useCallback(async () => {
    if (portId == null) return;
    try {
      const r = await fetch(`/api/ports/${portId}/goods`);
      if (!r.ok) throw new Error(String(r.status));
      const rows = await r.json();
      if (!Array.isArray(rows)) throw new Error("bad goods");
      setPortGoods(rows);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [portId]);

  useEffect(() => {
    void loadGoods();
    if (player?.id) void loadPlayerInventory(player.id);
    const t = window.setInterval(() => { if (!pendingRef.current) void loadGoods(); }, REFRESH_MS);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadGoods]);

  const ledger = useMemo(() => buildLedger(GOODS, portGoods ?? [], gameState.inventory as never), [portGoods, gameState.inventory]);
  const purse: Purse = { gold: player?.gold ?? 0, used: player?.cargoUsed ?? 0, cap: player?.cargoCapacity ?? 0 };
  const visible = useMemo(() => ledger.filter(FILTERS.find((f) => f.id === filter)!.test), [ledger, filter]);
  const sections = useMemo(() => groupLedger(visible), [visible]);
  const flat = useMemo(() => sections.flatMap((s) => s.goods), [sections]);
  const selGood = sel.sel ? ledger.find((g) => g.id === sel.sel!.goodId) ?? null : null;
  const lim = selGood && sel.sel ? limitFor(selGood, sel.sel.side, purse) : null;
  const gold = useRolled(purse.gold);

  // After a successful trade: keep the line if more can be traded (default amount), else clear.
  useEffect(() => {
    if (!resetAfter.current) return;
    resetAfter.current = false;
    dispatch({ type: "reset", good: selGood, purse });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledger, purse.gold, purse.used]);

  // ------------------------------------------------------------------ requests
  const close = useCallback(() => {
    if (pendingRef.current) return;
    setIsTrading(false);
  }, [setIsTrading]);

  const startPending = (p: Pending) => {
    setPending(p);
    setStatus(null);
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      if (!pendingRef.current) return;
      setPending(null);
      playTradeCue("err");
      setStatus({ kind: "err", text: "No word from the harbourmaster. Check your purse and hold before you try again." });
      void loadGoods();
      if (player?.id) void loadPlayerInventory(player.id);
    }, TIMEOUT_MS);
  };
  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const addStamp = (goodId: number, side: Side) => {
    const key = Date.now() + Math.random();
    setStamps((s) => [...s, { key, goodId, side }]);
    window.setTimeout(() => setStamps((s) => s.filter((x) => x.key !== key)), 2000);
  };

  useEffect(() => onTradeEvent((e: TradeEvent) => {
    const p = pendingRef.current;
    if (!p) return;
    if (e.type === "tradeResult") {
      if (p.ref === undefined || e.ref !== p.ref) return;   // not ours (or stale)
      window.clearTimeout(timerRef.current);
      setPending(null);
      void loadGoods();
      if (!e.ok) {
        playTradeCue("err");
        setStatus({ kind: "err", text: refusalText(e.code, e.message) });
        return;
      }
      if (e.action === "sellAll") {
        playTradeCue("sell");
        const n = (e.lines ?? []).reduce((a, l) => a + l.quantity, 0);
        setStatus({ kind: "ok", side: "sell", text: `Entered in the ledger: sold the whole hold, ${n} units, for ${fmt(e.total ?? 0)} g.` });
        (e.lines ?? []).forEach((l) => addStamp(l.goodId, "sell"));
        setArm(null);
        dispatch({ type: "clear" });
        return;
      }
      const side = e.action as Side;
      const name = GOODS.find((g) => g.id === e.good)?.name ?? "goods";
      playTradeCue(side);
      setStatus({ kind: "ok", side, text: `Entered in the ledger: ${side === "buy" ? "bought" : "sold"} ${e.quantity} ${name} for ${fmt(e.total ?? 0)} g.` });
      if (e.good) addStamp(e.good, side);
      resetAfter.current = true;
      setFlash(0);
      return;
    }
    if (p.kind !== "repair" && p.kind !== "upgrade") return;
    window.clearTimeout(timerRef.current);
    setPending(null);
    if (e.type === "error") {
      playTradeCue("err");
      setStatus({ kind: "err", text: refusalText(e.message === "Too far from port" ? "too_far" : undefined, e.message) });
      return;
    }
    playTradeCue("sell");
    setStatus({ kind: "ok", text: e.type === "repairSuccess" ? "The shipwright has made the hull good." : `Refit signed: your ${shipName(e.newShipType).toLowerCase()} is ready.` });
    setOrder(null);
    setArm(null);
  }), [loadGoods]);

  // Sailing out of the harbour closes the counter (the server would refuse anyway).
  useEffect(() => {
    if (gameState.isNearPort || pending) return;
    setStatus({ kind: "err", text: "You have sailed out of the harbour." });
    const t = window.setTimeout(() => setIsTrading(false), 2000);
    return () => window.clearTimeout(t);
  }, [gameState.isNearPort, pending, setIsTrading]);

  // ------------------------------------------------------------------ actions
  const choose = (good: LedgerGood, side: Side, via: "pointer" | "keyboard") => {
    if (locked || tab !== "goods") return;
    const wasSame = sel.sel && sel.sel.goodId === good.id && sel.sel.side === side;
    dispatch({ type: "choose", good, side, via, purse });
    setFlash(0);
    setArm(null);
    setStatus(null);
    const i = flat.findIndex((g) => g.id === good.id);
    if (i >= 0) setCur({ row: i, col: side === "buy" && good.buyPrice === null ? "sell" : side });
    if (!wasSame) playTradeCue("tick");
    focusNext.current = `c:${side === "buy" && good.buyPrice === null ? "sell" : side}:${good.id}`;
  };
  const clearSel = () => {
    if (locked) return;
    dispatch({ type: "clear" });
    setOrder(null);
    setArm(null);
    setStatus(null);
  };
  const setQty = (v: number) => { if (lim && !locked) dispatch({ type: "set", qty: v, max: lim.max }); };
  const confirmTrade = () => {
    if (!sel.sel || !selGood || !lim || locked || portId == null) return;
    const q = sel.qty;
    // Never trade a number other than the one shown in the box.
    if (q === null || q < 1 || q > lim.max || (qtyRef.current && Number(qtyRef.current.value) !== q)) return;
    const side = sel.sel.side;
    const price = side === "buy" ? selGood.buyPrice! : selGood.sellPrice;
    const ref = nextRef();
    if (!sendTrade(portId, side, selGood.id, q, { ref, expectedPrice: price })) return;
    startPending({ ref, kind: "trade", goodId: selGood.id, side });
  };
  const armIt = (kind: "sellAll" | "refit") => {
    setArm({ kind, at: Date.now() });
    setArmReady(false);
    window.setTimeout(() => setArmReady(true), GUARD_MS);
  };
  const sellAll = () => {
    if (!arm || arm.kind !== "sellAll" || !armReady || locked || portId == null) return;
    const lines = ledger.filter((g) => g.held > 0).map((g) => ({ goodId: g.id, quantity: g.held, expectedPrice: g.sellPrice }));
    if (!lines.length) return;
    const ref = nextRef();
    if (!sendSellAll(portId, ref, lines)) return;
    startPending({ ref, kind: "sellAll" });
  };
  const runOrder = (kind: "repair" | "upgrade") => {
    if (locked || portId == null) return;
    if (kind === "upgrade" && (!arm || arm.kind !== "refit" || !armReady)) return;
    if (!(kind === "repair" ? sendRepairShip(portId) : sendUpgradeShip(portId))) return;
    startPending({ kind });
  };
  const switchTab = (t: "goods" | "yard") => {
    if (locked || t === tab) return;
    setTab(t);
    dispatch({ type: "clear" });
    setOrder(null);
    setArm(null);
    setStatus(null);
    setCur({ row: 0, col: "buy" });
    focusNext.current = `tab:${t}`;
  };
  const changeFilter = (f: Filter) => {
    if (locked) return;
    setFilter(f);
    setCur({ row: 0, col: "buy" });
  };
  /** Roving focus in the ledger. With a line chosen, the choice follows the focus (keeping the side). */
  const moveCur = (dRow: number, col?: Side) => {
    if (!flat.length) return;
    const row = Math.max(0, Math.min(flat.length - 1, cur.row + dRow));
    let c: Side = col ?? cur.col;
    if (c === "buy" && flat[row].buyPrice === null) { if (col === "buy") return; c = "sell"; }
    setCur({ row, col: c });
    focusNext.current = `c:${c}:${flat[row].id}`;
    if (sel.sel && !locked) {
      dispatch({ type: "choose", good: flat[row], side: c, via: "keyboard", purse });
      setStatus(null);
    }
  };

  // ------------------------------------------------------------------ keyboard + focus
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {});
  onKey.current = (e: KeyboardEvent) => {
    const root = rootRef.current;
    if (!root) return;
    const t = e.target as HTMLElement;
    if (e.key === "Tab") {
      const els = Array.from(root.querySelectorAll<HTMLElement>("button, input, select, [tabindex='0']"))
        .filter((el) => !(el as HTMLButtonElement).disabled && el.offsetParent !== null && el.tabIndex >= 0);
      if (!els.length) return;
      const first = els[0], last = els[els.length - 1];
      if (!root.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key, lk = k.toLowerCase();
    const inQty = t?.id === "tb-qty", inRange = t?.classList?.contains("tb-range"), inSel = t?.tagName === "SELECT";
    if (k === "Escape") {
      e.preventDefault();
      if (locked) { setStatus({ kind: "ok", text: "The clerk is still writing. One moment." }); return; }
      if (keysOpen) { setKeysOpen(false); focusNext.current = "keys"; return; }
      if (arm) { setArm(null); return; }
      if (sel.sel || order) { clearSel(); focusNext.current = "ledger"; return; }
      close();
      return;
    }
    if (locked) { if (k === "Enter" || k === " ") e.preventDefault(); return; }
    if (k === "Enter") {
      if (t?.closest?.(".ptw-slip button, .ptw-knob, .tb-keynote, .tb-tools")) return;   // those keep their own Enter
      e.preventDefault();
      if (tab === "goods" && sel.sel) return confirmTrade();
      if (t?.classList?.contains("ptw-cell")) { const g = ledger.find((x) => x.id === Number(t.dataset.id)); if (g) choose(g, t.dataset.side as Side, "keyboard"); }
      return;
    }
    if (inSel || inRange) return;
    if (k === " " && t?.classList?.contains("ptw-cell")) {
      e.preventDefault();
      const g = ledger.find((x) => x.id === Number(t.dataset.id));
      if (g) choose(g, t.dataset.side as Side, "keyboard");
      return;
    }
    if (inQty) return;
    if (lk === "t") { e.preventDefault(); return close(); }
    if (k === "1") return switchTab("goods");
    if (k === "2") return switchTab("yard");
    if (tab !== "goods") return;
    if (k === "ArrowDown" || k === "ArrowUp") { e.preventDefault(); return moveCur(k === "ArrowDown" ? 1 : -1); }
    if ((k === "ArrowLeft" || k === "ArrowRight") && t?.closest?.(".tb-ledger")) { e.preventDefault(); return moveCur(0, k === "ArrowLeft" ? "buy" : "sell"); }
    if ((k === "+" || k === "=" || k === "-" || k === "_") && sel.sel && lim) {
      e.preventDefault();
      const d = k === "+" || k === "=" ? 1 : -1;
      return setQty((sel.qty ?? 0) + d * (e.shiftKey ? 10 : 1));
    }
    if (lk === "b" || lk === "s") {   // B / S only CHOOSE a side; they never clear
      const g = selGood ?? flat[cur.row];
      if (g) choose(g, lk === "b" ? "buy" : "sell", "keyboard");
      return;
    }
    if (lk === "m" && sel.sel && lim) return setQty(lim.max);
  };
  useEffect(() => {
    const f = (e: KeyboardEvent) => onKey.current(e);
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, []);

  // Focus: requested target first; otherwise, if a re-render dropped focus, restore it.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const want = focusNext.current;
    focusNext.current = null;
    const find = (fk: string | null) => (fk ? root.querySelector<HTMLElement>(`[data-fk="${CSS.escape(fk)}"]`) : null);
    const usable = (el: HTMLElement | null) => !!el && !(el as HTMLButtonElement).disabled && el.offsetParent !== null;
    let el = want === "ledger" ? root.querySelector<HTMLElement>(".tb-ledger [tabindex='0']") : find(want);
    if (!usable(el) && root.contains(document.activeElement) && document.activeElement !== document.body) return;
    if (!usable(el)) el = find(lastFk.current);
    if (!usable(el) && sel.sel) el = find(`c:${sel.sel.side}:${sel.sel.goodId}`);
    if (!usable(el)) el = root.querySelector<HTMLElement>("#tb-sign:not(:disabled)") ?? root.querySelector<HTMLElement>(".tb-ledger [tabindex='0']");
    if (el && document.activeElement !== el) el.focus({ preventScroll: true });
  });
  // Keep the chosen line in view (the slip can grow and cover it on phones).
  useEffect(() => {
    if (!sel.sel) return;
    const row = rootRef.current?.querySelector(`[data-row="${sel.sel.goodId}"]`);
    row?.scrollIntoView?.({ block: "nearest" });
  }, [sel.sel, status]);

  if (!player || !port) return null;

  // ------------------------------------------------------------------ render helpers
  const flag = factionFlagColors(port.nation);
  const nationWord = port.nation === "pirates" ? null : NATION[port.nation ?? ""];
  const regionWord = REGION[(port as { region?: string }).region ?? ""] ?? "the open sea";
  const used = purse.used, cap = purse.cap;
  const after = tab === "goods" && sel.sel && sel.qty ? (sel.sel.side === "buy" ? used + sel.qty : used - sel.qty) : used;
  const cells = Array.from({ length: Math.max(0, Math.min(cap, 100)) }, (_, i) => {
    const per = cap > 50 ? 2 : 1, unit = i * per;
    if (unit >= cap) return null;
    return <i key={i} className={unit < Math.min(used, after) ? "f" : unit < used ? "r" : unit < after ? "p" : ""} />;
  }).filter(Boolean).slice(0, cap > 50 ? Math.ceil(cap / 2) : cap);

  const cell = (g: LedgerGood, side: Side, i: number) => {
    if (side === "buy" && g.buyPrice === null) return <span className="tb-nosale">not sold<br />here</span>;
    if (side === "sell" && g.untraded) return <span className="tb-nosale">not<br />traded</span>;
    const L = limitFor(g, side, purse);
    const price = side === "buy" ? g.buyPrice! : g.sellPrice;
    let cls = "", note = "";
    if (side === "buy" && !L.max) { cls = "blocked"; note = L.short ?? ""; }
    else if (side === "buy" && g.stock < 10) note = `${g.stock} left`;
    if (side === "sell" && L.idle) cls = "idle";
    const pressed = !!sel.sel && sel.sel.goodId === g.id && sel.sel.side === side;
    const isCur = cur.row === i && cur.col === side;
    const nid = `tb-n-${side}-${g.id}`;
    return (
      <button
        className={`ptw-cell ${cls}`}
        data-fk={`c:${side}:${g.id}`}
        data-id={g.id}
        data-side={side}
        tabIndex={isCur ? 0 : -1}
        aria-pressed={pressed}
        aria-disabled={locked || undefined}
        aria-describedby={note ? nid : undefined}
        aria-label={`${side === "buy" ? "Buy" : "Sell"} ${g.name} at ${price} gold${side === "sell" ? (g.held ? `, ${g.held} aboard` : ", none aboard") : ""}`}
        onClick={(ev) => { ev.stopPropagation(); choose(g, side, "pointer"); }}
      >
        <span className="fig ptw-num">{fmt(price)}</span>
        {note && <span className="note" id={nid}>{note}</span>}
      </button>
    );
  };

  const row = (g: LedgerGood, i: number) => {
    const chosen = !!sel.sel && sel.sel.goodId === g.id;
    const detail = [g.held ? `${g.held} aboard${g.paid !== undefined ? ` · paid ${fmt(g.paid)}` : ""}` : "", g.wanted ? "wanted" : "", !g.held && isCheap(g) ? "cheap here" : "", !g.held && paysWell(g) ? "pays well" : ""].filter(Boolean).join(" · ");
    return (
      <div key={g.id} className={`tb-row${chosen ? " is-sel" : ""}`} data-row={g.id}
        onClick={() => choose(g, rowSide(g), "keyboard")}>
        <Hand />
        <div className="tb-gcell">
          <div className="tb-gn">
            <span className="tb-gname">{g.name}</span>
            <span className="tb-marks">
              {g.wanted && <span className="ptw-mark ptw-mark--wanted"><WaxBlob />wanted</span>}
              {isCheap(g) && <span className="ptw-mark ptw-mark--cheap">cheap here</span>}
              {paysWell(g) && <span className="ptw-mark ptw-mark--dear">pays well</span>}
            </span>
            <span className="tb-lead" aria-hidden="true" />
          </div>
          {detail && <div className="tb-detail">{detail}</div>}
        </div>
        <div className="tb-aboard">{g.held ? <><b className="ptw-num">{g.held}</b>{g.paid !== undefined && <small>paid <Num n={g.paid} /></small>}</> : <span className="none">—</span>}</div>
        {cell(g, "buy", i)}
        {cell(g, "sell", i)}
        {stamps.filter((s) => s.goodId === g.id).map((s) => (
          <span key={s.key} className={`ptw-stamp ptw-stamp--${s.side}`} aria-hidden="true">{s.side === "buy" ? "Bought" : "Sold"}</span>
        ))}
      </div>
    );
  };

  // ------------------------------------------------------------------ slip
  const statusEl = (
    <p className={`tb-status${status ? ` ${status.kind} ${status.side ?? ""}` : ""}`} aria-live="polite" aria-atomic="true">
      {status?.kind === "err" && <WaxBlob />}
      {status && <span>{status.text}</span>}
    </p>
  );

  const goodsSlip = () => {
    if (arm?.kind === "sellAll") {
      const lines = ledger.filter((g) => g.held > 0);
      const total = lines.reduce((a, g) => a + g.held * g.sellPrice, 0), n = lines.reduce((a, g) => a + g.held, 0);
      const below = lines.filter((g) => g.paid !== undefined && g.sellPrice < g.paid);
      return {
        head: <>Bill of Sale <em className="sell">— the whole hold</em></>,
        body: (
          <>
            <div className="tb-armed">
              <p>Sell everything aboard at today's prices?</p>
              <ul>{lines.map((g) => (
                <li key={g.id} className={g.paid !== undefined && g.sellPrice < g.paid ? "warn" : ""}>
                  <span>{g.name}</span><span className="tb-lead" /><span className="ptw-num">{g.held} × {g.sellPrice} = {fmt(g.held * g.sellPrice)}</span>
                </li>))}
              </ul>
              {below.length > 0 && <p className="warn">Below what you paid: {below.map((g) => `${g.name} (paid ${fmt(g.paid!)}, sells at ${g.sellPrice})`).join(", ")}.</p>}
            </div>
            <div className="tb-sfoot"><div className="tb-acts">
              <button className="tb-ink" data-fk="disarm" disabled={locked} onClick={() => setArm(null)}>Keep my cargo</button>
              <button className="tb-btn tb-wax" data-fk="sellall-confirm" disabled={!armReady || locked} onClick={sellAll}>
                {locked ? "Signing…" : <>Sign: sell <Num n={n} /> for <Num n={total} /> g</>}
              </button>
            </div></div>
          </>
        ),
      };
    }
    if (!sel.sel || !selGood || !lim) {
      const full = cap > 0 && used >= cap;
      return {
        head: <>Bill of Sale</>,
        body: (
          <>
            <p className="tb-hint">Choose a line: tap a price to buy at it or sell at it.</p>
            {full && <p className="tb-hint">Your hold is full (<Num n={used} />/<Num n={cap} />): sell before you buy.{" "}
              <button className="tb-ink" data-fk="showhold" onClick={() => changeFilter("hold")}>Show what's aboard</button></p>}
            <div className="tb-sfoot">{used > 0 && (
              <div className="tb-acts"><button className="tb-ink" data-fk="sellall-arm" disabled={locked} onClick={() => armIt("sellAll")}>Sell the whole hold…</button></div>
            )}</div>
          </>
        ),
      };
    }
    const side = sel.sel.side, g = selGood, price = side === "buy" ? g.buyPrice : g.sellPrice;
    // Written as the clerk's bill: "Bought of the Harbourmaster, Havana: / Fish, at 9 g each .... 180 g".
    const head = (
      <div className="tb-sgood">
        <span className="sr">{side === "buy" ? "Purchase:" : "Sale:"}</span>
        <span className="tb-of">{side === "buy" ? "Bought of" : "Sold to"}<span className="long"> the Harbourmaster,</span> {port.name}:</span>
        <span className="sp" />
        <button className="tb-x" data-fk="clear" aria-label="Clear selection" disabled={locked} onClick={clearSel}><XIcon /></button>
      </div>
    );
    const item = (total: number | null) => (
      <p className="tb-item">
        <b>{g.name}</b>
        <span className="each">{price !== null && <>, at <Num n={price} /> g each</>}</span>
        {total !== null && <><span className="tb-lead" aria-hidden="true" /><span key={total} className="tb-total"><Num n={total} /> g</span></>}
      </p>
    );
    const title = <>Bill of Sale <em className={side}>— {side === "buy" ? "Purchase" : "Sale"}</em></>;
    if (!lim.max) {
      return {
        head: title,
        body: (
          <>
            {head}
            {item(null)}
            <p className="tb-limit block" id="tb-limit">{lim.block}</p>
            <div className="tb-sfoot"><button id="tb-sign" className="tb-btn ptw-sign" data-fk="sign" disabled aria-describedby="tb-limit">
              {side === "buy" ? (g.buyPrice === null ? "Not sold here" : "Cannot buy") : "Nothing to sell"}
            </button></div>
          </>
        ),
      };
    }
    const q = sel.qty, max = lim.max;
    const total = q ? (price ?? 0) * q : 0;
    const goldAfter = side === "buy" ? purse.gold - total : purse.gold + total;
    const chipPressed = (v: number | "max") => q !== null && (v === "max" ? q === max : q === v && v < max);
    const profit = side === "sell" && g.paid !== undefined && q ? Math.round((g.sellPrice - g.paid) * q) : null;
    return {
      head: title,
      body: (
        <>
          {head}
          {item(q !== null ? total : null)}
          <p className="tb-sline">{side === "buy" ? <><Num n={g.stock} /> in the warehouse</> : <><Num n={g.held} /> aboard{g.paid !== undefined && <>, paid <Num n={g.paid} /> each</>}</>}</p>
          <div className="tb-qrow">
            <div className="tb-stepper" role="group" aria-label="Amount">
              <button data-fk="dec" aria-label="One fewer" disabled={locked || q === null || q <= 1} onClick={() => setQty((q ?? 1) - 1)}>−</button>
              <input
                id="tb-qty" ref={qtyRef} data-fk="qty" className="ptw-num" inputMode="numeric" pattern="[0-9]*" autoComplete="off"
                aria-label="Amount" aria-describedby="tb-limit" aria-invalid={q === null} disabled={locked}
                value={sel.text}
                onChange={(e) => {
                  const before = e.target.value.replace(/\D/g, "");
                  dispatch({ type: "typed", raw: e.target.value, max });
                  if (before !== "" && Number(before) > max) setFlash((f) => f + 1);
                }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); confirmTrade(); } }}
              />
              <button data-fk="inc" aria-label="One more" disabled={locked || (q !== null && q >= max)} onClick={() => setQty((q ?? 0) + 1)}>+</button>
            </div>
            <div className="tb-qchips" role="group" aria-label="Quick amounts">
              <button className="ptw-qchip" data-fk="q:1" aria-pressed={chipPressed(1)} disabled={locked} onClick={() => dispatch({ type: "chip", chip: 1, max })}><Num n={1} /></button>
              <button className="ptw-qchip ten" data-fk="q:10" aria-pressed={chipPressed(10)} disabled={locked || max < 10} onClick={() => dispatch({ type: "chip", chip: 10, max })}><Num n={10} /></button>
              <button className="ptw-qchip max" data-fk="q:max" aria-pressed={chipPressed("max")} disabled={locked} onClick={() => dispatch({ type: "chip", chip: "max", max })}>
                {side === "buy" ? "Max" : "All"} <Num n={max} />
              </button>
            </div>
            <input
              className="tb-range" data-fk="range" type="range" min={1} max={Math.max(max, 1)} value={q ?? 1} aria-label="Amount slider"
              disabled={locked || max < 2} style={{ ["--pct" as string]: max > 1 && q ? `${((q - 1) / (max - 1)) * 100}%` : "100%" }}
              onChange={(e) => setQty(Number(e.target.value))}
            />
          </div>
          <p key={flash} className={`tb-limit${q === null ? " block" : ""}${flash ? " flash" : ""}`} id="tb-limit">
            {q === null ? (sel.text === "" ? "Enter an amount." : "The amount must be at least 1.") : limitLine(side, lim)}
          </p>
          {q !== null && (
            <p className="tb-sum ptw-num" id="tb-sum">
              <span><i>Purse</i> <s>{fmt(purse.gold)}</s> <b>{fmt(goldAfter)}</b> g</span>
              <span><i>Hold</i> <s>{used}</s> <b>{side === "buy" ? used + q : used - q}</b> of {cap}</span>
              {profit !== null && <span><i>{profit >= 0 ? "Profit" : "Loss"}</i> <b className={profit >= 0 ? "pl-up" : "pl-dn"}>{profit >= 0 ? "+" : "−"}{fmt(Math.abs(profit))} g</b> on cost</span>}
            </p>
          )}
          <div className="tb-sfoot">
            <button id="tb-sign" className="tb-btn ptw-sign" data-fk="sign" aria-describedby="tb-limit tb-sum" aria-busy={locked || undefined}
              disabled={locked || q === null} onClick={confirmTrade}>
              {locked ? <><Quill />Signing the ledger…</> : q === null ? "Enter an amount" : <>{side === "buy" ? "Buy" : "Sell"} <Num n={q} /> {g.name} · <Num n={total} /> g</>}
            </button>
          </div>
        </>
      ),
    };
  };

  const ship = player.shipType;
  const stats = (SHIP_STATS as Record<string, (typeof SHIP_STATS)[keyof typeof SHIP_STATS]>)[ship];
  const up = SHIP_UPGRADE_PATH.find((o) => o.from === ship);
  const nextStats = up ? (SHIP_STATS as Record<string, (typeof SHIP_STATS)[keyof typeof SHIP_STATS]>)[up.to] : null;
  const dmg = Math.max(0, player.maxHp - player.hp);

  const yardSlip = () => {
    if (!order) return { head: <>Work Order</>, body: <p className="tb-hint">Choose a work order. Repairs restore the hull in full; a refit replaces your ship and keeps your cargo.</p> };
    const isRep = order === "repair";
    const cost = isRep ? stats?.repairCost ?? 0 : up?.cost ?? 0;
    const short = cost - purse.gold;
    const what = isRep ? "Repair the hull" : `Refit as a ${shipName(up?.to ?? "")}`;
    const head = (
      <div className="tb-sgood"><b>{what}</b><span className="sp" />
        <button className="tb-x" data-fk="clear" aria-label="Cancel the order" disabled={locked} onClick={clearSel}><XIcon /></button></div>
    );
    const sum = (
      <p className="tb-sum ptw-num" id="tb-sum">
        <span><i>Purse</i> <s>{fmt(purse.gold)}</s> <b>{short > 0 ? "—" : fmt(purse.gold - cost)}</b> g</span>
        {isRep ? <span><i>Hull</i> <s>{player.hp}</s> <b>{player.maxHp}</b></span> : <span><i>Hold</i> <s>{cap}</s> <b>{nextStats?.cargoCapacity}</b></span>}
      </p>
    );
    const title = <>Work Order <em className="order">— {isRep ? "repair" : "refit"}</em></>;
    if (!isRep && arm?.kind === "refit") {
      return {
        head: title,
        body: (
          <>
            {head}
            <div className="tb-armed"><p>This replaces your {shipName(ship).toLowerCase()} with a {shipName(up?.to ?? "").toLowerCase()} for <Num n={cost} /> g. It can't be undone. Your cargo stays aboard.</p></div>
            {sum}
            <div className="tb-sfoot"><div className="tb-acts">
              <button className="tb-btn tb-wax" data-fk="refit-confirm" disabled={!armReady || locked} onClick={() => runOrder("upgrade")}>{locked ? "Signing…" : <>Sign: pay <Num n={cost} /> g</>}</button>
              <button className="tb-ink" data-fk="disarm" disabled={locked} onClick={() => setArm(null)}>Keep my ship</button>
            </div></div>
          </>
        ),
      };
    }
    return {
      head: title,
      body: (
        <>
          {head}
          <p className={`tb-limit${short > 0 ? " block" : ""}`} id="tb-limit">{short > 0 ? `Your purse is ${fmt(short)} g short.` : ""}</p>
          {sum}
          <div className="tb-sfoot">
            <button id="tb-sign" className="tb-btn ptw-sign" data-fk="sign" aria-describedby="tb-limit tb-sum" aria-busy={locked || undefined}
              disabled={short > 0 || locked} onClick={() => (isRep ? runOrder("repair") : armIt("refit"))}>
              {locked ? <><Quill />Signing…</> : short > 0 ? <>Need <Num n={short} /> g more</> : isRep ? <>Pay <Num n={cost} /> g · repair</> : <>Review the refit · <Num n={cost} /> g</>}
            </button>
          </div>
        </>
      ),
    };
  };
  const slip = tab === "goods" ? goodsSlip() : yardSlip();

  const planks = 10;
  return (
    <div className="ptw-trade" ref={rootRef}
      onFocus={(e) => { const fk = (e.target as HTMLElement).dataset?.fk; if (fk) lastFk.current = fk; }}>
      <div className="ptw-trade__scrim" aria-hidden="true" />
      <section className="ptw-counter" role="dialog" aria-modal="true" aria-labelledby="tb-port" aria-describedby="tb-sub">
        <span className="ptw-nail a" /><span className="ptw-nail b" /><span className="ptw-nail c" /><span className="ptw-nail d" />
        <button className="ptw-knob" data-fk="close" aria-label="Close the trade screen" disabled={locked} onClick={close}><XIcon /></button>
        <div className="tb-pagewrap">
          <div className="ptw-ledger-page">
            <header className="tb-head">
              <svg className="tb-flag" viewBox="0 0 40 24" role="img" aria-label={nationWord ? `${nationWord} colours` : "the black flag"}>
                <defs><clipPath id="tb-pennant"><path d="M0 0H40L33 12 40 24H0Z" /></clipPath></defs>
                <g clipPath="url(#tb-pennant)"><rect width="40" height="24" fill={flag.field} /><path d="M14 0h6v24h-6zM0 9h40v6H0z" fill={flag.accent} /></g>
                <path d="M0 0H40L33 12 40 24H0Z" fill="none" stroke="#2a1a0c" strokeWidth="1" />
              </svg>
              <div className="tb-titles">
                <h1 className="tb-port" id="tb-port">{port.name}</h1>
                <p className="tb-sub" id="tb-sub">
                  <span className="long">Harbourmaster's bill of goods · {regionWord} · {nationWord ? `under ${nationWord} colours` : "a pirate haven"}</span>
                  <span className="short">{nationWord ? `${nationWord} colours` : "Pirate haven"}</span>
                </p>
              </div>
              <div className="tb-instr">
                <div className="tb-purse"><span className="tb-lab">Purse</span><b className="ptw-num">{fmt(gold)}</b><span className="ptw-num">g</span></div>
                <div className="tb-holdm">
                  <span className="tb-lab">Hold</span>
                  <span className="tb-crates" role="img" aria-label={`Hold ${used} of ${cap} used${after !== used ? `, ${after} after this trade` : ""}`}>{cells}</span>
                  <b className="ptw-num">{after !== used ? `${used}→${after}/${cap}` : `${used}/${cap}`}</b>
                </div>
              </div>
            </header>
            <div className="tb-tools">
              <div className="tb-tabs" role="tablist" aria-label="Harbour offices"
                onKeyDown={(e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); switchTab(tab === "goods" ? "yard" : "goods"); } }}>
                {(["goods", "yard"] as const).map((t) => (
                  <button key={t} className="tb-tab" role="tab" id={`tb-tab-${t}`} data-fk={`tab:${t}`} aria-selected={tab === t} aria-controls="tb-ledger"
                    tabIndex={tab === t ? 0 : -1} disabled={locked && tab !== t} onClick={() => switchTab(t)}>
                    {t === "goods" ? "Goods" : "Shipwright"}
                  </button>
                ))}
              </div>
              {tab === "goods" && (
                <div className="tb-show">
                  <span className="tb-lab">Show</span>
                  {FILTERS.map((f) => (
                    <button key={f.id} className="tb-flt" data-fk={`flt:${f.id}`} aria-pressed={filter === f.id} disabled={locked} onClick={() => changeFilter(f.id)}>
                      {f.label} <Num n={ledger.filter(f.test).length} />
                    </button>
                  ))}
                  <select className="tb-showsel" data-fk="showsel" aria-label="Show" value={filter} disabled={locked} onChange={(e) => changeFilter(e.target.value as Filter)}>
                    {FILTERS.map((f) => <option key={f.id} value={f.id}>Show: {f.label} ({ledger.filter(f.test).length})</option>)}
                  </select>
                </div>
              )}
              <button className="tb-keyslink" data-fk="keys" aria-expanded={keysOpen} aria-controls="tb-keynote" onClick={() => { setKeysOpen((o) => !o); focusNext.current = keysOpen ? "keys" : "keysclose"; }}>Keys</button>
            </div>
            <div className="tb-ledger" id="tb-ledger" role="tabpanel" aria-labelledby={`tb-tab-${tab}`}>
              {tab === "goods" ? (
                loadError && !portGoods ? (
                  <p className="tb-loading">The harbourmaster's books are closed. <button className="tb-ink" data-fk="retry" onClick={() => void loadGoods()}>Try again</button></p>
                ) : !portGoods ? (
                  <p className="tb-loading">The clerk is opening the books…</p>
                ) : (
                  <>
                    <div className="tb-colhead" aria-hidden="true">
                      <span /><span>Goods</span><span className="c-ab">Aboard</span>
                      <span><span className="hl">You buy</span><span className="hs">Buy</span></span>
                      <span><span className="hl">You sell</span><span className="hs">Sell</span></span>
                    </div>
                    {(() => { let i = 0; return sections.map((s) => (
                      <section key={s.id} className="tb-gsec" aria-label={s.label}>
                        <div className="tb-grp" aria-hidden="true">{s.label}{s.note && <small>{s.note}</small>}</div>
                        {s.goods.map((g) => row(g, i++))}
                      </section>
                    )); })()}
                    <p className="tb-end">{flat.length ? "The port buys every good it trades. Prices are per unit; one unit fills one space in the hold." : "Nothing on this page of the ledger."}</p>
                  </>
                )
              ) : (
                <div className="tb-yard">
                  <article className={`ptw-order${order === "repair" ? " is-sel" : ""}`}>
                    <h3>Caulk &amp; patch the hull</h3>
                    <div className="tb-planks" role="img" aria-label={`Hull ${player.hp} of ${player.maxHp}`}>
                      {Array.from({ length: planks }, (_, k) => <i key={k} className={(k + 1) * (player.maxHp / planks) <= player.hp + 0.01 ? "" : "broken"} />)}
                    </div>
                    <p>Hull <Num n={player.hp} /> of <Num n={player.maxHp} />{dmg ? <>: <Num n={dmg} /> to make good.</> : ". Sound."}</p>
                    <div className="tb-oact">
                      <span className="tb-cost ptw-num">{fmt(stats?.repairCost ?? 0)} g</span>
                      <button className="tb-ochoose" data-fk="o:repair" aria-pressed={order === "repair"} disabled={!dmg || locked}
                        onClick={() => { setOrder(order === "repair" ? null : "repair"); setArm(null); setStatus(null); }}>{dmg ? "Order repair" : "Nothing to mend"}</button>
                    </div>
                  </article>
                  <article className={`ptw-order${order === "upgrade" ? " is-sel" : ""}`}>
                    {up && nextStats && stats ? (
                      <>
                        <h3>Refit as a {shipName(up.to)}</h3>
                        <table>
                          <thead><tr><th /><th>{shipName(ship)}</th><th>{shipName(up.to)}</th></tr></thead>
                          <tbody className="ptw-num">
                            <tr><td>Hold</td><td>{stats.cargoCapacity}</td><td><b>{nextStats.cargoCapacity}</b></td></tr>
                            <tr><td>Hull</td><td>{stats.hullStrength}</td><td><b>{nextStats.hullStrength}</b></td></tr>
                            <tr><td>Guns</td><td>{stats.cannonCount}</td><td><b>{nextStats.cannonCount}</b></td></tr>
                            <tr><td>Speed (kn)</td><td>{(stats.speed * KNOTS_PER_SPEED_UNIT).toFixed(1)}</td><td><b>{(nextStats.speed * KNOTS_PER_SPEED_UNIT).toFixed(1)}</b></td></tr>
                            <tr><td>Repair cost</td><td>{stats.repairCost}</td><td><b>{nextStats.repairCost}</b></td></tr>
                          </tbody>
                        </table>
                        <p>Your cargo stays aboard.</p>
                        <div className="tb-oact">
                          <span className="tb-cost ptw-num">{fmt(up.cost)} g</span>
                          <button className="tb-ochoose" data-fk="o:upgrade" aria-pressed={order === "upgrade"} disabled={locked}
                            onClick={() => { setOrder(order === "upgrade" ? null : "upgrade"); setArm(null); setStatus(null); }}>Order refit</button>
                        </div>
                      </>
                    ) : (
                      <><h3>No finer ship</h3><p>You command the mightiest ship on the seas.</p></>
                    )}
                  </article>
                </div>
              )}
            </div>
            {keysOpen && (
              <aside className="tb-keynote" id="tb-keynote" aria-label="Keyboard">
                <button data-fk="keysclose" aria-label="Hide the keyboard note" onClick={() => { setKeysOpen(false); focusNext.current = "keys"; }}><XIcon /></button>
                <b>At the counter</b><br />
                <span className="k">↑↓</span>line · <span className="k">←→</span>buy / sell column<br />
                <span className="k">B</span>buy · <span className="k">S</span>sell (this line)<br />
                <span className="k">+</span><span className="k">−</span>amount (Shift: 10) · <span className="k">M</span>max<br />
                <span className="k">Enter</span>sign · <span className="k">Esc</span>back · <span className="k">1</span><span className="k">2</span>offices
              </aside>
            )}
          </div>
        </div>
        <div className="tb-slipwrap">
          {/* the wax dab that holds the bill of sale to the counter (decorative) */}
          <span className="tb-dab" aria-hidden="true" />
          <div className="ptw-slip">
            <h2 className="tb-slip-h">{slip.head}</h2>
            <div className="tb-slipbody">{slip.body}</div>
            {statusEl}
          </div>
        </div>
      </section>
    </div>
  );
}
