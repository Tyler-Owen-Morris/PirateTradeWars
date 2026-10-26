// Renders caption overlays and the end card as PNGs from styled HTML, using the game's fonts
// (Pirata One, IM Fell English SC, Alegreya from Google Fonts; needs network once, else falls back to serif).
// Used by edit.mjs; can be run alone:  node scripts/trailer/cards.mjs --aspect 9x16 --out <dir> "Sail the known world." "Give 'em a broadside."
//
// Safe areas (TikTok / Reels / Shorts UI covers the right rail ~14% and the bottom ~22%, top ~10%):
//   9x16 captions sit in x 6%..84%, y 56%..68%.  16x9 captions sit centred in the lower third (y 74%..90%).
import fs from "fs";
import path from "path";
import { loadPlaywright } from "./lib.mjs";

export const SIZES = { "16x9": { width: 1920, height: 1080 }, "9x16": { width: 1080, height: 1920 } };

const FONTS =
  "https://fonts.googleapis.com/css2?family=Alegreya:ital,wght@0,400;0,700;1,400&family=IM+Fell+English+SC&family=Pirata+One&display=swap";

const baseCss = (aspect) => `
  *{box-sizing:border-box;margin:0}
  html,body{width:100%;height:100%;background:transparent;overflow:hidden}
  .ink{font-family:"Pirata One","IM Fell English SC",Georgia,serif;color:#f6e9c6;text-align:center;line-height:1.05;
       -webkit-text-stroke:${aspect === "9x16" ? 3 : 3}px #1b120a;paint-order:stroke fill;
       text-shadow:0 4px 0 #1b120a,0 8px 24px rgba(0,0,0,.65)}
  .cap{position:absolute;left:${aspect === "9x16" ? "6%" : "10%"};width:${aspect === "9x16" ? "78%" : "80%"};
       ${aspect === "9x16" ? "top:56%;height:12%" : "bottom:10%;height:16%"};display:flex;align-items:center;justify-content:center}
  .cap .ink{font-size:${aspect === "9x16" ? 104 : 108}px;letter-spacing:.01em}
  .rule{width:160px;height:4px;background:#c99a3a;margin:18px auto 0;border-radius:2px;box-shadow:0 2px 0 #1b120a}
`;

const captionHtml = (text, aspect) =>
  `<!doctype html><meta charset=utf-8><link rel=stylesheet href="${FONTS}"><style>${baseCss(aspect)}</style>
   <div class=cap><div><div class=ink>${esc(text)}</div><div class=rule></div></div></div>`;

const endHtml = (aspect, { title, url, tagline }) => {
  const v = aspect === "9x16";
  return `<!doctype html><meta charset=utf-8><link rel=stylesheet href="${FONTS}"><style>
  *{box-sizing:border-box;margin:0}
  html,body{width:100%;height:100%;overflow:hidden;background:#120e09}
  body{background:radial-gradient(ellipse at 50% 45%,#2c2012 0%,#171007 55%,#0b0804 100%);display:flex;align-items:center;justify-content:center}
  .box{text-align:center;padding:0 ${v ? "6%" : "8%"};${v ? "margin-right:8%;margin-bottom:6%" : ""}}
  h1{font:400 ${v ? 190 : 210}px/0.95 "Pirata One",Georgia,serif;color:#e8bb55;text-shadow:0 6px 0 #3a2508,0 12px 40px rgba(0,0,0,.7)}
  .rule{width:${v ? 420 : 560}px;height:5px;background:#c99a3a;margin:34px auto;border-radius:3px}
  .url{font:400 ${v ? 70 : 78}px "IM Fell English SC",Georgia,serif;color:#f6e9c6;letter-spacing:.04em}
  .tag{font:italic 400 ${v ? 50 : 52}px Alegreya,Georgia,serif;color:#d9c79b;margin-top:22px}
  </style><div class=box><h1>${esc(title)}</h1><div class=rule></div><div class=url>${esc(url)}</div><div class=tag>${esc(tagline)}</div></div>`;
};

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

async function shoot(browser, aspect, html, file, transparent) {
  const ctx = await browser.newContext({ viewport: SIZES[aspect], deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.setContent(html, { waitUntil: "load" }).catch(() => {});
  await page.evaluate(() => Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 6000))])).catch(() => {});
  await page.screenshot({ path: file, omitBackground: transparent });
  await ctx.close();
}

/** captions: string[]; returns { captions: string[] (png paths, same order), end: string }. */
export async function renderCards({ aspect, outDir, captions = [], end }) {
  fs.mkdirSync(outDir, { recursive: true });
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  try {
    const caps = [];
    for (let i = 0; i < captions.length; i++) {
      if (!captions[i]) { caps.push(null); continue; }
      const f = path.join(outDir, `cap${String(i).padStart(2, "0")}.png`);
      await shoot(browser, aspect, captionHtml(captions[i], aspect), f, true);
      caps.push(f);
    }
    let endFile = null;
    if (end) {
      endFile = path.join(outDir, "endcard.png");
      await shoot(browser, aspect, endHtml(aspect, end), endFile, false);
    }
    return { captions: caps, end: endFile };
  } finally {
    await browser.close();
  }
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1]?.endsWith("cards.mjs")) {
  const a = process.argv.slice(2);
  const get = (n, d) => (a.includes("--" + n) ? a[a.indexOf("--" + n) + 1] : d);
  const aspect = get("aspect", "16x9");
  const outDir = path.resolve(get("out", "cards"));
  const texts = a.filter((x, i) => !x.startsWith("--") && !(a[i - 1] || "").startsWith("--"));
  const r = await renderCards({
    aspect,
    outDir,
    captions: texts,
    end: { title: "Pirate Trade Wars", url: "piratetradewars.com", tagline: "Free to play in your browser" },
  });
  console.log(JSON.stringify(r, null, 1));
}
