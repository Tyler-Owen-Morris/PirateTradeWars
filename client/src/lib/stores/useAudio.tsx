import { create } from "zustand";
import { Howl } from "howler";

interface AudioState {
  backgroundMusic: Howl | null;
  hitSound: Howl | null;
  successSound: Howl | null;
  explosionSound: Howl | null;
  cannonBangSound: Howl | null;
  isAudioInitialized: boolean;
  isMuted: boolean;
  isMusicMuted: boolean;
  isSfxMuted: boolean;
  musicVolume: number;
  sfxVolume: number;
  initializeAudio: () => void;
  toggleMute: () => void;
  toggleMusicMute: () => void;
  toggleSfxMute: () => void;
  setMusicVolume: (volume: number) => void;
  setSfxVolume: (volume: number) => void;
  playBackgroundMusic: () => void;
  pauseBackgroundMusic: () => void;
  // Other methods omitted for brevity
}

export const useAudio = create<AudioState>((set, get) => {
  // Define default audio settings
  let initialSettings = {
    isMuted: false,
    isMusicMuted: true,
    isSfxMuted: true,
    musicVolume: 0.3,
    sfxVolume: 0.5,
  };

  // Load settings from local storage
  try {
    const storedSettings = localStorage.getItem("audioSettings");
    if (storedSettings) {
      const parsed = JSON.parse(storedSettings);
      if (
        typeof parsed.isMuted === "boolean" &&
        typeof parsed.isMusicMuted === "boolean" &&
        typeof parsed.isSfxMuted === "boolean" &&
        typeof parsed.musicVolume === "number" &&
        parsed.musicVolume >= 0 &&
        parsed.musicVolume <= 1 &&
        typeof parsed.sfxVolume === "number" &&
        parsed.sfxVolume >= 0 &&
        parsed.sfxVolume <= 1
      ) {
        initialSettings = parsed;
      } else {
        console.warn("Invalid audio settings in local storage, using defaults.");
      }
    }
  } catch (error) {
    console.error("Error retrieving audio settings from local storage:", error);
  }

  // Function to save settings to local storage
  const saveAudioSettings = () => {
    try {
      const { isMuted, isMusicMuted, isSfxMuted, musicVolume, sfxVolume } = get();
      localStorage.setItem(
        "audioSettings",
        JSON.stringify({ isMuted, isMusicMuted, isSfxMuted, musicVolume, sfxVolume })
      );
    } catch (error) {
      console.error("Error saving audio settings to local storage:", error);
    }
  };

  return {
    backgroundMusic: null,
    hitSound: null,
    successSound: null,
    explosionSound: null,
    cannonBangSound: null,
    isAudioInitialized: false,
    ...initialSettings,

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
    });

    const successSound = new Howl({
      src: ["/sounds/success.mp3"],
      volume: get().sfxVolume,
    });

    const explosionSound = new Howl({
      src: ["/audio/explosion.mp3"],
      volume: get().sfxVolume,
    });

    const cannonBangSound = new Howl({
      src: ["/audio/cannon-bang.mp3"],
      volume: get().sfxVolume,
    });

    set({
      backgroundMusic,
      hitSound,
      successSound,
      explosionSound,
      cannonBangSound,
      isAudioInitialized: true,
    });
  },

  toggleMute: () => {
    set((state) => ({ isMuted: !state.isMuted }));
    saveAudioSettings();
    const { isMuted, isMusicMuted, backgroundMusic } = get();
    if (backgroundMusic) {
      if (isMuted || isMusicMuted) {
        backgroundMusic.pause();
      } else {
        backgroundMusic.play();
      }
    }
  },

  toggleMusicMute: () => {
    set((state) => ({ isMusicMuted: !state.isMusicMuted }));
    saveAudioSettings();
    const { isMuted, isMusicMuted, backgroundMusic } = get();
    if (backgroundMusic) {
      if (isMuted || isMusicMuted) {
        backgroundMusic.pause();
      } else {
        backgroundMusic.play();
      }
    }
  },

  toggleSfxMute: () => {
    set((state) => ({ isSfxMuted: !state.isSfxMuted }));
    saveAudioSettings();
  },

  setMusicVolume: (volume: number) => {
    const clampedVolume = Math.max(0, Math.min(1, volume));
    set({ musicVolume: clampedVolume });
    saveAudioSettings();
    const { backgroundMusic } = get();
    if (backgroundMusic) {
      backgroundMusic.volume(clampedVolume);
    }
  },

  setSfxVolume: (volume: number) => {
    const clampedVolume = Math.max(0, Math.min(1, volume));
    set({ sfxVolume: clampedVolume });
    saveAudioSettings();
    const { hitSound, successSound, explosionSound, cannonBangSound } = get();
    if (hitSound) hitSound.volume(clampedVolume);
    if (successSound) successSound.volume(clampedVolume);
    if (explosionSound) explosionSound.volume(clampedVolume);
    if (cannonBangSound) cannonBangSound.volume(clampedVolume);
  },

  playBackgroundMusic: () => {
    const { backgroundMusic, isMuted, isMusicMuted } = get();
    if (backgroundMusic && !isMuted && !isMusicMuted) {
      backgroundMusic.play();
    }
  },

  pauseBackgroundMusic: () => {
    const { backgroundMusic } = get();
    if (backgroundMusic) {
      backgroundMusic.pause();
    }
  },

  // Other methods omitted for brevity
};
});