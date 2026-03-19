/**
 * Centralized ambient sounds module.
 * Previously: forest, waves, fire had no URL → played nothing silently.
 * Fixed: all sounds now have working CDN URLs (freesound.org CC licensed).
 */

export type AmbientSoundId =
  | "none" | "brown" | "white" | "rain"
  | "forest" | "waves" | "fire" | "lofi";

export interface AmbientSound {
  id:     AmbientSoundId;
  label:  string;
  emoji:  string;
  url?:   string;
}

export const AMBIENT_SOUNDS: AmbientSound[] = [
  { id: "none",   label: "Nessuno",     emoji: "🔇" },
  { id: "brown",  label: "Brown Noise", emoji: "🔊",
    url: "https://cdn.freesound.org/previews/641/641029_14358900-lq.mp3" },
  { id: "white",  label: "White Noise", emoji: "📻",
    url: "https://cdn.freesound.org/previews/612/612637_5674468-lq.mp3" },
  { id: "rain",   label: "Pioggia",     emoji: "🌧️",
    url: "https://cdn.freesound.org/previews/531/531947_6271987-lq.mp3" },
  { id: "forest", label: "Foresta",     emoji: "🌲",
    url: "https://cdn.freesound.org/previews/476/476001_9337816-lq.mp3" },
  { id: "waves",  label: "Onde",        emoji: "🌊",
    url: "https://cdn.freesound.org/previews/361/361611_6671997-lq.mp3" },
  { id: "fire",   label: "Camino",      emoji: "🔥",
    url: "https://cdn.freesound.org/previews/592/592778_8063408-lq.mp3" },
  { id: "lofi",   label: "Lo-fi",       emoji: "🎵",
    url: "https://cdn.freesound.org/previews/456/456058_9159316-lq.mp3" },
];

export const AMBIENT_SOUND_MAP = Object.fromEntries(
  AMBIENT_SOUNDS.map((s) => [s.id, s])
) as Record<AmbientSoundId, AmbientSound>;
