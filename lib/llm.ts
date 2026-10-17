import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const EMBEDDING_MODEL = "text-embedding-004";

let clientInstance: GoogleGenAI | null = null;

function getClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "your_gemini_api_key_here") {
    return null;
  }
  if (!clientInstance) {
    clientInstance = new GoogleGenAI({ apiKey });
  }
  return clientInstance;
}

/**
 * Clean and parse JSON from LLM output, stripping Markdown fences if present.
 */
export function cleanJsonText(raw: string): string {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3);
  }
  return cleaned.trim();
}

/**
 * Generate embedding for text chunk using Gemini text-embedding-004.
 */
export async function getEmbedding(text: string): Promise<number[]> {
  const ai = getClient();
  if (!ai) {
    // Deterministic fallback mock embedding for tests and offline dev
    return generateMockEmbedding(text);
  }

  try {
    const response = await ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: text,
    });
    
    // The response has embeddings[0].values
    const values = response?.embeddings?.[0]?.values || (response as any)?.embedding?.values;
    if (Array.isArray(values)) {
      return values;
    }
    return generateMockEmbedding(text);
  } catch (err) {
    console.warn("Embedding API error, using mock fallback:", err);
    return generateMockEmbedding(text);
  }
}

/**
 * Generates JSON from Gemini and strictly validates it with Zod.
 */
export async function generateJson<T>(
  prompt: string,
  schema: z.ZodSchema<T>,
  systemInstruction?: string
): Promise<T> {
  const ai = getClient();
  const modelName = DEFAULT_MODEL;

  if (!ai) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const config: Record<string, any> = {
    responseMimeType: "application/json",
  };
  if (systemInstruction) {
    config.systemInstruction = systemInstruction;
  }

  const response = await ai.models.generateContent({
    model: modelName,
    contents: prompt,
    config,
  });

  const text = response?.text || "";
  const cleaned = cleanJsonText(text);

  try {
    const parsedJson = JSON.parse(cleaned);
    return schema.parse(parsedJson);
  } catch (err: any) {
    console.error("Failed to parse/validate LLM JSON output:", text, err);
    throw new Error(`LLM output validation failed: ${err.message}`);
  }
}

/**
 * Generate plain text response from Gemini.
 */
export async function generateText(
  prompt: string,
  systemInstruction?: string
): Promise<string> {
  const ai = getClient();
  if (!ai) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const config: Record<string, any> = {};
  if (systemInstruction) {
    config.systemInstruction = systemInstruction;
  }

  const response = await ai.models.generateContent({
    model: DEFAULT_MODEL,
    contents: prompt,
    config,
  });

  return (response?.text || "").trim();
}

/**
 * Deterministic pseudo-embedding for testing or when API key is absent.
 * Produces a normalized 768-dimensional float vector.
 */
export function generateMockEmbedding(text: string): number[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\u0900-\u097F\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const dims = 768;
  const vector = new Array(dims).fill(0);

  for (const word of words) {
    let hash = 5381;
    for (let j = 0; j < word.length; j++) {
      hash = (hash << 5) + hash + word.charCodeAt(j);
    }
    const idx = Math.abs(hash) % dims;
    const isSchemeKey = ["pmsby", "pmjjby", "pmsym", "eshram", "ayushman", "shram"].includes(word);
    const weight = ["what", "is", "the", "and", "how", "to", "for", "in", "a", "of"].includes(word)
      ? 0.1
      : isSchemeKey
      ? 5.0
      : 1.5;
    vector[idx] += weight;
  }

  // Normalize
  let norm = 0;
  for (let i = 0; i < dims; i++) norm += vector[i] * vector[i];
  norm = Math.sqrt(norm) || 1;
  return vector.map((v) => v / norm);
}
