import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Inline-SVG ornaments for the pirate theme: compass rose, wax seal, title lockup, landing backdrop.
 * All decorative SVGs are aria-hidden; nothing here loads an image.
 */

const DEG = Math.PI / 180;
/** Point at compass angle `a` (degrees, 0 = up, clockwise) and radius `r`. */
const xy = (a: number, r: number): [number, number] => [+(Math.sin(a * DEG) * r).toFixed(2), +(-Math.cos(a * DEG) * r).toFixed(2)];
const pt = (a: number, r: number) => xy(a, r).join(",");

/** One star point split into a dark and a light half, like an engraved rose. */
function RosePoint({ a, len, half, base, dark, light }: { a: number; len: number; half: number; base: number; dark: string; light: string }) {
  const tip = pt(a, len);
  return (
    <>
      <polygon points={`0,0 ${tip} ${pt(a - half, base)}`} fill={light} />
      <polygon points={`0,0 ${tip} ${pt(a + half, base)}`} fill={dark} />
    </>
  );
}

/**
 * Compass rose as an SVG <g> centred on (0,0), radius ~100. Embed in your own <svg>, or use
 * <CompassRose> for a standalone one. Strokes use currentColor.
 */
export function CompassRoseGlyph({
  dark = "currentColor",
  light = "rgba(255,240,200,0.18)",
  ticks = true,
  north = true,
}: {
  dark?: string;
  light?: string;
  ticks?: boolean;
  north?: boolean;
}) {
  const tickEls: React.ReactNode[] = [];
  if (ticks) {
    for (let d = 0; d < 360; d += 5) {
      const long = d % 45 === 0;
      const [x1, y1] = xy(d, 90);
      const [x2, y2] = xy(d, long ? 99 : 95);
      tickEls.push(<line key={d} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={long ? 1.4 : 0.7} />);
    }
  }
  return (
    <g stroke="currentColor" fill="none">
      <circle r="99" strokeWidth="1.2" />
      <circle r="90" strokeWidth="0.8" />
      <circle r="64" strokeWidth="0.6" strokeDasharray="2 3" />
      {tickEls}
      <g stroke="currentColor" strokeWidth="0.5">
        {[22.5, 67.5, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5].map((a) => (
          <RosePoint key={a} a={a} len={44} half={11.25} base={11} dark={dark} light={light} />
        ))}
        {[45, 135, 225, 315].map((a) => (
          <RosePoint key={a} a={a} len={64} half={22.5} base={14} dark={dark} light={light} />
        ))}
        {[0, 90, 180, 270].map((a) => (
          <RosePoint key={a} a={a} len={88} half={45} base={15} dark={dark} light={light} />
        ))}
      </g>
      <circle r="6" fill={dark} strokeWidth="0.8" />
      <circle r="2.2" fill={light} stroke="none" />
      {north && (
        <path d="M0,-118 l-6,10 h4 v4 h4 v-4 h4 Z" fill={dark} strokeWidth="0.6" />
      )}
    </g>
  );
}

export function CompassRose({ className, ...rest }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="-125 -125 250 250" aria-hidden="true" focusable="false" className={className} {...rest}>
      <CompassRoseGlyph />
    </svg>
  );
}

export type SealEmblem = "skull" | "anchor" | "compass";

/**
 * Blood-red wax seal with an embossed emblem. Decorative by default; pass `title` to make it an
 * image with an accessible name. Size with width/height classes (`className="h-16 w-16"`).
 */
export function WaxSeal({
  emblem = "skull",
  title,
  className,
}: {
  emblem?: SealEmblem;
  title?: string;
  className?: string;
}) {
  const id = React.useId().replace(/:/g, "");
  const emb = "rgba(52,4,3,0.62)";
  const hi = "rgba(255,170,150,0.35)";
  const emblemShape =
    emblem === "skull" ? (
      <g>
        <g strokeLinecap="round" strokeWidth="6.5" stroke={emb}>
          <line x1="-22" y1="-18" x2="22" y2="20" />
          <line x1="22" y1="-18" x2="-22" y2="20" />
        </g>
        <path d="M0,-24c-11,0-18,7-18,16 0,6 3,10 7,12v6h22v-6c4-2 7-6 7-12 0-9-7-16-18-16Z" fill={emb} />
        <circle cx="-6.5" cy="-8" r="4.2" fill="rgba(255,160,140,0.35)" />
        <circle cx="6.5" cy="-8" r="4.2" fill="rgba(255,160,140,0.35)" />
        <path d="M0,-2 l-2.5,4.5 h5 Z" fill="rgba(255,160,140,0.35)" />
      </g>
    ) : emblem === "anchor" ? (
      <g fill="none" stroke={emb} strokeWidth="5" strokeLinecap="round">
        <circle cx="0" cy="-22" r="5" />
        <line x1="0" y1="-17" x2="0" y2="24" />
        <line x1="-11" y1="-10" x2="11" y2="-10" />
        <path d="M-22,8 C-20,22 -8,26 0,26 C8,26 20,22 22,8" />
      </g>
    ) : (
      <g fill={emb}>
        <polygon points="0,-28 6,-6 28,0 6,6 0,28 -6,6 -28,0 -6,-6" />
        <circle r="4" fill="rgba(255,160,140,0.35)" />
      </g>
    );
  return (
    <svg
      viewBox="-50 -50 100 100"
      className={cn("ptw-seal", className)}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      <defs>
        <radialGradient id={`${id}-w`} cx="38%" cy="32%" r="75%">
          <stop offset="0" stopColor="#d9503f" />
          <stop offset="0.45" stopColor="#9a1d16" />
          <stop offset="1" stopColor="#4d0907" />
        </radialGradient>
      </defs>
      {/* irregular poured-wax blob */}
      <path
        d="M2,-47c9,1 12,6 20,7 9,1 15,7 17,15 2,7 9,11 8,20-1,8-6,11-7,19-1,9-9,13-17,16-7,3-11,9-21,9-9 0-13-6-21-8-9-3-15-8-17-16-2-7-9-12-8-21 1-8 7-11 9-19 2-9 9-14 17-17 8-3 12-6 20-5Z"
        fill={`url(#${id}-w)`}
      />
      <circle r="33" fill="none" stroke="rgba(52,4,3,0.5)" strokeWidth="2.5" />
      <circle r="30" fill="none" stroke={hi} strokeWidth="1" />
      {emblemShape}
      <ellipse cx="-14" cy="-24" rx="12" ry="5" fill="rgba(255,220,210,0.22)" transform="rotate(-30 -14 -24)" />
    </svg>
  );
}

/**
 * "Pirate Trade Wars" title lockup: gilded display type over a faint compass rose, with a wax
 * ribbon tagline. Renders an <h1> (only use it once per screen).
 */
export function TitleLockup({ tagline = "Sail · Trade · Plunder", className }: { tagline?: string; className?: string }) {
  return (
    <div className={cn("relative flex flex-col items-center text-center select-none", className)}>
      <CompassRose
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-[58%] h-[190%] w-auto text-ptw-brass/35"
      />
      <h1 className="relative ptw-font-display ptw-gilded leading-[0.95] text-[clamp(2.6rem,10vw,5.6rem)]">
        Pirate Trade Wars
      </h1>
      {tagline && <p className="relative ptw-ribbon mt-2 text-sm sm:text-base">{tagline}</p>}
    </div>
  );
}

/** Rhumb lines radiating from a rose centre, the way old portolan charts draw them. */
function RhumbLines({ cx, cy, len = 2600, strong = 0.3, weak = 0.14 }: { cx: number; cy: number; len?: number; strong?: number; weak?: number }) {
  const lines: React.ReactNode[] = [];
  for (let i = 0; i < 32; i++) {
    const a = i * 11.25;
    const [x, y] = xy(a, len);
    lines.push(
      <line key={i} x1={cx} y1={cy} x2={cx + x} y2={cy + y} strokeOpacity={i % 4 === 0 ? strong : weak} strokeWidth={i % 4 === 0 ? 1 : 0.6} />,
    );
  }
  return <g stroke="currentColor">{lines}</g>;
}

/**
 * Full-bleed landing backdrop: a dusk sea chart (graticule, rhumb lines, two compass roses, a few
 * charted islets), drifting fog and a slow swell along the bottom. Animations are transform-only and
 * switch off under prefers-reduced-motion. Place it first inside a `relative` full-screen container.
 */
export function SeaChartBackdrop() {
  const grid: React.ReactNode[] = [];
  for (let x = 0; x <= 1600; x += 100) grid.push(<line key={`x${x}`} x1={x} y1={0} x2={x} y2={1000} />);
  for (let y = 0; y <= 1000; y += 100) grid.push(<line key={`y${y}`} x1={0} y1={y} x2={1600} y2={y} />);
  return (
    <div className="ptw-sea-chart" aria-hidden="true">
      <svg className="ptw-sea-chart__ink" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" focusable="false">
        <g stroke="currentColor" strokeOpacity="0.1" strokeWidth="0.8" strokeDasharray="1 5">
          {grid}
        </g>
        <RhumbLines cx={1240} cy={620} />
        <RhumbLines cx={300} cy={260} strong={0.22} weak={0.1} />
        {/* charted islets: coast line + offshore dashed sounding line */}
        <g fill="rgba(201,162,77,0.07)" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1">
          <path d="M120 760c30-30 80-40 120-25s70 5 95 30 10 60-30 70-90 20-130 0-80-45-55-75Z" />
          <path d="M1420 180c20-18 55-20 75-5s25 40 5 55-60 15-80 0-20-32 0-50Z" />
          <path d="M760 860c18-10 45-8 60 4s10 30-10 36-48 4-58-8-8-24 8-32Z" />
        </g>
        <g fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="0.8" strokeDasharray="3 4">
          <path d="M100 752c34-44 98-58 146-40s82 8 108 38 12 82-40 94-104 24-150 0-96-56-64-92Z" />
          <path d="M1405 168c26-26 72-28 98-8s32 54 6 74-78 20-104 0-26-44 0-66Z" />
        </g>
        <g transform="translate(1240 620) scale(1.55)">
          <CompassRoseGlyph />
        </g>
        <g transform="translate(300 260) scale(0.8)" opacity="0.75">
          <CompassRoseGlyph ticks={false} />
        </g>
        {/* ink wave marks */}
        <g fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.2" strokeLinecap="round">
          {[
            [520, 520],
            [600, 540],
            [880, 300],
            [960, 320],
            [1040, 180],
            [460, 900],
            [1100, 900],
            [200, 520],
            [1480, 420],
          ].map(([x, y]) => (
            <path key={`${x}-${y}`} d={`M${x} ${y}q8-7 16 0t16 0`} />
          ))}
        </g>
      </svg>
      <div className="ptw-fog ptw-fog--high" />
      <div className="ptw-fog ptw-fog--low" />
      <div className="ptw-waves ptw-waves--back" />
      <div className="ptw-waves ptw-waves--front" />
      <div className="ptw-sea-chart__vignette" />
    </div>
  );
}
