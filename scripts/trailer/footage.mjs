#!/usr/bin/env node
// Raw footage pack helper (docs/trailer/FOOTAGE.md): turns capture folders into editing-friendly silent MP4s,
// pulls check frames, and builds a contact sheet per folder.
//
//   node scripts/trailer/footage.mjs encode <captureDir> <out.mp4> [--in s] [--dur s]
//   node scripts/trailer/footage.mjs check <clip.mp4> <outDir>        # start / middle / end JPGs for review
//   node scripts/trailer/footage.mjs contact <folder>                  # <folder>/_contact.jpg (middle frame of every clip)
//   node scripts/trailer/footage.mjs probe <folder>                    # name, seconds, WxH of every clip (README lines)
//
// Encoding: H.264 High, CRF 15, preset slow, yuv420p TV range (bt709 tags), 30 fps, +faststart, no audio track.
// Capture folders hold 00000.png.. (frames mode) or 00000.jpg.. (realtime screencast, full-range JPEG).
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { FFMPEG, FFPROBE } from "./lib.mjs";

const FONT = "C\\:/Windows/Fonts/arial.ttf";
const run = (args) => execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "inherit", "inherit"] });

export function frameKind(dir) {
  const f = fs.readdirSync(dir).filter((n) => /^\d{5}\.(png|jpg)$/.test(n)).sort();
  if (!f.length) throw new Error("no frames in " + dir);
  return { ext: path.extname(f[0]).slice(1), count: f.length, first: Number(f[0].slice(0, 5)) };
}

export function encode(dir, out, { inS = 0, dur = null, fps = 30 } = {}) {
  const { ext, first } = frameKind(dir);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const vf = `scale=${ext === "jpg" ? "in_range=pc:" : ""}out_range=tv:out_color_matrix=bt709:flags=lanczos,format=yuv420p`;
  run([
    "-framerate", String(fps), "-start_number", String(first + Math.round(inS * fps)), "-i", path.join(dir, `%05d.${ext}`),
    ...(dur ? ["-frames:v", String(Math.round(dur * fps))] : []),
    "-vf", vf, "-c:v", "libx264", "-preset", "slow", "-crf", "15", "-profile:v", "high", "-pix_fmt", "yuv420p",
    "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
    "-r", String(fps), "-movflags", "+faststart", "-an", out,
  ]);
}

export function probe(file) {
  const j = JSON.parse(execFileSync(FFPROBE, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,nb_frames:format=duration", "-of", "json", file]).toString());
  const s = j.streams[0];
  return { w: s.width, h: s.height, frames: Number(s.nb_frames), dur: Number(j.format.duration) };
}

export function check(file, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const { dur } = probe(file);
  const base = path.basename(file, ".mp4");
  const outs = [];
  for (const [tag, t] of [["a", 0.05], ["b", dur / 2], ["c", Math.max(0, dur - 0.1)]]) {
    const o = path.join(outDir, `${base}_${tag}.jpg`);
    run(["-ss", t.toFixed(2), "-i", file, "-frames:v", "1", "-vf", "scale='min(960,iw)':-2", "-q:v", "3", o]);
    outs.push(o);
  }
  return outs;
}

export function contact(folder) {
  const clips = fs.readdirSync(folder).filter((n) => n.endsWith(".mp4")).sort();
  if (!clips.length) return null;
  const tmp = path.join(folder, "_contact_tmp");
  fs.mkdirSync(tmp, { recursive: true });
  clips.forEach((c, i) => {
    const { dur } = probe(path.join(folder, c));
    const label = c.replace(/\.mp4$/, "").replace(/'/g, "").replace(/:/g, "-");
    run(["-ss", (dur / 2).toFixed(2), "-i", path.join(folder, c), "-frames:v", "1",
      "-vf", `scale=480:270:force_original_aspect_ratio=decrease,pad=480:300:(ow-iw)/2:0:color=0x111111,drawtext=fontfile='${FONT}':text='${label}':fontsize=12:fontcolor=white:x=6:y=280`,
      "-q:v", "3", path.join(tmp, `${String(i).padStart(3, "0")}.jpg`)]);
  });
  const cols = 4, rows = Math.ceil(clips.length / cols);
  const out = path.join(folder, "_contact.jpg");
  run(["-framerate", "1", "-i", path.join(tmp, "%03d.jpg"), "-vf", `tile=${cols}x${rows}:padding=4:color=0x000000`, "-frames:v", "1", "-q:v", "3", out]);
  fs.rmSync(tmp, { recursive: true, force: true });
  return out;
}

if (process.argv[1]?.endsWith("footage.mjs")) {
  const [cmd, a, b, ...rest] = process.argv.slice(2);
  const get = (n) => (rest.includes("--" + n) ? Number(rest[rest.indexOf("--" + n) + 1]) : undefined);
  if (cmd === "encode") { encode(a, b, { inS: get("in") ?? 0, dur: get("dur") ?? null }); console.log(b, JSON.stringify(probe(b))); }
  else if (cmd === "check") console.log(check(a, b).join("\n"));
  else if (cmd === "contact") console.log(contact(a));
  else if (cmd === "probe") for (const c of fs.readdirSync(a).filter((n) => n.endsWith(".mp4")).sort()) { const p = probe(path.join(a, c)); console.log(`${c}\t${p.dur.toFixed(1)} s\t${p.w}x${p.h}`); }
  else { console.error("usage: encode <dir> <out.mp4> | check <clip> <outDir> | contact <folder> | probe <folder>"); process.exit(1); }
}
