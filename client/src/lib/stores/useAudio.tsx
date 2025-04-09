import { create } from "zustand";

interface AudioState {
  backgroundMusic: HTMLAudioElement | null;
  hitSound: HTMLAudioElement | null;
  successSound: HTMLAudioElement | null;
  explosionSound: HTMLAudioElement | null;
  cannonBangSound: HTMLAudioElement | null;
  isMuted: boolean;
  isAudioInitialized: boolean;

  setBackgroundMusic: (music: HTMLAudioElement) => void;
  setHitSound: (sound: HTMLAudioElement) => void;
  setSuccessSound: (sound: HTMLAudioElement) => void;
  setExplosionSound: (sound: HTMLAudioElement) => void;
  setCannonBangSound: (sound: HTMLAudioElement) => void;

  initializeAudio: () => void;
  toggleMute: () => void;
  playHit: () => void;
  playSuccess: () => void;
  playExplosion: () => void;
  playCannonBang: () => void;
  playSound: (type: 'hit' | 'success' | 'bell' | 'explosion' | 'cannonBang', volume?: number) => void;
}

// Helper function to play audio and handle Promise/non-Promise cases
const playAudio = (audio: HTMLAudioElement, onError: (error: any) => void) => {
  const playPromise = audio.play();
  console.log("playPromise:", playPromise); // Debug: Log what play() returns

  // Check if playPromise is a Promise by checking for .then
  if (playPromise && typeof playPromise.then === 'function') {
    // Modern browsers: play() returns a Promise
    playPromise.catch(onError);
  } else {
    // Older browsers or unexpected return value: play() does not return a Promise
    setTimeout(() => {
      if (audio.paused) {
        onError(new Error("Audio playback failed (possibly blocked, unsupported, or invalid audio element)"));
      }
    }, 100);
  }
};

export const useAudio = create<AudioState>((set, get) => ({
  backgroundMusic: null,
  hitSound: null,
  successSound: null,
  explosionSound: null,
  cannonBangSound: null,
  isMuted: true,
  isAudioInitialized: false,

  setBackgroundMusic: (music) => set({ backgroundMusic: music }),
  setHitSound: (sound) => set({ hitSound: sound }),
  setSuccessSound: (sound) => set({ successSound: sound }),
  setExplosionSound: (sound) => set({ explosionSound: sound }),
  setCannonBangSound: (sound) => set({ cannonBangSound: sound }),

  initializeAudio: () => {
    if (get().isAudioInitialized) return;

    const backgroundMusic = new Audio("/audio/background-music.mp3");
    backgroundMusic.loop = true;
    backgroundMusic.volume = 0.2;
    backgroundMusic.onerror = () => {
      console.error("Failed to load background music");
    };

    const hitSound = new Audio("/audio/hit.mp3");
    const successSound = new Audio("/audio/success.mp3");
    const explosionSound = new Audio("/audio/explosion.mp3");
    const cannonBangSound = new Audio("/audio/cannon-bang.mp3");

    set({
      backgroundMusic,
      hitSound,
      successSound,
      explosionSound,
      cannonBangSound,
      isAudioInitialized: true,
    });

    console.log("Audio initialized");
  },

  toggleMute: () => {
    const { isMuted, backgroundMusic } = get();
    const newMutedState = !isMuted;

    set({ isMuted: newMutedState });

    if (backgroundMusic) {
      if (newMutedState) {
        backgroundMusic.pause();
      } else {
        playAudio(backgroundMusic, (error) => {
          console.error("Failed to play background music:", error);
          set({ isMuted: true });
          console.log("Background music playback blocked. Please interact with the page to enable audio.");
        });
      }
    }

    console.log(`Sound ${newMutedState ? 'muted' : 'unmuted'}`);
  },

  playHit: () => {
    get().playSound('hit', 0.3);
  },

  playSuccess: () => {
    get().playSound('success', 0.5);
  },

  playExplosion: () => {
    get().playSound('explosion', 0.7);
  },

  playCannonBang: () => {
    get().playSound('cannonBang', 1.5);
  },

  playSound: (type, volume = 0.3) => {
    const { isMuted, hitSound, successSound, explosionSound, cannonBangSound } = get();
    if (isMuted) {
      console.log(`Sound (${type}) skipped (muted)`);
      return;
    }

    let sound: HTMLAudioElement | null = null;

    switch (type) {
      case 'hit':
        sound = hitSound;
        break;
      case 'success':
      case 'bell':
        sound = successSound;
        break;
      case 'explosion':
        sound = explosionSound;
        break;
      case 'cannonBang':
        sound = cannonBangSound;
        break;
      default:
        console.error(`Unknown sound type: ${type}`);
        return;
    }

    if (sound) {
      const soundClone = sound.cloneNode() as HTMLAudioElement;
      soundClone.volume = volume;
      playAudio(soundClone, (error) => {
        console.error(`${type} sound play prevented:`, error);
        set({ isMuted: true });
        console.log("Sound playback blocked. Please interact with the page to enable audio.");
      });
    } else {
      console.warn(`Sound of type ${type} not loaded yet`);
    }
  },
}));