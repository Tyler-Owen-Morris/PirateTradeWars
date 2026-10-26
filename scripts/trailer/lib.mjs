// Shared helpers for the trailer scripts (capture.mjs, cards.mjs, edit.mjs). Docs: docs/trailer/NOTES.md
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export const here = path.dirname(fileURLToPath(import.meta.url));
export const repo = path.resolve(here, "../..");

export const FFMPEG_DIR =
  "C:/Users/theow/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1.1-full_build/bin";
export const FFMPEG = process.env.FFMPEG || (fs.existsSync(`${FFMPEG_DIR}/ffmpeg.exe`) ? `${FFMPEG_DIR}/ffmpeg.exe` : "ffmpeg");
export const FFPROBE = process.env.FFPROBE || (fs.existsSync(`${FFMPEG_DIR}/ffprobe.exe`) ? `${FFMPEG_DIR}/ffprobe.exe` : "ffprobe");

/** Playwright is not a dependency of this repo. Look in PLAYWRIGHT_DIR, the repo, its parents, then sibling agent worktrees. */
export function loadPlaywright() {
  const roots = [process.env.PLAYWRIGHT_DIR, repo, path.resolve(repo, "../../.."), process.cwd()].filter(Boolean);
  for (const r of roots) {
    try {
      return createRequire(path.join(r, "package.json"))("playwright");
    } catch {}
  }
  const wt = path.resolve(repo, "../../..", ".claude/worktrees");
  if (fs.existsSync(wt)) {
    for (const d of fs.readdirSync(wt)) {
      try {
        return createRequire(path.join(wt, d, "package.json"))("playwright");
      } catch {}
    }
  }
  throw new Error("playwright not found. Run `npm i --no-save playwright` in the repo root (browsers are cached already), or set PLAYWRIGHT_DIR.");
}
