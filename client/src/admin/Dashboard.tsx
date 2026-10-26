/**
 * Harbour Master dashboard (draft "Main"): tiles, world chart, captains table, selected-captain panel
 * with the admin actions, and the admin log. Polls GET /api/admin/state every second while the tab is
 * visible (paused when hidden, refreshed at once when it comes back). A 401 anywhere = signed out.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MAX_ADMIN_GOLD, type AdminActionName, type AdminPlayerRow, type AdminStateResponse } from "@shared/adminApi";
import { adminApi } from "./api";
import { FILTERS, STATUS, clock, fmt, formatDuration, hpColor, mapPos, matchesFilter, parseGold, type FilterKey } from "./format";

const POLL_MS = 1000;
/** Custom gold above this asks for confirmation (owner's call: keep everything else one click). */
const CONFIRM_GOLD_ABOVE = 100_000;

type Conn = "connecting" | "live" | "stale" | "paused";
type Result = { ok: boolean; text: string } | null;

function usePolledState(onSignedOut: () => void) {
  const [data, setData] = useState<AdminStateResponse | null>(null);
  const [conn, setConn] = useState<Conn>("connecting");
  const signedOut = useRef(onSignedOut);
  signedOut.current = onSignedOut;

  useEffect(() => {
    let stopped = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      if (stopped || inFlight) return;
      if (document.hidden) {
        setConn("paused");
        return;
      }
      inFlight = true;
      try {
        const r = await adminApi.state();
        if (stopped) return;
        if (r.ok) {
          setData(r.body);
          setConn("live");
        } else if (r.status === 401 || r.status === 404) {
          stopped = true;
          signedOut.current();
          return;
        } else {
          setConn("stale");
        }
      } catch {
        if (!stopped) setConn("stale");
      } finally {
        inFlight = false;
      }
      if (!stopped && !document.hidden) timer = setTimeout(poll, POLL_MS);
      else if (!stopped) setConn("paused");
    };

    const onVisibility = () => {
      if (document.hidden) {
        clearTimeout(timer);
        setConn("paused");
      } else {
        clearTimeout(timer);
        void poll();
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return { data, setData, conn };
}

const LIVE_TEXT: Record<Conn, [string, string]> = {
  connecting: ["#a8a294", "Connecting..."],
  live: ["#6fd08c", "Live · updated every second"],
  stale: ["#ff8a6b", "Connection lost · retrying"],
  paused: ["#a8a294", "Paused while this tab is hidden"],
};

export default function Dashboard({ onSignedOut }: { onSignedOut: () => void }) {
  const { data, setData, conn } = usePolledState(onSignedOut);
  const [selId, setSelId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const [customGold, setCustomGold] = useState("");
  const lastSel = useRef<AdminPlayerRow | null>(null);

  const captains = data?.captains ?? [];
  const now = data?.now ?? Date.now();
  const live = captains.find((c) => c.id === selId) ?? null;
  if (live) lastSel.current = live;
  const sel = live ?? (selId && lastSel.current?.id === selId ? lastSel.current : null);
  const selGone = !!sel && !live;

  // Select the first captain once there is one (and nothing is selected).
  useEffect(() => {
    if (!selId && captains.length) setSelId(captains[0].id);
  }, [selId, captains]);

  const pick = useCallback((id: string) => {
    setSelId(id);
    setResult(null);
  }, []);

  const signOut = async () => {
    try {
      await adminApi.logout();
    } catch {
      /* the cookie is cleared server-side when reachable; either way leave the dashboard */
    }
    onSignedOut();
  };

  const run = async (action: AdminActionName, amount?: number) => {
    if (!sel || selGone || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await adminApi.action(sel.id, action, amount);
      if (r.ok) {
        const row = r.body.row;
        setData((d) => (d ? { ...d, captains: d.captains.map((c) => (c.id === row.id ? row : c)), log: r.body.log } : d));
        setResult({ ok: true, text: r.body.warning ? `${r.body.text}. ${r.body.warning}` : r.body.text });
        if (action === "gold" && amount !== undefined && String(amount) === customGold.replace(/[,_\s]/g, "")) setCustomGold("");
      } else if (r.status === 401) {
        onSignedOut();
      } else {
        setResult({ ok: false, text: r.body?.message ?? "That didn't work. Try again." });
      }
    } catch {
      setResult({ ok: false, text: "Can't reach the server." });
    } finally {
      setBusy(false);
    }
  };

  const giveCustom = () => {
    const g = parseGold(customGold, MAX_ADMIN_GOLD);
    if (!g.ok) return setResult({ ok: false, text: g.error });
    if (g.amount > CONFIRM_GOLD_ABOVE && sel && !window.confirm(`Give ${sel.name} ${fmt(g.amount)} gold?`)) return;
    void run("gold", g.amount);
  };

  const visible = useMemo(() => captains.filter((c) => matchesFilter(c, filter)), [captains, filter]);
  const today = data?.today;
  const socialLine = today?.socialBreakdown.filter((s) => s.captains > 0).map((s) => `${s.source} ${s.captains}`).join(" · ");
  const playedPct = today && today.socialVisits > 0 ? Math.round((today.socialCaptains / today.socialVisits) * 100) : null;
  const npcCount = data ? data.npcRecords ?? data.npcShips : 0;
  const [dotColor, liveText] = LIVE_TEXT[conn];
  const actionsDisabled = !sel || selGone || busy;

  return (
    <>
      <header className="hm-header">
        <div className="hm-brand">
          <h1 className="hm-title" style={{ fontSize: 34 }}>Harbour Master</h1>
          <span className="muted">Pirate Trade Wars admin</span>
        </div>
        <div className="hm-live" role="status" aria-live="polite">
          <span aria-hidden="true" className="hm-dot" style={{ background: dotColor, boxShadow: conn === "live" ? "0 0 0 4px rgba(111,208,140,0.18)" : "none" }} />
          <span>{liveText}</span>
        </div>
        <button type="button" className="hm-ghost" onClick={signOut}>
          Sign out
        </button>
      </header>

      <main className="hm-main">
        <section aria-label="Totals" className="hm-tiles">
          <Tile label="Captains online" value={data ? fmt(captains.length) : "–"} sub={data ? `plus ${fmt(npcCount)} NPC ships` : ""} subTitle={data ? `${data.npcShips} NPC ships near players right now` : undefined} />
          <Tile label="New captains today" value={today ? fmt(today.newCaptains) : "–"} sub="started a game" />
          <Tile label="From social today" value={today ? fmt(today.socialCaptains) : "–"} sub={socialLine || "none yet"} />
          <Tile
            label="Social visitors who played"
            value={playedPct === null ? "–" : `${playedPct}%`}
            sub={today ? (today.socialVisits > 0 ? `${fmt(today.socialCaptains)} of ${fmt(today.socialVisits)} link clicks` : "no social link clicks yet") : ""}
          />
          <Tile label="Server tick" value={data ? `${data.tickAvgMs.toFixed(1)} ms` : "–"} sub={data ? `budget 50 ms · max ${data.tickMaxMs.toFixed(1)}` : "budget 50 ms"} />
        </section>

        <div className="hm-cols">
          <div className="hm-left">
            <section aria-labelledby="hm-map-h" className="hm-panel">
              <div className="hm-panel-head" style={{ alignItems: "baseline", marginBottom: 10 }}>
                <h2 id="hm-map-h" className="hm-h2">World chart</h2>
                <span className="muted small">Click a ship to select its captain</span>
              </div>
              <div className="hm-map">
                <img src="/world/map_1024x512.png" alt={`World map with ${captains.length} captain${captains.length === 1 ? "" : "s"}`} />
                {captains.map((c) => {
                  const on = c.id === selId;
                  const pos = mapPos(c.lat, c.lon);
                  const label = `${c.name}, ${STATUS[c.status].label}, ${c.where}`;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className={`hm-pin${on ? " sel" : ""}`}
                      onClick={() => pick(c.id)}
                      aria-label={label}
                      aria-pressed={on}
                      title={label}
                      style={{ left: pos.left, top: pos.top, width: on ? 18 : 13, height: on ? 18 : 13, background: STATUS[c.status].color }}
                    />
                  );
                })}
              </div>
              <div className="hm-legend" aria-hidden="true">
                {(["sea", "port", "combat", "idle"] as const).map((k) => (
                  <span key={k}>
                    <span className="hm-swatch" style={{ background: STATUS[k].color }} />
                    {STATUS[k].label}
                  </span>
                ))}
              </div>
            </section>

            <section aria-labelledby="hm-list-h" className="hm-panel">
              <div className="hm-panel-head">
                <h2 id="hm-list-h" className="hm-h2">Active captains</h2>
                <div role="group" aria-label="Filter captains" className="hm-chips">
                  {FILTERS.map(([k, label]) => (
                    <button key={k} type="button" className="hm-chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="hm-tablewrap">
                <table className="hm-table">
                  <thead>
                    <tr>
                      <th scope="col">Captain</th>
                      <th scope="col">Ship</th>
                      <th scope="col">Status</th>
                      <th scope="col">Where</th>
                      <th scope="col">Hull</th>
                      <th scope="col" className="r">Gold</th>
                      <th scope="col">Came from</th>
                      <th scope="col" className="r">Online</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((c) => (
                      <tr key={c.id} className={`row${c.id === selId ? " sel" : ""}`} aria-selected={c.id === selId}>
                        <td>
                          <button type="button" className="hm-namebtn" onClick={() => pick(c.id)}>
                            {c.name}
                          </button>
                        </td>
                        <td>{c.ship}</td>
                        <td>
                          <span className="hm-status" style={{ color: STATUS[c.status].color }}>
                            <span aria-hidden="true" className="hm-swatch" style={{ width: 8, height: 8, background: STATUS[c.status].color }} />
                            {STATUS[c.status].label}
                          </span>
                        </td>
                        <td className="soft">{c.where}</td>
                        <td style={{ minWidth: 120 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div aria-hidden="true" className="hm-bar">
                              <div style={{ width: `${Math.round((c.hp / Math.max(1, c.maxHp)) * 100)}%`, background: hpColor(c.hp, c.maxHp) }} />
                            </div>
                            <span className="num soft small">
                              {c.hp}/{c.maxHp}
                            </span>
                          </div>
                        </td>
                        <td className="num r">{fmt(c.gold)}</td>
                        <td className="soft">{c.source}</td>
                        <td className="num r soft">{formatDuration(now - c.onlineSince)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data && visible.length === 0 && (
                  <p className="hm-empty">{captains.length === 0 ? "No captains online right now." : "No captains match this filter."}</p>
                )}
                {!data && <p className="hm-empty">Loading...</p>}
              </div>
            </section>
          </div>

          <aside aria-labelledby="hm-sel-h" className="hm-aside">
            <div>
              <div className="muted small">Selected captain</div>
              <h2 id="hm-sel-h" className="hm-title" style={{ margin: "2px 0 0", fontSize: 30, color: "var(--hm-text)" }}>
                {sel ? sel.name : "Nobody selected"}
              </h2>
              {sel && (
                <div className="soft" style={{ color: "var(--hm-text-2)" }}>
                  {sel.ship} · <span style={{ color: STATUS[sel.status].color }}>{STATUS[sel.status].label}</span> · {sel.where}
                </div>
              )}
              {selGone && <p className="hm-error small" style={{ marginTop: 6 }}>This captain has left the game.</p>}
            </div>

            {sel && (
              <dl className="hm-facts">
                <div>
                  <dt>Hull</dt>
                  <dd className="num big">
                    {sel.hp} / {sel.maxHp}
                  </dd>
                </div>
                <div>
                  <dt>Gold</dt>
                  <dd className="num big">{fmt(sel.gold)}</dd>
                </div>
                <div>
                  <dt>Came from</dt>
                  <dd>
                    {sel.source}
                    {sel.campaign ? <span className="muted small"> · {sel.campaign}</span> : null}
                  </dd>
                </div>
                <div>
                  <dt>Online for</dt>
                  <dd className="num">{formatDuration(now - sel.onlineSince)}</dd>
                </div>
                <div>
                  <dt>Cargo</dt>
                  <dd className="num">
                    {sel.cargoUsed} / {sel.cargoCapacity}
                  </dd>
                </div>
                <div>
                  <dt>Position</dt>
                  <dd className="num">
                    {Math.abs(sel.lat).toFixed(1)}°{sel.lat >= 0 ? "N" : "S"} {Math.abs(sel.lon).toFixed(1)}°{sel.lon >= 0 ? "E" : "W"}
                  </dd>
                </div>
              </dl>
            )}

            <div>
              <h3 className="hm-h3">Hull</h3>
              <div className="hm-grid2">
                <button type="button" className="hm-act" disabled={actionsDisabled} onClick={() => run("repairFull")}>
                  Repair to full
                </button>
                <button type="button" className="hm-act" disabled={actionsDisabled} onClick={() => run("repairQuarter")}>
                  +25% hull
                </button>
              </div>
            </div>

            <div>
              <h3 className="hm-h3">Give gold</h3>
              <div className="hm-grid3">
                {[100, 1000, 10000].map((n) => (
                  <button key={n} type="button" className="hm-act num" disabled={actionsDisabled} onClick={() => run("gold", n)}>
                    +{fmt(n)}
                  </button>
                ))}
              </div>
              <form
                className="hm-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  giveCustom();
                }}
              >
                <label htmlFor="hm-custom-gold" className="sr-only">
                  Custom gold amount
                </label>
                <input
                  id="hm-custom-gold"
                  className="hm-input num"
                  type="text"
                  inputMode="numeric"
                  placeholder="Other amount"
                  value={customGold}
                  onChange={(e) => setCustomGold(e.target.value)}
                />
                <button type="submit" className="hm-act" style={{ padding: "0 16px" }} disabled={actionsDisabled || !customGold.trim()}>
                  Give
                </button>
              </form>
            </div>

            <div>
              <h3 className="hm-h3">Ship</h3>
              <button type="button" className="hm-primary" disabled={actionsDisabled || !sel?.nextShip} onClick={() => run("upgrade")}>
                {sel ? (sel.nextShip ? `Upgrade to ${sel.nextShip}` : `Already a ${sel.ship}`) : "Upgrade"}
              </button>
              <p className="muted small" style={{ margin: "8px 0 0" }}>
                Free upgrade: keeps their cargo, gold and position.
              </p>
            </div>

            <div role="status" aria-live="polite" style={{ minHeight: result ? undefined : 0 }}>
              {busy && <p className="muted small" style={{ margin: 0 }}>Working...</p>}
              {result && <p className={result.ok ? "hm-ok" : "hm-error"}>{result.text}</p>}
            </div>

            <div style={{ borderTop: "1px solid var(--hm-line)", paddingTop: 14 }}>
              <h3 className="hm-h3">Admin log</h3>
              {data && data.log.length > 0 ? (
                <ol className="hm-log">
                  {data.log.map((l, i) => (
                    <li key={`${l.at}-${i}`}>
                      <span className="num t">{clock(l.at)}</span>
                      <span className="x">{l.text}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="muted small" style={{ margin: 0 }}>Nothing yet. Actions since the last server restart show here.</p>
              )}
            </div>
          </aside>
        </div>
      </main>
    </>
  );
}

function Tile({ label, value, sub, subTitle }: { label: string; value: string; sub: string; subTitle?: string }) {
  return (
    <div className="hm-tile">
      <div className="muted small">{label}</div>
      <div className="num hm-tile-value">{value}</div>
      <div className="num muted small" title={subTitle}>
        {sub}
      </div>
    </div>
  );
}
