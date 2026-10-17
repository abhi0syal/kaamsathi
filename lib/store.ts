import { Redis } from "@upstash/redis";
import { UserState } from "./types";

const STATE_TTL_SECONDS = 86400; // 24 hours TTL
const KB_CACHE_KEY = "kaamsathi:kb:embeddings:v1";

// In-memory fallback for local dev & unit tests when Upstash is not configured
const memoryStore = new Map<string, { data: string; expiresAt: number }>();

function getRedisClient(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token && !url.includes("your-upstash")) {
    try {
      return new Redis({ url, token });
    } catch {
      return null;
    }
  }
  return null;
}

export async function getUserState(hashedUserId: string): Promise<UserState | null> {
  const client = getRedisClient();
  const key = `kaamsathi:user:${hashedUserId}`;

  if (client) {
    try {
      const data = await client.get<UserState>(key);
      return data || null;
    } catch (err) {
      console.warn("Upstash Redis get error, using fallback:", err);
    }
  }

  // Memory fallback
  const entry = memoryStore.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryStore.delete(key);
    return null;
  }
  try {
    return JSON.parse(entry.data) as UserState;
  } catch {
    return null;
  }
}

export async function setUserState(
  hashedUserId: string,
  state: UserState,
  ttlSeconds: number = STATE_TTL_SECONDS
): Promise<void> {
  const client = getRedisClient();
  const key = `kaamsathi:user:${hashedUserId}`;

  if (client) {
    try {
      await client.set(key, state, { ex: ttlSeconds });
      return;
    } catch (err) {
      console.warn("Upstash Redis set error, using fallback:", err);
    }
  }

  // Memory fallback
  memoryStore.set(key, {
    data: JSON.stringify(state),
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

export async function deleteUserData(hashedUserId: string): Promise<void> {
  const client = getRedisClient();
  const key = `kaamsathi:user:${hashedUserId}`;

  if (client) {
    try {
      await client.del(key);
    } catch (err) {
      console.warn("Upstash Redis del error:", err);
    }
  }

  memoryStore.delete(key);
}

export async function getCachedEmbeddings(): Promise<Record<string, number[]> | null> {
  const client = getRedisClient();
  if (client) {
    try {
      const cached = await client.get<Record<string, number[]>>(KB_CACHE_KEY);
      if (cached) return cached;
    } catch (err) {
      console.warn("Upstash Redis getCachedEmbeddings error:", err);
    }
  }

  const entry = memoryStore.get(KB_CACHE_KEY);
  if (entry && Date.now() < entry.expiresAt) {
    try {
      return JSON.parse(entry.data);
    } catch {
      return null;
    }
  }
  return null;
}

export async function setCachedEmbeddings(
  embeddings: Record<string, number[]>,
  ttlSeconds: number = 604800 // 7 days
): Promise<void> {
  const client = getRedisClient();
  if (client) {
    try {
      await client.set(KB_CACHE_KEY, embeddings, { ex: ttlSeconds });
      return;
    } catch (err) {
      console.warn("Upstash Redis setCachedEmbeddings error:", err);
    }
  }

  memoryStore.set(KB_CACHE_KEY, {
    data: JSON.stringify(embeddings),
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

export async function checkAndSetDedupe(
  messageId: string,
  ttlSeconds: number = 86400 // 24 hours
): Promise<boolean> {
  const client = getRedisClient();
  const key = `kaamsathi:msg_dedupe:${messageId}`;

  if (client) {
    try {
      const result = await client.set(key, "1", { nx: true, ex: ttlSeconds });
      return result === "OK";
    } catch (err) {
      console.warn("Upstash Redis dedupe error, using fallback:", err);
    }
  }

  // Memory fallback
  const entry = memoryStore.get(key);
  if (entry && Date.now() < entry.expiresAt) {
    return false; // Already processed
  }

  memoryStore.set(key, {
    data: "1",
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
  return true; // Newly set
}

export async function pingRedis(): Promise<boolean> {
  const client = getRedisClient();
  if (!client) return false;
  try {
    const res = await client.ping();
    return res === "PONG" || res === "OK";
  } catch {
    return false;
  }
}

