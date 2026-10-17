import crypto from "crypto";

const USER_HASH_SALT = process.env.USER_HASH_SALT || "kaamsathi_default_secure_salt_2026";

/**
 * Hashes a user identifier (such as phone number or web session ID)
 * using HMAC-SHA256 with USER_HASH_SALT.
 * Raw identifiers are never logged or stored.
 */
export function hashUserId(userId: string): string {
  if (!userId) return "unknown_user";
  return crypto
    .createHmac("sha256", USER_HASH_SALT)
    .update(userId.trim())
    .digest("hex");
}
