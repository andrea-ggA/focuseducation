/**
 * Shared text processing utilities for all generation Edge Functions.
 * Import with: import { cleanText, removePageArtifacts, chunkBySentences, detectLanguageHeuristic } from "../_shared/textUtils.ts";
 */

// ── Ligature map ──────────────────────────────────────────────────────────────
const LIGATURES: [RegExp, string][] = [
  [/ﬁ/g,"fi"],[/ﬂ/g,"fl"],[/ﬀ/g,"ff"],[/ﬃ/g,"ffi"],[/ﬄ/g,"ffl"],[/ﬅ/g,"st"],
];

/**
 * Pulisce testo grezzo da artefatti PDF: ligature, caratteri di controllo,
 * trattini a fine riga, numeri di pagina, whitespace eccessivo.
 */
export function cleanText(raw: string): string {
  let t = raw;
  for (const [re, rep] of LIGATURES) t = t.replace(re, rep);
  return t
    .replace(/-\n(\S)/g, "$1")            // parola spezzata a fine riga
    .replace(/\n\s*(?:Page|Pagina|Pag\.?|p\.)\s*\d+\s*\n/gi, "\n")
    .replace(/\n\s*\d{1,4}\s*\n/g, "\n") // numero di pagina isolato
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ")
    .replace(/\uFFFD/g, " ")
    .replace(/[\u200B-\u200F]/g, "")
    .replace(/\u00AD/g, "")
    .replace(/\.{4,}/g, "…")
    .replace(/-{3,}/g, "—")
    .replace(/_{3,}/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n").map((l: string) => l.trim()).join("\n")
    .trim();
}

/**
 * Rimuove header/footer ripetuti e righe di artefatti.
 * Tecnica: righe corte (≤50 chars) che appaiono ≥3 volte = header/footer.
 */
export function removePageArtifacts(text: string): string {
  const lines = text.split("\n");
  const freq  = new Map<string, number>();
  for (const line of lines) {
    const t = line.trim();
    if (t.length > 0 && t.length <= 50) freq.set(t, (freq.get(t) || 0) + 1);
  }
  const artifacts = new Set<string>();
  for (const [line, count] of freq.entries()) if (count >= 3) artifacts.add(line);

  return lines.filter(line => {
    const t = line.trim();
    if (artifacts.has(t)) return false;
    if (/^(?:Pagina?\.?\s*)?\d{1,4}$/.test(t)) return false;
    if (/^[|=\-_.•◦▪▸►●○]{4,}$/.test(t)) return false;
    if (/^https?:\/\/\S+$/.test(t)) return false;
    return true;
  }).join("\n");
}

/**
 * Divide il testo ai confini di frase (non a metà parola).
 * Elimina la causa principale dei "falsi caratteri" nelle generazioni AI.
 */
export function chunkBySentences(text: string, maxChars = 28_000, overlap = 800): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    if (end < text.length) {
      const seg = text.substring(start, end);
      const lastDouble = seg.lastIndexOf("\n\n");
      if (lastDouble > maxChars * 0.55) {
        end = start + lastDouble + 2;
      } else {
        let lastSent = -1;
        const re = /[.!?]\s+/g; let m;
        while ((m = re.exec(seg)) !== null) if (m.index > maxChars * 0.45) lastSent = m.index + m[0].length;
        if (lastSent > 0) {
          end = start + lastSent;
        } else {
          const lastSp = seg.lastIndexOf(" ");
          if (lastSp > maxChars * 0.65) end = start + lastSp + 1;
        }
      }
    }
    const chunk = text.substring(start, end).trim();
    if (chunk.length > 100) chunks.push(chunk);
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}

/** Firme linguistiche per detection euristica (nessuna chiamata AI) */
const LANG_SIGS: Record<string, string[]> = {
  italiano: ["della","delle","degli","nella","sono","anche","questo","questa","come","quando","però","quindi"],
  english:  ["the","and","that","this","with","from","they","their","have","been","which","would"],
  español:  ["que","una","para","con","por","los","las","del","este","esta","como","también"],
  français: ["les","des","une","pour","dans","avec","sur","par","mais","comme","cette","aussi"],
  deutsch:  ["die","der","das","und","ist","mit","von","ein","eine","auch","nicht","werden"],
};

/**
 * Rileva la lingua con euristiche veloci (nessuna chiamata AI).
 * Restituisce "" se non è abbastanza sicuro (triggera il fallback AI).
 */
export function detectLanguageHeuristic(sample: string): string {
  const words   = sample.toLowerCase().split(/\s+/).slice(0, 200);
  const wordSet = new Set(words);
  let best = "", bestScore = 0;
  for (const [lang, sigs] of Object.entries(LANG_SIGS)) {
    const score = sigs.filter(w => wordSet.has(w)).length;
    if (score > bestScore) { bestScore = score; best = lang; }
  }
  return bestScore >= 4 ? best : "";
}

/** Esecuzione parallela con limite di concorrenza */
export async function parallelLimit<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) { const i = next++; results[i] = await tasks[i](); }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
  return results;
}
