import { create } from "zustand";
import { Howl } from "howler";

interface AudioState {
  backgroundMusic: Howl | null;
  hitSound: Howl | null;
  successSound: Howl | null;
  explosionSound: Howl | null;
  cannonBangSound: Howl | null;
  isMuted: boolean;
  isMusicMuted: boolean;
  isSfxMuted: boolean;
  musicVolume: number;
  sfxVolume: number;
  isAudioInitialized: boolean;

  initializeAudio: () => void;
  cleanupAudio: () => void;
  toggleMute: () => void;
  toggleMusicMute: () => void;
  toggleSfxMute: () => void;
  setMusicVolume: (volume: number) => void;
  setSfxVolume: (volume: number) => void;
  playBackgroundMusic: () => void;
  pauseBackgroundMusic: () => void;
  playHit: () => void;
  playSuccess: () => void;
  playExplosion: () => void;
  playCannonBang: () => void;
  playSound: (type: "hit" | "success" | "bell" | "explosion" | "cannonBang", volume?: number) => void;
}

export const useAudio = create<AudioState>((set, get) => ({
  backgroundMusic: null,
  hitSound: null,
  successSound: null,
  explosionSound: null,
  cannonBangSound: null,
  isMuted: false,
  isMusicMuted: true,
  isSfxMuted: true,
  musicVolume: 0.3,
  sfxVolume: 0.5,
  isAudioInitialized: false,

  initializeAudio: () => {
    if (get().isAudioInitialized) return;

    const backgroundMusic = new Howl({
      // src: ["/sounds/background.mp3"],
      src: ["/sounds/The Salty Horizon.mp3","/sounds/background.mp3"],
      loop: true,
      volume: get().musicVolume,
      autoplay: false,
    });

    const hitSound = new Howl({
      src: ["/sounds/hit.mp3"],
      volume: get().sfxVolume,
      autoplay: false,
    });

    const successSound = new Howl({
      src: ["/sounds/success.mp3"],
      volume: get().sfxVolume,
      autoplay: false,
    });

    const explosionSound = new Howl({
      src: ["/audio/explosion.mp3"],
      volume: get().sfxVolume,
      autoplay: false,
    });

    const cannonBangSound = new Howl({
      src: ["/audio/cannon-bang.mp3"],
      volume: get().sfxVolume,
      autoplay: false,
    });

    set({
      backgroundMusic,
      hitSound,
      successSound,
      explosionSound,
      cannonBangSound,
      isAudioInitialized: true,
    });

    console.log("Audio initialized with Howler.js");
  },

  cleanupAudio: () => {
    const { backgroundMusic, hitSound, successSound, explosionSound, cannonBangSound } = get();
    backgroundMusic?.unload();
    hitSound?.unload();
    successSound?.unload();
    explosionSound?.unload();
    cannonBangSound?.unload();
    set({
      backgroundMusic: null,
      hitSound: null,
      successSound: null,
      explosionSound: null,
      cannonBangSound: null,
      isAudioInitialized: false,
    });
    console.log("Audio cleaned up");
  },

  toggleMute: () => {
    const { isMuted, backgroundMusic, playBackgroundMusic, pauseBackgroundMusic } = get();
    const newMutedState = !isMuted;
    set({ isMuted: newMutedState });
    if (newMutedState) {
      pauseBackgroundMusic();
    } else if (!get().isMusicMuted) {
      playBackgroundMusic();
    }
    console.log(`Sound ${newMutedState ? "muted" : "unmuted"}`);
  },

  toggleMusicMute: () => {
    const { isMusicMuted, playBackgroundMusic, pauseBackgroundMusic } = get();
    const newMusicMutedState = !isMusicMuted;
    set({ isMusicMuted: newMusicMutedState });
    if (newMusicMutedState) {
      pauseBackgroundMusic();
    } else if (!get().isMuted) {
      playBackgroundMusic();
    }
    console.log(`Music ${newMusicMutedState ? "muted" : "unmuted"}`);
  },

  toggleSfxMute: () => {
    const { isSfxMuted } = get();
    set({ isSfxMuted: !isSfxMuted });
    console.log(`SFX ${!isSfxMuted ? "muted" : "unmuted"}`);
  },

  setMusicVolume: (volume: number) => {
    const clampedVolume = Math.max(0, Math.min(1, volume));
    set({ musicVolume: clampedVolume });
    const { backgroundMusic } = get();
    if (backgroundMusic) {
      backgroundMusic.volume(clampedVolume);
    }
    console.log("Music volume set to:", clampedVolume);
  },

  setSfxVolume: (volume: number) => {
    const clampedVolume = Math.max(0, Math.min(1, volume));
    set({ sfxVolume: clampedVolume });
    const { hitSound, successSound, explosionSound, cannonBangSound } = get();
    if (hitSound) hitSound.volume(clampedVolume);
    if (successSound) successSound.volume(clampedVolume);
    if (explosionSound) explosionSound.volume(clampedVolume);
    if (cannonBangSound) cannonBangSound.volume(clampedVolume);
    console.log("SFX volume set to:", clampedVolume);
  },

  playBackgroundMusic: () => {
    const { backgroundMusic, isMuted, isMusicMuted } = get();
    if (backgroundMusic && !isMuted && !isMusicMuted) {
      backgroundMusic.play();
      console.log("Background music playing");
    }
  },

  pauseBackgroundMusic: () => {
    const { backgroundMusic } = get();
    if (backgroundMusic) {
      backgroundMusic.pause();
      console.log("Background music paused");
    }
  },

  playHit: () => get().playSound("hit"),
  playSuccess: () => get().playSound("success"),
  playExplosion: () => get().playSound("explosion"),
  playCannonBang: () => get().playSound("cannonBang"),

  playSound: (type: "hit" | "success" | "bell" | "explosion" | "cannonBang", volume?: number) => {
    const { isMuted, isSfxMuted, sfxVolume, hitSound, successSound, explosionSound, cannonBangSound } = get();
    if (isMuted || isSfxMuted) {
      console.log(`Sound (${type}) skipped (muted)`);
      return;
    }

    let sound: Howl | null = null;
    switch (type) {
      case "hit":
        sound = hitSound;
        break;
      case "success":
      case "bell":
        sound = successSound;
        break;
      case "explosion":
        sound = explosionSound;
        break;
      case "cannonBang":
        sound = cannonBangSound;
        break;
      default:
        console.error(`Unknown sound type: ${type}`);
        return;
    }

    if (sound) {
      const effectiveVolume = volume !== undefined ? volume : sfxVolume;
      sound.volume(effectiveVolume);
      sound.play();
      console.log(`Playing ${type} sound with volume: ${effectiveVolume}`);
    } else {
      console.warn(`Sound of type ${type} not loaded yet`);
    }
  },
}));