const express = require('express');
const multer = require('multer');
const cors = require('cors');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');

const app = express();
app.use(cors({ origin: '*', methods: ['GET', 'POST'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json({ limit: '50mb' }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const GEMINI_NATIVE_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
const MODEL = "gemini-2.5-flash";
const MAX_OUTPUT_TOKENS = 16000;
const WORDS_PER_CHUNK = 6000;
const MAX_CHUNKS = 12;
const CONCURRENCY = 3;

// ─── UTILS ───────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function cleanText(text) {
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n").map(l => l.trim()).join("\n")
    .trim();
}

function chunkByWords(text, wordsPerChunk = WORDS_PER_CHUNK) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const chunks = [];
  for (let i = 0; i < words.length; i += wordsPerChunk) {
    chunks.push(words.slice(i, i + wordsPerChunk).join(" "));
  }
  return chunks;
}

async function parallelLimit(tasks, limit) {
  const results = new Array(tasks.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < tasks.length) {
      const idx = nextIndex++;
      results[idx] = await tasks[idx]();
    }
  }
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ─── AI CALL WITH RETRY ─────────────────────────────────────────────────────
async function callAI(messages, retries = 3, maxTokens = MAX_OUTPUT_TOKENS) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(GEMINI_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${GEMINI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: MODEL, messages, max_tokens: maxTokens }),
      });
      if (!res.ok) {
        const t = await res.text();
        console.error(`AI error (attempt ${attempt + 1}):`, res.status, t);
        if (res.status === 429 && attempt < retries) { await sleep(3000 * (attempt + 1)); continue; }
        if (attempt < retries) { await sleep(2000 * (attempt + 1)); continue; }
        throw new Error(`AI generation failed: ${res.status}`);
      }
      return await res.json();
    } catch (e) {
      console.error(`AI network error (attempt ${attempt + 1}/${retries + 1}):`, e.message || e);
      if (attempt < retries) { await sleep(2000 * (attempt + 1)); continue; }
      throw e;
    }
  }
}

// ─── ROBUST JSON EXTRACTION WITH PARTIAL RECOVERY ────────────────────────────
function extractJsonFromText(text) {
  let cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const start = cleaned.search(/[\{\[]/);
  if (start === -1) throw new Error("No JSON found in response");
  const isArray = cleaned[start] === "[";
  const end = cleaned.lastIndexOf(isArray ? "]" : "}");
  if (end === -1) throw new Error("No JSON end found");
  cleaned = cleaned.substring(start, end + 1);

  try { return JSON.parse(cleaned); } catch { /* fall through */ }

  const basicClean = cleaned.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]").replace(/[\x00-\x1F\x7F]/g, "");
  try { return JSON.parse(basicClean); } catch { /* fall through */ }

  // Partial recovery: salvage complete {...} objects from truncated array
  const itemKey = cleaned.includes('"question"') ? "question" : "front";
  const collectionKey = cleaned.includes('"questions"') ? "questions" : "cards";

  let recoveredTitle = null;
  const titleMatch = cleaned.match(/"title"\s*:\s*"([^"]+)"/);
  if (titleMatch) recoveredTitle = titleMatch[1];

  const arrayStart = cleaned.indexOf("[");
  if (arrayStart === -1) throw new Error("Cannot recover JSON - no array");

  const arrayContent = cleaned.substring(arrayStart + 1);
  const items = [];
  let depth = 0, objStart = -1;

  for (let i = 0; i < arrayContent.length; i++) {
    const ch = arrayContent[i];
    if (ch === "{") { if (depth === 0) objStart = i; depth++; }
    else if (ch === "}") {
      depth--;
      if (depth === 0 && objStart !== -1) {
        const objStr = arrayContent.substring(objStart, i + 1);
        try {
          const obj = JSON.parse(objStr);
          if (obj[itemKey]) items.push(obj);
        } catch { /* skip malformed */ }
        objStart = -1;
      }
    }
  }

  if (items.length > 0) {
    console.log(`Partial JSON recovery: salvaged ${items.length} items`);
    const result = {};
    if (recoveredTitle) result.title = recoveredTitle;
    result[collectionKey] = items;
    return result;
  }

  throw new Error("JSON parsing failed even after partial recovery");
}

// ─── DEDUPLICATION ───────────────────────────────────────────────────────────
function deduplicateItems(items, key) {
  const seen = new Set();
  return items.filter(item => {
    const norm = String(item[key] || "").toLowerCase().replace(/\s+/g, " ").trim().substring(0, 80);
    if (seen.has(norm)) return false;
    seen.add(norm);
    return true;
  });
}

// ─── ANSWER BALANCE (A/B/C/D distribution) ──────────────────────────────────
function balanceCorrectAnswers(rows) {
  if (rows.length <= 1) return rows;
  const counts = [0, 0, 0, 0];
  rows.forEach(r => { if (r.correct_answer >= 0 && r.correct_answer <= 3) counts[r.correct_answer]++; });
  const idealPer = rows.length / 4;
  const maxPerSlot = Math.ceil(idealPer) + 1;

  // Pass 1: Fix over-represented answers
  for (let i = 0; i < rows.length; i++) {
    const curr = rows[i].correct_answer;
    if (counts[curr] <= maxPerSlot) continue;
    const minCount = Math.min(...counts);
    const target = counts.indexOf(minCount);
    if (target === curr || target < 0 || target > 3) continue;
    const opts = [...rows[i].options];
    [opts[curr], opts[target]] = [opts[target], opts[curr]];
    rows[i] = { ...rows[i], options: opts, correct_answer: target };
    counts[curr]--;
    counts[target]++;
  }

  // Pass 2: Break consecutive same-answer streaks
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].correct_answer !== rows[i - 1].correct_answer) continue;
    const isTriple = i >= 2 && rows[i - 2].correct_answer === rows[i].correct_answer;
    if (!isTriple && Math.random() > 0.5) continue;
    const curr = rows[i].correct_answer;
    const candidates = [0, 1, 2, 3].filter(s => s !== curr && counts[s] <= maxPerSlot);
    if (candidates.length === 0) continue;
    const target = candidates[Math.floor(Math.random() * candidates.length)];
    const opts = [...rows[i].options];
    [opts[curr], opts[target]] = [opts[target], opts[curr]];
    rows[i] = { ...rows[i], options: opts, correct_answer: target };
    counts[curr]--;
    counts[target]++;
  }

  return rows;
}

// ─── TOPIC OUTLINE EXTRACTION ────────────────────────────────────────────────
async function extractTopicOutline(text, language) {
  const sample = text.substring(0, 12000);
  const langNote = language === "italiano" ? "Rispondi SOLO in italiano." : `Respond in ${language}.`;

  try {
    const data = await callAI([
      { role: "system", content: `You are an expert academic content analyst. ${langNote}` },
      { role: "user", content: `Analyze this academic text and identify the 5 to 15 MAIN topics/chapters it covers.

RULES:
- Each topic should be a BROAD chapter-level concept (2-5 words max).
- Topics should be MUTUALLY EXCLUSIVE (no overlaps).
- Use CLEAR, STANDARD academic terminology.
- Merge closely related sub-concepts under one umbrella topic.
- Order topics by appearance in the text.

Respond with a JSON array of strings ONLY. Example: ["Cell Biology", "DNA Replication", "Protein Synthesis"]

--- TEXT SAMPLE ---
${sample}
--- END ---

Return ONLY the JSON array, no explanation.` }
    ], 2, 2000);

    const responseText = data.choices?.[0]?.message?.content || "";
    const cleaned = responseText.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const s = cleaned.indexOf("["), e = cleaned.lastIndexOf("]");
    if (s !== -1 && e !== -1) {
      const topics = JSON.parse(cleaned.substring(s, e + 1));
      if (Array.isArray(topics) && topics.length > 0 && topics.every(t => typeof t === "string")) {
        console.log(`Topic outline (${topics.length}): ${topics.join(", ")}`);
        return topics.slice(0, 20);
      }
    }
  } catch (e) {
    console.warn("Topic outline extraction failed:", e.message || e);
  }
  return [];
}

// ─── TOPIC CONSOLIDATION (fuzzy matching) ────────────────────────────────────
function normalizeForComparison(s) {
  return s.toLowerCase().replace(/[^a-zà-ÿ0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

function wordOverlapScore(a, b) {
  const wordsA = normalizeForComparison(a).split(" ");
  const wordsB = normalizeForComparison(b).split(" ");
  const setB = new Set(wordsB);
  const shared = wordsA.filter(w => w.length > 2 && setB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  return union > 0 ? shared / union : 0;
}

function consolidateTopics(items, outlineTopics = [], maxTopics = 18) {
  if (items.length === 0) return items;

  // Phase 1: Map to outline topics
  if (outlineTopics.length > 0) {
    items = items.map(item => {
      const t = (item.topic || "Generale").trim();
      const normT = normalizeForComparison(t);
      if (outlineTopics.find(ot => normalizeForComparison(ot) === normT)) return item;

      let bestMatch = "", bestScore = 0;
      for (const ot of outlineTopics) {
        const score = wordOverlapScore(t, ot);
        if (score > bestScore) { bestScore = score; bestMatch = ot; }
      }
      if (bestScore < 0.15) {
        for (const ot of outlineTopics) {
          const normOt = normalizeForComparison(ot);
          if (normT.includes(normOt) || normOt.includes(normT)) { bestMatch = ot; bestScore = 0.5; break; }
        }
      }
      return bestScore >= 0.15 ? { ...item, topic: bestMatch } : item;
    });
  }

  // Phase 2: Frequency-based consolidation
  const topicFreq = new Map();
  items.forEach(item => {
    const t = (item.topic || "Generale").trim();
    topicFreq.set(t, (topicFreq.get(t) || 0) + 1);
  });
  if (topicFreq.size <= maxTopics) return items;

  const sorted = [...topicFreq.entries()].sort((a, b) => b[1] - a[1]);
  const keptTopics = sorted.slice(0, maxTopics);
  const topicMapping = new Map();

  for (const [topic] of sorted.slice(maxTopics)) {
    let bestMatch = keptTopics[0][0], bestScore = 0;
    for (const [kt] of keptTopics) {
      const score = wordOverlapScore(topic, kt);
      if (score > bestScore) { bestScore = score; bestMatch = kt; }
    }
    if (bestScore < 0.1) {
      const normTopic = normalizeForComparison(topic);
      for (const [kt] of keptTopics) {
        if (normTopic.includes(normalizeForComparison(kt)) || normalizeForComparison(kt).includes(normTopic)) {
          bestMatch = kt; break;
        }
      }
    }
    topicMapping.set(topic, bestMatch);
  }

  return items.map(item => {
    const t = (item.topic || "Generale").trim();
    return topicMapping.has(t) ? { ...item, topic: topicMapping.get(t) } : item;
  });
}

// ─── LANGUAGE DETECTION ──────────────────────────────────────────────────────
async function detectLanguage(text) {
  try {
    const data = await callAI([
      { role: "user", content: `Detect language. Reply ONLY with the language name. Text: "${text.substring(0, 500)}"` }
    ], 2, 20);
    const detected = data.choices?.[0]?.message?.content?.trim().toLowerCase() || "";
    if (detected && detected.length < 30) return detected;
  } catch (_) {}
  return "italiano";
}

// ─── FILE EXTRACTION ─────────────────────────────────────────────────────────
async function extractTextFromFile(file) {
  if (!file) return "";
  try {
    if (file.mimetype === 'application/pdf') {
      const data = await pdf(file.buffer);
      return data.text;
    } else if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const data = await mammoth.extractRawText({ buffer: file.buffer });
      return data.value;
    } else if (file.mimetype.startsWith('text/')) {
      return file.buffer.toString('utf8');
    } else if (file.mimetype.startsWith('image/')) {
      return ""; // Images handled separately via multimodal
    }
  } catch (err) { console.error("File extraction error:", err.message); return ""; }
  return "";
}

// ─── TYPE MAPPING ────────────────────────────────────────────────────────────
const TYPE_MAP = {
  flashcard: "flashcards",
  mappa_concettuale: "mindmap",
  riassunto: "summary",
  schema: "outline",
  appunti: "smart_notes",
  quiz_adhd: "quiz_gamified",
  micro_task: "decompose",
};

function resolveType(type) {
  return TYPE_MAP[type] || type;
}

// ═════════════════════════════════════════════════════════════════════════════
// QUIZ / FLASHCARD GENERATION (full chunking pipeline)
// ═════════════════════════════════════════════════════════════════════════════
async function generateQuizOrFlashcards(content, type, title) {
  const cleaned = cleanText(content);
  if (cleaned.length < 50) throw new Error("Contenuto troppo corto dopo pulizia");

  const docLanguage = await detectLanguage(cleaned);
  const langInstruction = docLanguage === "italiano"
    ? "Genera TUTTO il contenuto in italiano."
    : `Generate ALL content in ${docLanguage}. Do NOT translate.`;

  // Topic outline extraction
  console.log("Extracting topic outline...");
  const topicOutline = await extractTopicOutline(cleaned, docLanguage);
  const topicOutlineInstruction = topicOutline.length > 0
    ? `\nAVAILABLE TOPICS (assign each item to one of these): ${JSON.stringify(topicOutline)}\nDo NOT invent new topic names unless absolutely necessary.`
    : "";

  // Chunking
  const allWordChunks = chunkByWords(cleaned, WORDS_PER_CHUNK);
  const chunksToProcess = Math.min(allWordChunks.length, MAX_CHUNKS);
  const chunks = allWordChunks.slice(0, chunksToProcess);

  const totalWords = cleaned.split(/\s+/).filter(Boolean).length;
  const CHARS_PER_ITEM = 250;
  const USABLE_TOKEN_BUDGET = MAX_OUTPUT_TOKENS * 0.7;
  const dynamicCount = Math.min(25, Math.max(10, Math.floor((USABLE_TOKEN_BUDGET * 4) / CHARS_PER_ITEM)));

  console.log(`Words: ${totalWords}, Chunks: ${chunksToProcess}, Topics: ${topicOutline.length}, DynCount: ${dynamicCount}`);

  const isQuiz = type === "quiz" || type === "quiz_gamified";

  // Build parallel tasks
  const chunkTasks = chunks.map((chunk, idx) => async () => {
    const isFirst = idx === 0;
    const chunkNum = idx + 1;

    const systemInstruction = isQuiz
      ? `You are a professional academic examiner. Your goal is to be EXHAUSTIVE.\nAnalyze the provided text fragment and extract EVERY important concept.\nGenerate EXACTLY ${dynamicCount} high-quality questions for this specific fragment.\nFORMAT: You must respond ONLY with valid JSON.\n${langInstruction}`
      : `You are a professional academic educator. Your goal is to be EXHAUSTIVE.\nAnalyze the provided text fragment and extract EVERY important concept.\nGenerate EXACTLY ${dynamicCount} high-quality flashcards for this specific fragment.\nFORMAT: You must respond ONLY with valid JSON.\n${langInstruction}`;

    let prompt = "";
    if (isQuiz) {
      prompt = `Analyze this text fragment (section ${chunkNum}/${chunksToProcess}) and generate EXACTLY ${dynamicCount} multiple-choice questions.

STRICT RULES:
1. Each question has exactly 4 plausible options of similar length.
2. correct_answer: index 0-3, distribute evenly across questions.
3. explanation: WHY the correct answer is right (max 150 chars).
4. source_context: EXACT sentence from the text (max 150 chars).
5. topic: Assign each question to a BROAD chapter-level topic (max 4 words).${topicOutlineInstruction || " Use NO MORE THAN 3-4 distinct topics."}
6. Points & timing: mix easy (10pts/15s), medium (20pts/30s), hard (30pts/45s) ~25/40/35%.
7. Cover DIFFERENT aspects: definitions, relationships, cause-effect, applications, comparisons.
8. NEVER repeat the same question.
${type === "quiz_gamified" ? "9. ADHD mode: short, stimulating, direct questions." : ""}

${isFirst ? `Respond with: {"title": "descriptive quiz title", "questions": [...]}` : `Respond with: {"questions": [...]}`}

Each question object:
{"question":"...","options":["A","B","C","D"],"correct_answer":0,"explanation":"...","topic":"Topic Name","points":10,"time_limit_seconds":30,"source_context":"..."}

--- TEXT FRAGMENT (${chunkNum}/${chunksToProcess}) ---
${chunk}
--- END ---

Generate EXACTLY ${dynamicCount} questions. Return ONLY valid JSON.`;
    } else {
      prompt = `Analyze this text fragment (section ${chunkNum}/${chunksToProcess}) and generate EXACTLY ${dynamicCount} flashcards.

STRICT RULES:
1. front: a clear, specific question or concept prompt (max 120 chars).
2. back: complete answer with key details (max 200 chars).
3. topic: Assign each card to a BROAD chapter-level topic (max 4 words).${topicOutlineInstruction || " Use NO MORE THAN 3-4 distinct topics."}
4. difficulty: mix easy (~25%), medium (~40%), hard (~35%).
5. source_context: EXACT sentence from the text (max 150 chars).
6. Cover DIFFERENT aspects: definitions, key concepts, cause-effect, comparisons, applications.
7. NEVER repeat the same flashcard.

${isFirst ? `Respond with: {"title": "descriptive deck title", "cards": [...]}` : `Respond with: {"cards": [...]}`}

Each card object:
{"front":"...","back":"...","topic":"Topic Name","difficulty":"medium","source_context":"..."}

--- TEXT FRAGMENT (${chunkNum}/${chunksToProcess}) ---
${chunk}
--- END ---

Generate EXACTLY ${dynamicCount} flashcards. Return ONLY valid JSON.`;
    }

    try {
      const aiData = await callAI([
        { role: "system", content: systemInstruction },
        { role: "user", content: prompt },
      ], 3, MAX_OUTPUT_TOKENS);

      const responseText = aiData.choices?.[0]?.message?.content || "";
      if (!responseText) { console.warn(`Chunk ${chunkNum}: Empty response`); return { title: null, questions: [], cards: [] }; }

      const parsed = extractJsonFromText(responseText);
      const chunkTitle = isFirst && parsed.title ? parsed.title : null;

      if (isQuiz) {
        const qs = parsed.questions || [];
        console.log(`Chunk ${chunkNum}/${chunksToProcess}: +${qs.length} questions`);
        return { title: chunkTitle, questions: qs, cards: [] };
      } else {
        const cards = parsed.cards || parsed.questions || [];
        console.log(`Chunk ${chunkNum}/${chunksToProcess}: +${cards.length} cards`);
        return { title: chunkTitle, questions: [], cards };
      }
    } catch (err) {
      console.error(`Chunk ${chunkNum} failed:`, err.message || err);
      return { title: null, questions: [], cards: [] };
    }
  });

  const startTime = Date.now();
  const results = await parallelLimit(chunkTasks, CONCURRENCY);
  const elapsed = Math.round((Date.now() - startTime) / 1000);

  // Merge
  let generatedTitle = title || "Studio";
  const allQuestions = [], allCards = [];
  for (const result of results) {
    if (result.title && generatedTitle === (title || "Studio")) generatedTitle = result.title;
    allQuestions.push(...result.questions);
    allCards.push(...result.cards);
  }

  console.log(`Generation completed in ${elapsed}s: ${allQuestions.length} questions, ${allCards.length} cards`);

  // Deduplicate
  const dedupedQuestions = deduplicateItems(allQuestions, "question");
  const dedupedCards = deduplicateItems(allCards, "front");

  // Topic consolidation
  const finalQuestions = consolidateTopics(dedupedQuestions, topicOutline, 18);
  const finalCards = consolidateTopics(dedupedCards, topicOutline, 18);

  if (isQuiz) {
    if (finalQuestions.length === 0) throw new Error("Nessuna domanda generata. Riprova.");

    // Fisher-Yates shuffle + answer balance
    const rows = finalQuestions.map((q, i) => {
      const options = [...(q.options || [])];
      let correctIdx = typeof q.correct_answer === "number" ? q.correct_answer : 0;
      const correctText = options[correctIdx];
      for (let j = options.length - 1; j > 0; j--) {
        const k = Math.floor(Math.random() * (j + 1));
        [options[j], options[k]] = [options[k], options[j]];
      }
      return {
        question: q.question,
        options,
        correct_answer: options.indexOf(correctText),
        explanation: q.explanation || "",
        topic: q.topic || "Generale",
        points: q.points || 10,
        time_limit_seconds: q.time_limit_seconds || 30,
        source_reference: q.source_context || q.source_reference || null,
      };
    });

    const balanced = balanceCorrectAnswers(rows);
    return {
      title: generatedTitle,
      questions: balanced,
      total_questions: balanced.length,
      chunks_processed: chunksToProcess,
      elapsed_seconds: elapsed,
    };
  } else {
    if (finalCards.length === 0) throw new Error("Nessuna flashcard generata. Riprova.");
    return {
      title: generatedTitle,
      cards: finalCards.map((c, i) => ({
        front: c.front,
        back: c.back,
        topic: c.topic || "Generale",
        difficulty: c.difficulty || "medium",
        source_reference: c.source_context || c.source_reference || null,
      })),
      total_cards: finalCards.length,
      chunks_processed: chunksToProcess,
      elapsed_seconds: elapsed,
    };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// MINDMAP GENERATION (tool calling)
// ═════════════════════════════════════════════════════════════════════════════
async function generateMindmap(content) {
  const cleaned = cleanText(content);
  const textPreview = cleaned.substring(0, 25000);

  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${GEMINI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: `You are an expert concept mapper specialized in creating ADHD-friendly visual knowledge structures.

Analyze the following text and create a HIERARCHICAL concept mind map optimized for neurodivergent learners.

CRITICAL LANGUAGE RULE: Detect the language of the text below and generate ALL labels, descriptions, and relationship labels in the SAME language as the text.

STRUCTURE RULES (ADHD-optimized):
1. Identify ONE central/main concept — this becomes the root node (importance: 3)
2. Identify 3-5 primary branches — major themes directly connected to root (importance: 2)
3. Identify supporting concepts — details connected to primary branches (importance: 1)
4. Keep labels SHORT (max 3 words)
5. Use SIMPLE, concrete language
6. Each description must be an ELI5 in 1 sentence max
7. Group concepts by color/theme category
8. Create meaningful relationship labels (max 3 words)

For each node: id, label (max 3 words), description (1 sentence ELI5), group (category), importance (3/2/1)
For each edge: from, to, label (max 3 words)

Create between 8 and 18 nodes. Exactly ONE node with importance 3. 3-5 nodes with importance 2.

--- TEXT ---
${textPreview}
--- END ---` }],
      tools: [{
        type: "function",
        function: {
          name: "create_mindmap",
          description: "Create a hierarchical ADHD-friendly concept mind map",
          parameters: {
            type: "object",
            properties: {
              nodes: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    label: { type: "string" },
                    description: { type: "string" },
                    group: { type: "string" },
                    importance: { type: "number", description: "3 for central, 2 for primary, 1 for details" }
                  },
                  required: ["id", "label", "description", "group", "importance"]
                }
              },
              edges: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    from: { type: "string" },
                    to: { type: "string" },
                    label: { type: "string" }
                  },
                  required: ["from", "to"]
                }
              }
            },
            required: ["nodes", "edges"]
          }
        }
      }],
      tool_choice: { type: "function", function: { name: "create_mindmap" } }
    }),
  });

  if (!res.ok) { const t = await res.text(); throw new Error(`AI error: ${res.status} - ${t}`); }

  const aiData = await res.json();
  const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
  let mindmap = { nodes: [], edges: [] };

  if (toolCall?.function?.arguments) {
    mindmap = JSON.parse(toolCall.function.arguments);
  } else {
    const text = aiData.choices?.[0]?.message?.content || "";
    const cleaned2 = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const s = cleaned2.indexOf("{"), e = cleaned2.lastIndexOf("}");
    if (s !== -1 && e !== -1) mindmap = JSON.parse(cleaned2.substring(s, e + 1));
  }

  mindmap.nodes = (mindmap.nodes || []).map(n => ({ ...n, importance: n.importance || 1 }));
  if (!mindmap.nodes.length) throw new Error("Nessun concetto estratto");

  return mindmap;
}

// ═════════════════════════════════════════════════════════════════════════════
// SUMMARY / OUTLINE / SMART_NOTES
// ═════════════════════════════════════════════════════════════════════════════
async function generateSummary(content, format) {
  const cleaned = cleanText(content);
  const docLanguage = await detectLanguage(cleaned);
  const langNote = docLanguage === "italiano" ? "Rispondi TUTTO in italiano." : `Respond entirely in ${docLanguage}.`;

  const formatPrompts = {
    summary: `Genera un RIASSUNTO STRUTTURATO completo del testo fornito.
REGOLE:
1. Organizza con sezioni markdown (## e ###).
2. Concetti chiave chiari e sintetici.
3. Elenchi puntati per dettagli importanti.
4. **Termini chiave** in grassetto.
5. Sezione finale "## Punti Chiave" con 5-10 concetti più importanti.
6. ~30-40% del testo originale.
7. Mantieni precisione di dati, date, nomi, formule.
${langNote}`,

    outline: `Genera uno SCHEMA GERARCHICO completo del testo fornito.
REGOLE:
1. Struttura ad albero: # → ## → ### → elenchi puntati.
2. Ogni nodo conciso (max 1-2 righe).
3. **Concetti chiave** in grassetto.
4. Tutti gli argomenti trattati.
5. Ordine logico/cronologico.
6. "## Concetti Trasversali" se ci sono temi colleganti.
${langNote}`,

    smart_notes: `Genera APPUNTI SMART organizzati dal testo fornito.
REGOLE:
1. Organizza per argomento con ## markdown.
2. Per ogni argomento: 📝 Definizioni, 🔑 Concetti chiave, 📐 Formule/Regole, 🔗 Collegamenti, ⚡ Da ricordare.
3. Emoji per categorizzare visivamente.
4. **Grassetto** per tutto ciò che potrebbe essere oggetto d'esame.
5. Sezione finale "## 🎯 Riassunto Lampo".
${langNote}`,
  };

  const systemPrompt = `You are an expert academic educator. ${langNote}`;
  const userPrompt = formatPrompts[format] || formatPrompts.summary;

  const chunks = chunkByWords(cleaned, 8000);

  if (chunks.length <= 2) {
    const aiData = await callAI([
      { role: "system", content: systemPrompt },
      { role: "user", content: `${userPrompt}\n\n--- TESTO ---\n${cleaned}\n--- FINE ---` },
    ], 3, 65536);
    return aiData.choices?.[0]?.message?.content || "";
  }

  // Large docs: process chunks sequentially then consolidate
  const chunkResults = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunkPrompt = i === 0
      ? `${userPrompt}\n\nQuesto è il frammento ${i + 1} di ${chunks.length}. Genera il contenuto per QUESTO frammento.\n\n--- TESTO (${i + 1}/${chunks.length}) ---\n${chunks[i]}\n--- FINE ---`
      : `Continua la generazione. Mantieni lo stesso stile e formato.\n\n--- TESTO (${i + 1}/${chunks.length}) ---\n${chunks[i]}\n--- FINE ---`;

    const aiData = await callAI([
      { role: "system", content: systemPrompt },
      { role: "user", content: chunkPrompt },
    ], 3, 65536);
    const chunkContent = aiData.choices?.[0]?.message?.content || "";
    if (chunkContent) chunkResults.push(chunkContent);
  }

  if (chunkResults.length > 1) {
    const merged = chunkResults.join("\n\n---\n\n");
    if (merged.length < 120000) {
      const formatLabel = format === "summary" ? "riassunto" : format === "outline" ? "schema" : "appunti smart";
      const mergeData = await callAI([
        { role: "system", content: systemPrompt },
        { role: "user", content: `Unifica e consolida questi ${chunkResults.length} frammenti di ${formatLabel} in un unico documento coerente. Rimuovi ripetizioni, mantieni la struttura. NON troncare.\n\n${merged}` },
      ], 3, 65536);
      return mergeData.choices?.[0]?.message?.content || merged;
    }
    return chunkResults.join("\n\n");
  }
  return chunkResults[0] || "";
}

// ═════════════════════════════════════════════════════════════════════════════
// MICRO-TASK DECOMPOSITION (tool calling)
// ═════════════════════════════════════════════════════════════════════════════
async function generateMicroTasks(content, distractionLevel = 3) {
  const cleaned = cleanText(content);
  const textPreview = cleaned.substring(0, 30000);

  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${GEMINI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: `You are an ADHD-friendly task planner. Analyze the study material and break it into micro-goals of 10-15 minutes each.

CRITICAL LANGUAGE RULE: Detect the language and generate ALL content in the SAME language.

Each micro-task must be:
- Specific and actionable
- Completable in 10-15 minutes
- Logically ordered (simplest to most complex)

User distraction level: ${distractionLevel}/5
${distractionLevel >= 4 ? "VERY short tasks (5-10 min), very specific." : ""}
${distractionLevel <= 2 ? "Slightly longer tasks (12-15 min) allowed." : ""}

Time buffer: multiply base time by ${1 + 0.2 * distractionLevel} (ADHD buffer).

--- MATERIAL ---
${textPreview}
--- END ---

Generate 5-20 micro-tasks.` }],
      tools: [{
        type: "function",
        function: {
          name: "create_micro_tasks",
          description: "Create micro-tasks from study material",
          parameters: {
            type: "object",
            properties: {
              tasks: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    description: { type: "string" },
                    estimated_minutes: { type: "number" },
                    priority: { type: "string", enum: ["high", "medium", "low"] }
                  },
                  required: ["title", "estimated_minutes", "priority"]
                }
              }
            },
            required: ["tasks"]
          }
        }
      }],
      tool_choice: { type: "function", function: { name: "create_micro_tasks" } }
    }),
  });

  if (!res.ok) { const t = await res.text(); throw new Error(`AI error: ${res.status}`); }

  const aiData = await res.json();
  const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
  let tasks = [];

  if (toolCall?.function?.arguments) {
    const parsed = JSON.parse(toolCall.function.arguments);
    tasks = parsed.tasks || [];
  } else {
    const text = aiData.choices?.[0]?.message?.content || "";
    const cleaned2 = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const s = cleaned2.indexOf("{"), e = cleaned2.lastIndexOf("}");
    if (s !== -1 && e !== -1) {
      const parsed = JSON.parse(cleaned2.substring(s, e + 1));
      tasks = parsed.tasks || [];
    }
  }

  // Apply ADHD time buffer
  tasks = tasks.map(t => ({
    ...t,
    estimated_minutes: Math.round((t.estimated_minutes || 10) * (1 + 0.2 * distractionLevel)),
  }));

  return { tasks };
}

// ═════════════════════════════════════════════════════════════════════════════
// YOUTUBE TRANSCRIPT
// ═════════════════════════════════════════════════════════════════════════════
function extractVideoId(url) {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function parseCaptionXml(xml) {
  const textSegments = [];
  const regex = /<text[^>]*>([\s\S]*?)<\/text>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    let text = match[1]
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n/g, " ").trim();
    if (text) textSegments.push(text);
  }
  if (textSegments.length > 0) return textSegments.join(" ");
  try {
    const json = JSON.parse(xml);
    if (json.events) {
      for (const event of json.events) {
        if (event.segs) {
          const segText = event.segs.map(s => s.utf8 || "").join("").trim();
          if (segText && segText !== "\n") textSegments.push(segText);
        }
      }
    }
  } catch (_) {}
  return textSegments.join(" ");
}

async function fetchYoutubeTranscript(url) {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error("URL YouTube non valido.");

  // Try innertube API
  const playerRes = await fetch("https://www.youtube.com/youtubei/v1/player", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      videoId,
      context: { client: { clientName: "WEB", clientVersion: "2.20240101.00.00", hl: "it", gl: "IT" } },
    }),
  });

  if (playerRes.ok) {
    const playerData = await playerRes.json();
    const title = playerData?.videoDetails?.title || `Video ${videoId}`;
    const captionTracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

    if (captionTracks && captionTracks.length > 0) {
      const track = captionTracks.find(t => t.languageCode === "it" && !t.kind) ||
        captionTracks.find(t => t.languageCode === "en" && !t.kind) ||
        captionTracks.find(t => t.languageCode === "it") ||
        captionTracks.find(t => t.languageCode === "en") ||
        captionTracks[0];

      const captionRes = await fetch(track.baseUrl + "&fmt=srv3");
      if (captionRes.ok) {
        const captionXml = await captionRes.text();
        const transcript = parseCaptionXml(captionXml);
        if (transcript && transcript.length > 30) {
          return { transcript, title, videoId, method: "captions" };
        }
      }
    }
  }

  // Fallback: Gemini video analysis
  console.log("No captions, attempting Gemini video analysis...");
  const geminiRes = await fetch(`${GEMINI_NATIVE_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [
          { fileData: { mimeType: "video/mp4", fileUri: `https://www.youtube.com/watch?v=${videoId}` } },
          { text: `Analizza questo video YouTube in modo approfondito. Genera una trascrizione dettagliata e completa del contenuto parlato. Strutturata con paragrafi e sezioni logiche. Fornisci SOLO la trascrizione.` },
        ],
      }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 16000 },
    }),
  });

  if (!geminiRes.ok) throw new Error("Impossibile analizzare il video.");

  const geminiData = await geminiRes.json();
  const aiContent = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "";
  if (aiContent.length < 100) throw new Error("Contenuto video insufficiente.");

  const infoRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
  let videoTitle = `Video ${videoId}`;
  if (infoRes.ok) { const info = await infoRes.json(); videoTitle = info.title || videoTitle; }

  return {
    transcript: aiContent,
    title: videoTitle,
    videoId,
    method: "video_analysis",
    notice: "Contenuto generato dall'analisi AI del video (sottotitoli non disponibili).",
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// AI TUTOR (streaming)
// ═════════════════════════════════════════════════════════════════════════════
app.post('/ai-tutor', async (req, res) => {
  try {
    const { messages, documentContext } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Messaggi non validi" });
    }

    const systemContent = `Il tuo nome è FocusEd. Sei stato creato dal team di FocusEd.
Sei un tutor AI empatico e paziente specializzato per studenti con ADHD.

REGOLA LINGUA: Rileva la lingua dello studente e rispondi nella STESSA lingua.

Usa tono incoraggiante, supportivo, mai giudicante.
Spezza le spiegazioni in punti brevi e chiari.
Usa emoji per rendere coinvolgente.
Adatta la complessità al livello dello studente.
Usa analogie e esempi pratici.
Mantieni risposte concise.
Formatta con Markdown.${documentContext ? `

CONTESTO DOCUMENTO: Usa ESCLUSIVAMENTE questo contenuto per rispondere.
---DOCUMENTO---
${String(documentContext).slice(0, 60000)}
---FINE DOCUMENTO---` : ""}`;

    const response = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${GEMINI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "system", content: systemContent }, ...messages],
        stream: true,
      }),
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 429) return res.status(429).json({ error: "Troppe richieste, riprova tra poco." });
      if (status === 402) return res.status(402).json({ error: "Crediti AI esauriti." });
      return res.status(500).json({ error: "Errore del servizio AI" });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value, { stream: true }));
      }
    } finally {
      res.end();
    }
  } catch (error) {
    console.error("ai-tutor error:", error);
    if (!res.headersSent) res.status(500).json({ error: error.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// VOICE-TO-NOTES
// ═════════════════════════════════════════════════════════════════════════════
app.post('/voice-to-notes', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "File audio mancante" });

    const audioBase64 = req.file.buffer.toString('base64');
    let format = "wav";
    const mime = req.file.mimetype || "";
    if (mime.includes("webm")) format = "webm";
    else if (mime.includes("ogg")) format = "ogg";
    else if (mime.includes("mp3") || mime.includes("mpeg")) format = "mp3";
    else if (mime.includes("mp4") || mime.includes("m4a")) format = "mp4";

    const response = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${GEMINI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "system",
            content: `You are an expert that transforms audio from lectures and voice notes into structured study notes.
CRITICAL LANGUAGE RULE: Detect the audio language and produce notes in the SAME language.
1. LISTEN CAREFULLY to all audio.
2. FAITHFULLY TRANSCRIBE, without inventing content.
3. Organize by topics/sections with ## and ### headings.
4. Use bullet points for key concepts.
5. Highlight definitions.
6. Report examples faithfully.
7. Fix grammar but DO NOT change meaning.
8. Report formulas/data accurately.
9. Add "Key Concepts" section at end.
10. DO NOT generate random content if audio is unclear.`,
          },
          {
            role: "user",
            content: [
              { type: "input_audio", input_audio: { data: audioBase64, format } },
              { type: "text", text: "Transcribe this audio and create structured study notes. Only report what is actually said." },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) return res.status(429).json({ error: "Rate limit. Riprova tra poco." });
      throw new Error(`AI transcription failed: ${response.status}`);
    }

    const data = await response.json();
    const notes = data.choices?.[0]?.message?.content || "";
    if (!notes || notes.trim().length < 10) {
      return res.status(400).json({ error: "Non è stato possibile trascrivere l'audio." });
    }

    res.json({ notes });
  } catch (error) {
    console.error("voice-to-notes error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// ROUTES
// ═════════════════════════════════════════════════════════════════════════════

// Timeout middleware (3 minutes for heavy generation)
app.use((req, res, next) => {
  req.setTimeout(300000);
  res.setTimeout(300000);
  next();
});

app.post('/generate-content', async (req, res) => {
  try {
    const { type: rawType, inputData } = req.body;
    if (!inputData) return res.status(400).json({ error: "Contenuto mancante" });

    const type = resolveType(rawType);
    console.log(`[generate-content] type=${rawType} → ${type}, chars=${inputData.length}`);

    if (type === "quiz" || type === "quiz_gamified" || type === "flashcards") {
      const result = await generateQuizOrFlashcards(inputData, type);
      return res.json({ result });
    }
    if (type === "mindmap") {
      const result = await generateMindmap(inputData);
      return res.json({ success: true, ...result });
    }
    if (type === "summary" || type === "outline" || type === "smart_notes") {
      const content = await generateSummary(inputData, type);
      return res.json({ result: { markdown: content, format: type } });
    }
    if (type === "decompose") {
      const result = await generateMicroTasks(inputData);
      return res.json({ result });
    }

    // Fallback: generic generation
    const result = await generateQuizOrFlashcards(inputData, "quiz");
    res.json({ result });
  } catch (error) {
    console.error("generate-content error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/generate-from-file', upload.single('file'), async (req, res) => {
  try {
    const rawType = req.body.type;
    const type = resolveType(rawType);

    const text = await extractTextFromFile(req.file);
    if (!text || text.length < 50) {
      return res.status(400).json({ error: "Impossibile estrarre testo dal file o testo troppo corto." });
    }

    console.log(`[generate-from-file] type=${rawType} → ${type}, extracted=${text.length} chars`);

    if (type === "quiz" || type === "quiz_gamified" || type === "flashcards") {
      const result = await generateQuizOrFlashcards(text, type);
      return res.json({ result });
    }
    if (type === "mindmap") {
      const result = await generateMindmap(text);
      return res.json({ success: true, ...result });
    }
    if (type === "summary" || type === "outline" || type === "smart_notes") {
      const content = await generateSummary(text, type);
      return res.json({ result: { markdown: content, format: type } });
    }
    if (type === "decompose") {
      const result = await generateMicroTasks(text);
      return res.json({ result });
    }

    const result = await generateQuizOrFlashcards(text, "quiz");
    res.json({ result });
  } catch (error) {
    console.error("generate-from-file error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/youtube-transcript', async (req, res) => {
  try {
    const url = req.body.url || req.body.videoUrl;
    if (!url) return res.status(400).json({ error: "URL YouTube richiesto." });
    const result = await fetchYoutubeTranscript(url);
    res.json(result);
  } catch (error) {
    console.error("youtube-transcript error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: "ok", model: MODEL, timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`FocusEducation server v2 on port ${PORT} — model: ${MODEL}`));
