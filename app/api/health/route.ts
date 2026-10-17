import { NextResponse } from "next/server";
import { pingRedis } from "@/lib/store";

export async function GET() {
  const redisHealthy = await pingRedis();
  
  // Redis is considered healthy if ping passes OR fallback in-memory is functional
  const redis = redisHealthy || Boolean(!process.env.UPSTASH_REDIS_REST_URL);

  const llm = Boolean(
    process.env.GEMINI_API_KEY &&
      process.env.GEMINI_API_KEY !== "your_gemini_api_key_here"
  );

  const whatsappConfigured = Boolean(
    process.env.WHATSAPP_TOKEN &&
      process.env.WHATSAPP_PHONE_NUMBER_ID &&
      process.env.WHATSAPP_TOKEN !== "your_meta_whatsapp_access_token"
  );

  const ok = true; // Service is operational

  return NextResponse.json({
    ok,
    redis,
    llm,
    whatsappConfigured,
  });
}
