import kbData from "../data/kb.json";
import { KBEntry, SupportedLanguage } from "./types";
import { getEmbedding, generateJson } from "./llm";
import { getCachedEmbeddings, setCachedEmbeddings } from "./store";
import { z } from "zod";

const isGeminiConfigured = Boolean(
  process.env.GEMINI_API_KEY &&
    process.env.GEMINI_API_KEY !== "your_gemini_api_key_here"
);

export const CONFIDENCE_THRESHOLD = isGeminiConfigured ? 0.65 : 0.22;

const kbEntries: KBEntry[] = kbData as KBEntry[];

export function getKBEntries(): KBEntry[] {
  return kbEntries;
}

/**
 * Computes cosine similarity between two numeric vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dotProduct / denominator;
}

/**
 * Creates full searchable text chunk for a KB entry.
 */
export function entryToChunkText(entry: KBEntry): string {
  return [
    `Title: ${entry.title}`,
    `Summary: ${entry.summary}`,
    `Eligibility: ${entry.eligibility_notes}`,
    `How to apply: ${entry.how_to_apply}`,
  ].join("\n");
}

/**
 * Fetches cached embeddings or computes them using Gemini and caches them in Redis.
 */
export async function getOrComputeKBEmbeddings(): Promise<Record<string, number[]>> {
  const cached = await getCachedEmbeddings();
  if (cached && Object.keys(cached).length >= kbEntries.length) {
    return cached;
  }

  const newEmbeddings: Record<string, number[]> = cached ? { ...cached } : {};
  let updated = false;

  for (const entry of kbEntries) {
    if (!newEmbeddings[entry.id]) {
      const chunk = entryToChunkText(entry);
      const vec = await getEmbedding(chunk);
      newEmbeddings[entry.id] = vec;
      updated = true;
    }
  }

  if (updated) {
    await setCachedEmbeddings(newEmbeddings);
  }

  return newEmbeddings;
}

export interface RetrievalResult {
  entry: KBEntry;
  score: number;
}

/**
 * Retrieves top K matching entries for a question using cosine similarity.
 */
export async function retrieveTopK(
  question: string,
  k: number = 3
): Promise<RetrievalResult[]> {
  const queryVec = await getEmbedding(question);
  const kbEmbeddings = await getOrComputeKBEmbeddings();

  const results: RetrievalResult[] = [];
  for (const entry of kbEntries) {
    const entryVec = kbEmbeddings[entry.id];
    if (entryVec) {
      const score = cosineSimilarity(queryVec, entryVec);
      results.push({ entry, score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, k);
}

const AnswerSchema = z.object({
  answer: z.string(),
  used_source_ids: z.array(z.string()),
});

const GroundingSchema = z.object({
  grounded_answer: z.string(),
  removed_unsupported: z.boolean(),
});

const SimplificationSchema = z.object({
  simple_answer: z.string(),
});

export interface AnswerResponse {
  answer: string;
  sources: { name: string; url: string; checked: string }[];
  refused: boolean;
  score: number;
}

/**
 * Answers questions about rights and schemes using verified KB entries only.
 * 1. Checks retrieval score against CONFIDENCE_THRESHOLD.
 * 2. If below, refuses with localized helpline recommendation.
 * 3. If above, generates JSON from retrieved chunks only.
 * 4. Second LLM check removes unsupported sentences (grounding).
 * 5. Third step simplifies to Grade-5 language under 60 words with emojis.
 * 6. Appends verified source citations: "Source: <name> <url> (checked <date>)".
 */
export async function answerWithSources(
  question: string,
  lang: SupportedLanguage = "en"
): Promise<AnswerResponse> {
  const topMatches = await retrieveTopK(question, 3);
  const bestScore = topMatches.length > 0 ? topMatches[0].score : 0;

  // Refusal when below threshold or empty matches
  if (!topMatches.length || bestScore < CONFIDENCE_THRESHOLD) {
    const refusalText =
      lang === "hi"
        ? "माफ़ कीजिए, मेरे पास इस पर सत्यापित सरकारी जानकारी नहीं है। 🏛️\n\nकृपया आधिकारिक ई-श्रम हेल्पलाइन 14434 पर कॉल करें या नजदीकी श्रम सुविधा केंद्र जाएं।"
        : "I don't have verified information on this scheme. 🏛️\n\nPlease contact the official e-Shram helpline at 14434 or visit your local labour office.";

    return {
      answer: refusalText,
      sources: [],
      refused: true,
      score: bestScore,
    };
  }

  const topEntry = topMatches[0].entry;
  const contextChunks = topMatches
    .map(
      (m, i) =>
        `[Chunk ${i + 1}] ID: ${m.entry.id}\nTitle: ${m.entry.title}\nSummary: ${m.entry.summary}\nEligibility: ${m.entry.eligibility_notes}\nHow to apply: ${m.entry.how_to_apply}\nSource: ${m.entry.source_name} (${m.entry.source_url})`
    )
    .join("\n\n");

  const isGeminiAvailable = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "your_gemini_api_key_here");

  if (!isGeminiAvailable) {
    // Deterministic fallback for test/offline environments
    const baseSummary = lang === "hi"
      ? `📜 **${topEntry.title}**: ${topEntry.summary}\n\n👉 पात्रता: ${topEntry.eligibility_notes}\n👉 आवेदन: ${topEntry.how_to_apply}`
      : `📜 **${topEntry.title}**: ${topEntry.summary}\n\n👉 Eligibility: ${topEntry.eligibility_notes}\n👉 How to apply: ${topEntry.how_to_apply}`;

    const citation = `\n\nSource: ${topEntry.source_name} ${topEntry.source_url} (checked ${topEntry.last_verified})`;
    return {
      answer: `${baseSummary}${citation}`,
      sources: [
        {
          name: topEntry.source_name,
          url: topEntry.source_url,
          checked: topEntry.last_verified,
        },
      ],
      refused: false,
      score: bestScore,
    };
  }

  try {
    // Step 1: Generate from chunks only
    const step1Prompt = `
You are KaamSathi, a trusted assistant for Indian informal and gig workers.
Answer the worker's question using ONLY the provided verified government knowledge base chunks.
Do NOT invent any schemes, amounts, age limits, or deadlines.
If the chunks do not contain the answer, say "I don't have verified information on this."
Output strictly in JSON:
{
  "answer": "factual answer in ${lang === "hi" ? "simple Hindi (Devanagari)" : "simple English"}",
  "used_source_ids": ["id1"]
}

Question: "${question}"

Verified Knowledge Base:
${contextChunks}
`;
    const step1Result = await generateJson(step1Prompt, AnswerSchema);

    // Step 2: Grounding check
    const step2Prompt = `
You are a strict legal fact-checker.
Compare the candidate answer against the verified facts.
Remove or strip out any sentence or claim that cannot be proven directly from the verified facts.
Do not add new information.
Output strictly in JSON:
{
  "grounded_answer": "verified text only",
  "removed_unsupported": true_or_false
}

Verified Facts:
${contextChunks}

Candidate Answer:
${step1Result.answer}
`;
    const step2Result = await generateJson(step2Prompt, GroundingSchema);

    // Step 3: Grade-5 Simplification & emoji formatting
    const step3Prompt = `
Rewrite the following verified facts for an informal or gig worker (grade-5 reading level).
Rules:
- Strictly under 45 words.
- Language: ${lang === "hi" ? "Hindi (हिंदी)" : "English"}.
- Use 2-3 helpful emojis (💰, 🛡️, 📜, 📱).
- Keep all scheme names, phone numbers, and numbers accurate.
Output strictly in JSON:
{
  "simple_answer": "simplified text under 45 words"
}

Text to simplify:
${step2Result.grounded_answer}
`;
    const step3Result = await generateJson(step3Prompt, SimplificationSchema);

    // Format citations
    const usedEntries = kbEntries.filter((e) =>
      step1Result.used_source_ids.includes(e.id)
    );
    const finalEntries = usedEntries.length > 0 ? usedEntries : [topEntry];

    const citationLines = finalEntries
      .map((e) => `Source: ${e.source_name} ${e.source_url} (checked ${e.last_verified})`)
      .join("\n");

    const fullAnswer = `${step3Result.simple_answer.trim()}\n\n${citationLines}`;

    return {
      answer: fullAnswer,
      sources: finalEntries.map((e) => ({
        name: e.source_name,
        url: e.source_url,
        checked: e.last_verified,
      })),
      refused: false,
      score: bestScore,
    };
  } catch (err) {
    console.error("LLM answer generation error, using safe fallback:", err);
    const fallbackText = lang === "hi"
      ? `📜 **${topEntry.title}**: ${topEntry.summary}\n\n👉 पात्रता: ${topEntry.eligibility_notes}`
      : `📜 **${topEntry.title}**: ${topEntry.summary}\n\n👉 Eligibility: ${topEntry.eligibility_notes}`;
    const citation = `\n\nSource: ${topEntry.source_name} ${topEntry.source_url} (checked ${topEntry.last_verified})`;
    return {
      answer: `${fallbackText}${citation}`,
      sources: [
        {
          name: topEntry.source_name,
          url: topEntry.source_url,
          checked: topEntry.last_verified,
        },
      ],
      refused: false,
      score: bestScore,
    };
  }
}
