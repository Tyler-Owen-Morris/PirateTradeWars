#!/usr/bin/env node
// Trailer edit pipeline (ffmpeg). Docs: docs/trailer/NOTES.md.
//
//   node scripts/trailer/edit.mjs --timeline scripts/trailer/timeline.16x9.json [--out dist/ptw_trailer_16x9.mp4]
//   node scripts/trailer/edit.mjs --selftest [--aspect 16x9|9x16]     # placeholder clips, proves the pipeline
//
// What it does: normalises every clip (scale+crop to the target frame, 30 fps, yuv420p), burns the caption
// PNG (cards.mjs, game fonts) with a fade, appends the end card, joins everything with crossfades (xfade),
// builds the music bed (trim, fade in/out, optional SFX at given times), normalises it to -14 LUFS with a
// two-pass loudnorm (true peak -1.5 dBTP), and muxes H.264 High / yuv420p / AAC-LC 192k, +faststart.
// The 9:16 cut REFRAMES: a clip whose source is 16:9 is cropped to the centre column (set "cropX" 0..1 per
// clip to slide the window); a clip captured natively at 1080x1920 (frames mode) is used as is.
//
// Timeline JSON:
// { "aspect":"9x16", "fps":30, "xfade":0.4,
//   "music": {"file":"docs/trailer/assets/music/pirates_orchestra.mp3","start":0,"fadeIn":1,"fadeOut":2.5,"gainDb":0},
//   "sfx": [{"file":"docs/trailer/assets/sfx/cannon_fire.ogg","at":9.2,"gainDb":-3}],
//   "clips": [ {"src":"capture/9x16/hero-dawn" | "capture/16x9/sail-run.mp4" | {"lavfi":"testsrc2=size=1920x1080:rate=30"},
//               "in":0, "dur":4, "caption":"Sail the known world.", "capIn":0.5, "capDur":2.5, "cropX":0.5, "zoom":1.4, "srcFps":30 } ],
//   "end": {"dur":4, "title":"Pirate Trade Wars", "url":"piratetradewars.com", "tagline":"Free to play in your browser"} }
// "src" paths resolve against the repo root. A directory source is a PNG sequence 00000.png.. from capture.mjs.
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { FFMPEG, FFPROBE, repo } from "./lib.mjs";
import { renderCards, SIZES } from "./cards.mjs";

const argv = process.argv.slice(2);
const opt = (n, d) => {
  const i = argv.indexOf("--" + n);
  if (i < 0) return d;
  const v = argv[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
};
const abs = (p) => (path.isAbsolute(p) ? p : path.resolve(repo, p));

function ff(args, { capture = false } = {}) {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-y", ...args], { encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error("ffmpeg failed: " + args.join(" ") + "\n" + (r.stderr || "").split("\n").slice(-25).join("\n"));
  return capture ? r.stderr : "";
}

export async function build(tl, outFile, work) {
  const aspect = tl.aspect || "16x9";
  const { width: W, height: H } = SIZES[aspect];
  const fps = tl.fps || 30;
  const xf = tl.xfade ?? 0.4;
  fs.mkdirSync(work, { recursive: true });

  // 1. caption + end card PNGs
  const cards = await renderCards({
    aspect,
    outDir: path.join(work, "cards"),
    captions: tl.clips.map((c) => c.caption || null),
    end: tl.end ? { title: tl.end.title, url: tl.end.url, tagline: tl.end.tagline } : null,
  });

  // 2. normalise clips
  const norm = [];
  const durs = [];
  for (let i = 0; i < tl.clips.length; i++) {
    const c = tl.clips[i];
    const out = path.join(work, `clip${String(i).padStart(2, "0")}.mp4`);
    const inArgs = [];
    if (typeof c.src === "object" && c.src.lavfi) inArgs.push("-f", "lavfi", "-i", c.src.lavfi);
    else {
      const s = abs(c.src);
      if (!fs.existsSync(s)) throw new Error(`clip ${i}: missing source ${s}`);
      if (fs.statSync(s).isDirectory()) {
        // capture.mjs folders: frames mode writes 00000.png.., realtime (screencast) writes 00000.jpg..; "in" skips seconds
        const ext = fs.existsSync(path.join(s, "00000.jpg")) ? "jpg" : "png";
        inArgs.push("-framerate", String(c.srcFps || fps), "-start_number", String(Math.round((c.in || 0) * (c.srcFps || fps))), "-i", path.join(s, `%05d.${ext}`));
      }
      else inArgs.push("-ss", String(c.in || 0), "-i", s);
    }
    const dur = c.dur;
    const cx = c.cropX ?? 0.5;
    const cy = c.cropY ?? 0.5;
    // "zoom" (>1) punches in on the frame (e.g. to make the 9:16 trade text legible); cropX/cropY pick the window.
    const z = c.zoom ?? 1, ZW = 2 * Math.round((W * z) / 2), ZH = 2 * Math.round((H * z) / 2);
    let vf = `[0:v]scale=${ZW}:${ZH}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H}:(iw-${W})*${cx}:(ih-${H})*${cy},fps=${fps},setsar=1,scale=out_range=tv,format=yuv420p[v]`; // screencast JPGs are full range (yuvj): force TV range
    const args = [...inArgs];
    let map = "[v]";
    if (cards.captions[i]) {
      const ci = c.capIn ?? 0.4;
      const cd = c.capDur ?? Math.max(1, dur - ci - 0.6);
      args.push("-loop", "1", "-framerate", String(fps), "-t", String(dur), "-i", cards.captions[i]);
      vf += `;[1:v]format=rgba,fade=t=in:st=${ci}:d=0.35:alpha=1,fade=t=out:st=${(ci + cd - 0.35).toFixed(3)}:d=0.35:alpha=1[cap];[v][cap]overlay=0:0:format=auto,format=yuv420p[vo]`;
      map = "[vo]";
    }
    ff([...args, "-filter_complex", vf, "-map", map, "-t", String(dur), "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "12", "-pix_fmt", "yuv420p", "-r", String(fps), out]);
    norm.push(out);
    durs.push(dur);
  }
  if (cards.end) {
    const out = path.join(work, "clip_end.mp4");
    const d = tl.end.dur ?? 4;
    ff(["-loop", "1", "-framerate", String(fps), "-t", String(d), "-i", cards.end, "-vf", `scale=${W}:${H},fps=${fps},format=yuv420p,fade=t=in:st=0:d=0.5`, "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "12", "-pix_fmt", "yuv420p", out]);
    norm.push(out);
    durs.push(d);
  }

  // 3. join with crossfades
  const total = durs.reduce((a, b) => a + b, 0) - xf * (durs.length - 1);
  const silent = path.join(work, "joined.mp4");
  if (norm.length === 1) fs.copyFileSync(norm[0], silent);
  else {
    let filt = "";
    let prev = "[0:v]";
    let acc = durs[0];
    for (let i = 1; i < norm.length; i++) {
      const off = (acc - xf).toFixed(3);
      const last = i === norm.length - 1;
      filt += `${prev}[${i}:v]xfade=transition=fade:duration=${xf}:offset=${off}${last ? ",format=yuv420p" : ""}[x${i}];`;
      prev = `[x${i}]`;
      acc += durs[i] - xf;
    }
    ff([...norm.flatMap((n) => ["-i", n]), "-filter_complex", filt.slice(0, -1), "-map", prev, "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-profile:v", "high", "-pix_fmt", "yuv420p", "-color_range", "tv", "-r", String(fps), silent]);
  }

  // 4. audio: music bed + sfx, then two-pass loudnorm
  const aud = path.join(work, "audio.wav");
  if (tl.music) {
    const m = tl.music;
    const aargs = ["-ss", String(m.start || 0), "-i", abs(m.file)];
    let af = `[0:a]aloop=loop=-1:size=2e9,atrim=0:${total.toFixed(3)},asetpts=N/SR/TB,volume=${m.gainDb ?? 0}dB,afade=t=in:st=0:d=${m.fadeIn ?? 1},afade=t=out:st=${(total - (m.fadeOut ?? 2.5)).toFixed(3)}:d=${m.fadeOut ?? 2.5}[bed]`;
    const mix = ["[bed]"];
    // Clip-relative SFX: clip.sfx[].src = seconds in the SOURCE (same clock as `in`, e.g. a frames.json mark), so
    // retiming a clip keeps its cannon shots in sync. Converted to timeline seconds here.
    const sfxAll = [...(tl.sfx || [])];
    let start = 0;
    tl.clips.forEach((c, i) => {
      for (const s of c.sfx || []) {
        const at = start + (s.src - (c.in || 0));
        if (at >= start && at < start + c.dur) sfxAll.push({ ...s, at, file: s.file ?? "docs/trailer/assets/sfx/cannon_fire.ogg" });
      }
      start += c.dur - xf;
    });
    sfxAll.forEach((s, k) => {
      aargs.push("-i", abs(s.file));
      const ms = Math.round((s.at || 0) * 1000);
      af += `;[${k + 1}:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=${s.gainDb ?? 0}dB,adelay=${ms}|${ms}[s${k}]`;
      mix.push(`[s${k}]`);
    });
    af += `;${mix.join("")}amix=inputs=${mix.length}:normalize=0:duration=first,atrim=0:${total.toFixed(3)}[a]`;
    ff([...aargs, "-filter_complex", af, "-map", "[a]", "-ar", "48000", "-ac", "2", path.join(work, "mix.wav")]);
    // loudnorm pass 1 (measure)
    const target = "I=-14:TP=-1.5:LRA=11";
    const log = ff(["-i", path.join(work, "mix.wav"), "-af", `loudnorm=${target}:print_format=json`, "-f", "null", "-"], { capture: true });
    const j = JSON.parse(log.slice(log.lastIndexOf("{"), log.lastIndexOf("}") + 1));
    ff(["-i", path.join(work, "mix.wav"), "-af", `loudnorm=${target}:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true,aresample=48000`, "-ar", "48000", aud]);
  }

  // 5. mux + final encode settings for social (H.264 High, yuv420p, AAC)
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const mux = ["-i", silent];
  if (tl.music) mux.push("-i", aud);
  ff([...mux, "-map", "0:v", ...(tl.music ? ["-map", "1:a", "-c:a", "aac", "-b:a", "192k"] : []), "-c:v", "copy", "-movflags", "+faststart", "-shortest", outFile]);
  return { outFile, total };
}

function probe(file) {
  const r = spawnSync(FFPROBE, ["-v", "error", "-show_entries", "stream=codec_name,pix_fmt,width,height,r_frame_rate,sample_rate,channels:format=duration,bit_rate", "-of", "json", file], { encoding: "utf8" });
  return JSON.parse(r.stdout);
}
function loudness(file) {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 28 });
  const t = r.stderr.slice(r.stderr.lastIndexOf("Summary:"));
  return { I: /I:\s+(-?[\d.]+) LUFS/.exec(t)?.[1], peak: /Peak:\s+(-?[\d.]+) dBFS/.exec(t)?.[1] };
}

async function selftest() {
  const aspect = opt("aspect", "16x9");
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "ptw-trailer-selftest-"));
  const lav = (rgb) => ({ lavfi: `color=c=${rgb}:s=1920x1080:r=30,drawgrid=w=120:h=120:t=2:c=white@0.4,drawbox=x=iw/2-80:y=ih/2-80:w=160:h=160:c=white@0.8:t=fill` });
  const tl = {
    aspect, fps: 30, xfade: 0.4,
    music: { file: "docs/trailer/assets/music/pirates_orchestra.mp3", start: 0, fadeIn: 1, fadeOut: 2.5 },
    sfx: [{ file: "docs/trailer/assets/sfx/cannon_fire.ogg", at: 3.2, gainDb: -2 }],
    clips: [
      { src: lav("0x1d4f7a"), dur: 3, caption: "Sail the known world." },
      { src: lav("0x7a3b1d"), dur: 3, caption: "Trade where the price is right." },
      { src: lav("0x2d6a3a"), dur: 3, caption: "Give 'em a broadside." },
    ],
    end: { dur: 3, title: "Pirate Trade Wars", url: "piratetradewars.com", tagline: "Free to play in your browser" },
  };
  const out = path.join(work, `selftest_${aspect}.mp4`);
  const t0 = Date.now();
  const r = await build(tl, out, path.join(work, "w"));
  const p = probe(out);
  const l = loudness(out);
  console.log(JSON.stringify({ out, expectedDur: +r.total.toFixed(2), took_s: (Date.now() - t0) / 1000, probe: p, loudness: l }, null, 1));
}

if (opt("selftest", false)) await selftest();
else if (opt("timeline", false)) {
  const tlFile = abs(opt("timeline"));
  const tl = JSON.parse(fs.readFileSync(tlFile, "utf8"));
  const out = abs(opt("out", `dist/ptw_trailer_${tl.aspect || "16x9"}.mp4`));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "ptw-trailer-"));
  const r = await build(tl, out, work);
  console.log(`wrote ${r.outFile} (${r.total.toFixed(1)} s); scratch ${work}`);
  console.log(JSON.stringify({ probe: probe(out).streams?.map((s) => `${s.codec_name} ${s.width ?? ""}x${s.height ?? ""} ${s.pix_fmt ?? ""}`), loudness: loudness(out) }));
} else console.log("usage: --selftest [--aspect 16x9|9x16]  |  --timeline <json> [--out file]");
