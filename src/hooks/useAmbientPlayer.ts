import { useState, useEffect, useRef, useCallback } from "react";
import {
  AMBIENT_SOUNDS,
  AMBIENT_SOUND_MAP,
  type AmbientSoundId,
} from "@/lib/ambientSounds";

export function useAmbientPlayer() {
  const [soundId, setSoundId]     = useState<AmbientSoundId>("brown");
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef                  = useRef<HTMLAudioElement | null>(null);

  // Pause and cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
        audioRef.current.load();
        audioRef.current = null;
      }
    };
  }, []);

  const [loadError, setLoadError] = useState(false);

  const createAudio = useCallback((url: string): HTMLAudioElement => {
    const audio  = new Audio(url);
    audio.loop   = true;
    audio.preload = "none"; // lazy load — only fetch when play() is called
    audio.onerror = () => {
      setLoadError(true);
      setIsPlaying(false);
    };
    audio.oncanplay = () => setLoadError(false);
    return audio;
  }, []);

  const toggle = useCallback(() => {
    const sound = AMBIENT_SOUND_MAP[soundId];
    if (!sound?.url) return;

    setLoadError(false);

    // Rebuild audio element if URL changed or not yet created
    if (!audioRef.current || !audioRef.current.src.includes(sound.url)) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
        audioRef.current.load();
      }
      audioRef.current = createAudio(sound.url);
    }

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play()
        .then(() => setIsPlaying(true))
        .catch((e) => {
          console.warn("[ambient] play failed:", e);
          setLoadError(true);
          setIsPlaying(false);
        });
    }
  }, [soundId, isPlaying, createAudio]);

  const changeSound = useCallback(
    (newId: AmbientSoundId) => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
        audioRef.current.load();
        audioRef.current = null;
      }
      
      setLoadError(false);
      setSoundId(newId);

      const sound = AMBIENT_SOUND_MAP[newId];
      if (isPlaying && sound?.url) {
        const audio      = createAudio(sound.url);
        audioRef.current = audio;
        audio.play()
          .then(() => setIsPlaying(true))
          .catch((e) => {
            console.warn("[ambient] changeSound play failed:", e);
            setLoadError(true);
            setIsPlaying(false);
          });
      } else {
        setIsPlaying(false);
      }
    },
    [isPlaying, createAudio]
  );

  return { soundId, isPlaying, toggle, changeSound, sounds: AMBIENT_SOUNDS, loadError };
}
