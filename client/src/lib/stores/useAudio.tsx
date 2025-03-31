import { create } from "zustand";

interface AudioState {
  backgroundMusic: HTMLAudioElement | null;
  hitSound: HTMLAudioElement | null;
  successSound: HTMLAudioElement | null;
  isMuted: boolean;
  
  // Setter functions
  setBackgroundMusic: (music: HTMLAudioElement) => void;
  setHitSound: (sound: HTMLAudioElement) => void;
  setSuccessSound: (sound: HTMLAudioElement) => void;
  
  // Control functions
  toggleMute: () => void;
  playHit: () => void;
  playSuccess: () => void;
  playSound: (type: 'hit' | 'success' | 'bell', volume?: number) => void;
}

export const useAudio = create<AudioState>((set, get) => ({
  backgroundMusic: null,
  hitSound: null,
  successSound: null,
  isMuted: true, // Start muted by default
  
  setBackgroundMusic: (music) => set({ backgroundMusic: music }),
  setHitSound: (sound) => set({ hitSound: sound }),
  setSuccessSound: (sound) => set({ successSound: sound }),
  
  toggleMute: () => {
    const { isMuted } = get();
    const newMutedState = !isMuted;
    
    // Just update the muted state
    set({ isMuted: newMutedState });
    
    // Log the change
    console.log(`Sound ${newMutedState ? 'muted' : 'unmuted'}`);
  },
  
  playHit: () => {
    const { hitSound, isMuted } = get();
    if (hitSound) {
      // If sound is muted, don't play anything
      if (isMuted) {
        console.log("Hit sound skipped (muted)");
        return;
      }
      
      // Clone the sound to allow overlapping playback
      const soundClone = hitSound.cloneNode() as HTMLAudioElement;
      soundClone.volume = 0.3;
      soundClone.play().catch(error => {
        console.log("Hit sound play prevented:", error);
      });
    }
  },
  
  playSuccess: () => {
    const { successSound, isMuted } = get();
    if (successSound) {
      // If sound is muted, don't play anything
      if (isMuted) {
        console.log("Success sound skipped (muted)");
        return;
      }
      
      successSound.currentTime = 0;
      successSound.play().catch(error => {
        console.log("Success sound play prevented:", error);
      });
    }
  },
  
  playSound: (type, volume = 0.3) => {
    const { hitSound, successSound, isMuted } = get();
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
        sound = successSound;
        break;
      case 'bell':
        // Use success sound for bell sound
        sound = successSound;
        break;
      default:
        console.error(`Unknown sound type: ${type}`);
        return;
    }
    
    if (sound) {
      const soundClone = sound.cloneNode() as HTMLAudioElement;
      soundClone.volume = volume;
      soundClone.play().catch(error => {
        console.log(`${type} sound play prevented:`, error);
      });
    } else {
      console.warn(`Sound of type ${type} not loaded yet`);
    }
  }
}));
