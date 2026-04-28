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
  t = Array.from(t).map((char) => {
    const code = char.charCodeAt(0);
    const isControlChar =
      (code >= 0x00 && code <= 0x08) ||
      code === 0x0b ||
      code === 0x0c ||
      (code >= 0x0e && code <= 0x1f) ||
      code === 0x7f;
    return isControlChar ? " " : char;
  }).join("");
  return t
    .replace(/-\n(\S)/g, "$1")            // parola spezzata a fine riga
    .replace(/\n\s*(?:Page|Pagina|Pag\.?|p\.)\s*\d+\s*\n/gi, "\n")
    .replace(/\n\s*\d{1,4}\s*\n/g, "\n") // numero di pagina isolato
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
    if (end >= text.length) break;
    const nextStart = Math.max(0, end - overlap);
    start = nextStart <= start ? end : nextStart;
  }
  return chunks;
}

export interface TextSection {
  title: string;
  content: string;
  startPage: number | null;
}

export interface ChunkPlan {
  content: string;
  sectionTitle: string;
  sectionIndex: number;
  sectionCount: number;
  chunkIndex: number;
  chunkCount: number;
  pageStart: number | null;
  targetItems: number;
}

export interface ChunkPlanOptions {
  overlap?: number;
  baseChunkChars?: number;
  largeDocChunkChars?: number;
  hugeDocChunkChars?: number;
  largeDocThreshold?: number;
  hugeDocThreshold?: number;
  targetItems?: number;
  minItemsPerChunk?: number;
  maxItemsPerChunk?: number;
}

function resolveChunkSize(textLength: number, options: ChunkPlanOptions): number {
  const baseChunkChars = options.baseChunkChars ?? 6_000;
  const largeDocChunkChars = options.largeDocChunkChars ?? 12_000;
  const hugeDocChunkChars = options.hugeDocChunkChars ?? 18_000;
  const largeDocThreshold = options.largeDocThreshold ?? 180_000;
  const hugeDocThreshold = options.hugeDocThreshold ?? 600_000;

  if (textLength >= hugeDocThreshold) return hugeDocChunkChars;
  if (textLength >= largeDocThreshold) return largeDocChunkChars;
  return baseChunkChars;
}

export function sampleDocumentSlices(text: string, slices = 6, sliceChars = 4_000): string {
  if (text.length <= slices * sliceChars) return text;

  const parts: string[] = [];
  for (let i = 0; i < slices; i++) {
    const start = Math.floor((i * Math.max(0, text.length - sliceChars)) / Math.max(1, slices - 1));
    const segment = text.substring(start, start + sliceChars).trim();
    if (segment.length > 0) {
      parts.push(`[[SLICE ${i + 1}/${slices}]]\n${segment}`);
    }
  }
  return parts.join("\n\n");
}

export function buildRepresentativePreview(text: string, maxChars = 50_000, slices = 8): string {
  if (text.length <= maxChars) return text;

  const safeSlices = Math.max(2, Math.min(slices, Math.max(2, Math.floor(maxChars / 1_800))));
  const markerBudget = safeSlices * 24;
  const sliceChars = Math.max(1_200, Math.floor((maxChars - markerBudget) / safeSlices));
  return sampleDocumentSlices(text, safeSlices, sliceChars);
}

export function distributeBudget(total: number, weights: number[], minPerBucket = 1): number[] {
  if (weights.length === 0) return [];

  const safeTotal = Math.max(total, weights.length * minPerBucket);
  const safeWeights = weights.map((weight) => Math.max(1, weight));
  const weightSum = safeWeights.reduce((sum, weight) => sum + weight, 0);
  const base = new Array(weights.length).fill(minPerBucket);
  let remainder = safeTotal - weights.length * minPerBucket;

  const fractional = safeWeights.map((weight, index) => {
    const exact = (weight / weightSum) * remainder;
    const whole = Math.floor(exact);
    base[index] += whole;
    return { index, fraction: exact - whole };
  });

  remainder = safeTotal - base.reduce((sum, value) => sum + value, 0);
  fractional.sort((a, b) => b.fraction - a.fraction);

  for (let i = 0; i < remainder; i++) {
    base[fractional[i % fractional.length].index] += 1;
  }

  return base;
}

function parsePageMarker(line: string): number | null {
  const match = line.match(/^\[\[PAGE:(\d+)\]\]$/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function normalizeSectionTitle(line: string): string {
  return line.replace(/\s+/g, " ").replace(/\s*[:.-]\s*$/, "").trim();
}

function isLikelySectionHeading(line: string): boolean {
  const title = normalizeSectionTitle(line);
  if (title.length < 4 || title.length > 120) return false;
  if (/[.!?;]$/.test(title)) return false;
  if (/^\[\[PAGE:\d+\]\]$/.test(title)) return false;
  if (/^(capitolo|cap\.|parte|sezione|titolo|introduzione|premessa|conclusioni?)(\b|:)/i.test(title)) return true;
  if (/^[IVXLCDM]+(?:[\s.-]+.+)?$/i.test(title) && title.split(/\s+/).length <= 8) return true;

  const letters = title.match(/[A-Za-zÀ-ÿ]/g) || [];
  if (letters.length === 0) return false;
  const uppercase = title.match(/[A-ZÀ-Ÿ]/g) || [];
  const uppercaseRatio = uppercase.length / letters.length;
  if (uppercaseRatio >= 0.85 && title.split(/\s+/).length <= 12) return true;

  return /^[A-ZÀ-Ÿ][A-Za-zÀ-ÿ'’()-]+(?:\s+[A-ZÀ-Ÿ][A-Za-zÀ-ÿ'’()-]+){0,9}$/.test(title);
}

export function splitIntoSections(text: string, minSectionChars = 1_200, minStandaloneSectionChars = 900): TextSection[] {
  const lines = text.split("\n");
  const sections: TextSection[] = [];
  let currentTitle = "Introduzione";
  let currentPage: number | null = null;
  let buffer: string[] = [];

  const flush = () => {
    const content = buffer.join("\n").trim();
    if (!content) {
      buffer = [];
      return;
    }
    sections.push({ title: currentTitle, content, startPage: currentPage });
    buffer = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      buffer.push("");
      continue;
    }

    const page = parsePageMarker(line);
    if (page !== null) {
      currentPage = page;
      continue;
    }

    if (isLikelySectionHeading(line)) {
      const bufferedLength = buffer.join("\n").trim().length;
      if (bufferedLength >= minSectionChars) {
        flush();
        currentTitle = normalizeSectionTitle(line);
        continue;
      }
      if (bufferedLength === 0) {
        currentTitle = normalizeSectionTitle(line);
        continue;
      }
    }

    buffer.push(line);
  }

  flush();

  if (sections.length <= 1) {
    return sections.length === 1 ? sections : [{ title: "Documento", content: text, startPage: null }];
  }

  const merged: TextSection[] = [];
  for (const section of sections) {
    if (merged.length > 0 && section.content.length < minStandaloneSectionChars) {
      const previous = merged[merged.length - 1];
      previous.content = `${previous.content}\n\n${section.title}\n${section.content}`.trim();
      continue;
    }
    merged.push(section);
  }

  return merged;
}

export function buildChunkPlan(text: string, options: ChunkPlanOptions = {}): ChunkPlan[] {
  const overlap = options.overlap ?? 800;
  const minItemsPerChunk = options.minItemsPerChunk ?? 1;
  const maxItemsPerChunk = options.maxItemsPerChunk ?? 12;
  const sections = splitIntoSections(text);
  const chunkSize = resolveChunkSize(text.length, options);
  const totalTargetItems = options.targetItems ?? sections.length;
  const sectionWeights = sections.map((section) => section.content.length);
  const sectionBudgets = distributeBudget(totalTargetItems, sectionWeights, minItemsPerChunk);

  const plan: ChunkPlan[] = [];
  sections.forEach((section, sectionIndex) => {
    const sectionChunks = chunkBySentences(section.content, chunkSize, overlap);
    if (sectionChunks.length === 0) {
      sectionChunks.push(section.content.trim());
    }
    const chunkBudgets = distributeBudget(
      sectionBudgets[sectionIndex],
      new Array(Math.max(1, sectionChunks.length)).fill(1),
      minItemsPerChunk,
    );

    sectionChunks.forEach((chunk, chunkIndex) => {
      plan.push({
        content: chunk,
        sectionTitle: section.title,
        sectionIndex: sectionIndex + 1,
        sectionCount: sections.length,
        chunkIndex: chunkIndex + 1,
        chunkCount: sectionChunks.length,
        pageStart: section.startPage,
        targetItems: Math.max(1, Math.min(maxItemsPerChunk, chunkBudgets[chunkIndex] || 1)),
      });
    });
  });

  return plan;
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
