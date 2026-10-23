/**
 * Trade screen sound cues (STYLE_GUIDE §9). Short synthesised cues for now; swap for CC0 samples
 * (coins, quill, stamp, paper) when they are chosen. Follows the game's SFX mute and volume.
 *   buy = two coins, falling pitch (coins leave the purse) · sell = three, rising · err = low thud ·
 *   tick = quill tick when a line is chosen.
 */
import { useAudio } from "@/lib/stores/useAudio";

let ctx: AudioContext | null = null;

export type TradeCue = "buy" | "sell" | "err" | "tick";

export function playTradeCue(kind: TradeCue): void {
  const { isMuted, isSfxMuted, sfxVolume } = useAudio.getState() as { isMuted: boolean; isSfxMuted: boolean; sfxVolume: number };
  if (isMuted || isSfxMuted || !sfxVolume) return;
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = ctx || new AC();
    const t0 = ctx.currentTime;
    const notes = kind === "sell" ? [2093, 2637, 3136] : kind === "buy" ? [2637, 1976] : kind === "tick" ? [1400] : [150, 110];
    notes.forEach((f, i) => {
      const o = ctx!.createOscillator(), g = ctx!.createGain();
      o.type = kind === "err" ? "sine" : "triangle";
      o.frequency.value = f;
      const t = t0 + i * (kind === "err" ? 0.09 : 0.075);
      const vol = (kind === "tick" ? 0.05 : 0.16) * sfxVolume, dur = kind === "err" ? 0.18 : 0.22;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ctx!.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    });
  } catch {
    /* audio is optional */
  }
}
