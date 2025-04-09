import { create } from "zustand";
import {Howl} from 'howler'

interface AudioState {
  backgroundMusic: HTMLAudioElement | null;
  hitSound: HTMLAudioElement | null;
  successSound: HTMLAudioElement | null;
  explosionSound: HTMLAudioElement | null;
  cannonBangSound: HTMLAudioElement | null;
  isMuted: boolean;
  isMusicMuted: boolean;
  isSfxMuted: boolean;
  musicVolume: number;
  sfxVolume: number;
  isAudioInitialized: boolean;

  setBackgroundMusic: (music: HTMLAudioElement) => void;
  setHitSound: (sound: HTMLAudioElement) => void;
  setSuccessSound: (sound: HTMLAudioElement) => void;
  setExplosionSound: (sound: HTMLAudioElement) => void;
  setCannonBangSound: (sound: HTMLAudioElement) => void;

  initializeAudio: () => void;
  toggleMute: () => void;
  toggleMusicMute: () => void;
  toggleSfxMute: () => void;
  setMusicVolume: (volume: number) => void;
  setSfxVolume: (volume: number) => void;
  playHit: () => void;
  playSuccess: () => void;
  playExplosion: () => void;
  playCannonBang: () => void;
  playSound: (type: 'hit' | 'success' | 'bell' | 'explosion' | 'cannonBang', volume?: number) => void;
}

const playAudio = (audio: HTMLAudioElement, onError: (error: any) => void) => {
  const playPromise = audio.play();
  console.log("audio-level:", audio.volume)
  console.log("playPromise:", playPromise);

  if (playPromise && typeof playPromise.then === 'function') {
    playPromise.catch(onError);
  } else {
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
  isMuted: false,
  isMusicMuted: true,
  isSfxMuted: true,
  musicVolume: 0.02,
  sfxVolume: 0.5,
  isAudioInitialized: false,

  setBackgroundMusic: (music) => set({ backgroundMusic: music }),
  setHitSound: (sound) => set({ hitSound: sound }),
  setSuccessSound: (sound) => set({ successSound: sound }),
  setExplosionSound: (sound) => set({ explosionSound: sound }),
  setCannonBangSound: (sound) => set({ cannonBangSound: sound }),

  initializeAudio: () => {
    if (get().isAudioInitialized) return;

    let { musicVolume, isMusicMuted, isMuted} = get() 
    // const backgroundMusic = new Audio("/audio/background-music.mp3");
    
    if (!isMusicMuted && !isMuted ) {
      document.addEventListener(
        "click",
        () => {
          playAudio(backgroundMusic, (error) => {
            console.error("Failed to play background music:", error);
            set({ isMuted: true, isMusicMuted: true });
          });
        },
        { once: true }
      );
    }

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
    const { isMuted, backgroundMusic, musicVolume, isMusicMuted} = get();
    const newMutedState = !isMuted;

    console.log("toggleMute called", { isMuted, newMutedState, caller: new Error().stack });

    set({
      isMuted: newMutedState
      
    });

    if (backgroundMusic) {
      if (isMusicMuted || newMutedState) {
        backgroundMusic.pause();
      } else {
        backgroundMusic.volume = musicVolume; // Ensure volume is set before playing
        console.log("Playing background music with volume:", backgroundMusic.volume);
        playAudio(backgroundMusic, (error) => {
          console.error("Failed to play background music:", error);
          set({ isMuted: true, isMusicMuted: true });
          console.log("Background music playback blocked. Please interact with the page to enable audio.");
        });
      }
    }

    console.log(`Sound ${newMutedState ? 'muted' : 'unmuted'}`);
  },

  toggleMusicMute: () => {
    const { isMusicMuted, backgroundMusic, musicVolume } = get();
    const newMusicMutedState = !isMusicMuted;

    set({ isMusicMuted: newMusicMutedState });

    if (backgroundMusic) {
      if (newMusicMutedState) {
        backgroundMusic.pause();
      } else {
        backgroundMusic.volume = musicVolume; // Ensure volume is set before playing
        console.log("Playing background music with volume:", backgroundMusic.volume);
        playAudio(backgroundMusic, (error) => {
          console.error("Failed to play background music:", error);
          set({ isMusicMuted: true });
          console.log("Background music playback blocked. Please interact with the page to enable audio.");
        });
      }
    }

    console.log(`Music ${newMusicMutedState ? 'muted' : 'unmuted'}`);
  },

  toggleSfxMute: () => {
    const { isSfxMuted } = get();
    set({ isSfxMuted: !isSfxMuted });
    console.log(`SFX ${!isSfxMuted ? 'muted' : 'unmuted'}`);
  },

  setMusicVolume: (volume: number) => {
    console.log("Current state - on music vol change:", get());
    const { backgroundMusic  } = get();
    //console.log(typeof backgroundMusic)
    const clampedVolume = Math.max(0, Math.min(1, volume));
    set({ musicVolume: clampedVolume });

    if (backgroundMusic) {
      backgroundMusic.volume = clampedVolume;
      console.log("setMusicVolume called", { volume: clampedVolume });
    }
  },

  setSfxVolume: (volume: number) => {
    const clampedVolume = Math.max(0, Math.min(1, volume));
    set({ sfxVolume: clampedVolume });
    console.log("setSfxVolume called", { volume: clampedVolume, newState: get().sfxVolume });
  },

  playHit: () => {
    get().playSound('hit');
  },

  playSuccess: () => {
    get().playSound('success');
  },

  playExplosion: () => {
    get().playSound('explosion');
  },

  playCannonBang: () => {
    get().playSound('cannonBang');
  },

  playSound: (type: 'hit' | 'success' | 'bell' | 'explosion' | 'cannonBang', volume?: number) => {
    const { isMuted, isSfxMuted, sfxVolume, hitSound, successSound, explosionSound, cannonBangSound } = get();
    const effectiveVolume = volume !== undefined ? volume : sfxVolume;
    console.log("playSound called", { type, volume: effectiveVolume, isMuted, isSfxMuted, sfxVolume });
    if (isMuted || isSfxMuted) {
      console.log(`Sound (${type}) skipped (muted)`);
      return;
    }

    let sound: HTMLAudioElement | null = null;

    switch (type) {
      case 'hit':
        sound = hitSound;
        break;
      case 'success':
        sound = successSound;
        break;
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
      soundClone.volume = effectiveVolume;
      console.log("Playing sound with volume:", soundClone.volume);
      playAudio(soundClone, (error) => {
        console.error(`${type} sound play prevented:`, error);
        // set({ isMuted: true, isSfxMuted: true });
        console.log("Sound playback blocked. Please interact with the page to enable audio.");
      });
    } else {
      console.warn(`Sound of type ${type} not loaded yet`);
    }
  },
}));