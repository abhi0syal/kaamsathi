import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import {
  verifyWebhookSignature,
  parseWhatsAppWebhook,
  isAllowedInSandbox,
  markAsRead,
  downloadMedia,
  mapAndSendReplies,
  sendText,
} from "@/lib/channels/whatsapp";
import { checkAndSetDedupe } from "@/lib/store";
import { handleMessage } from "@/lib/core";
import { InboundMessage } from "@/lib/types";

/**
 * GET /api/whatsapp/webhook
 * Meta verification handshake.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode === "subscribe" && token && expectedToken && token === expectedToken) {
    console.log("[WhatsApp Webhook Verified]");
    return new NextResponse(challenge || "OK", { status: 200 });
  }

  return new NextResponse("Forbidden", { status: 403 });
}

/**
 * POST /api/whatsapp/webhook
 * Receives WhatsApp events, verifies signature, dedupes, returns 200 immediately,
 * and processes inbound message inside after().
 */
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-hub-signature-256");
    const appSecret = process.env.WHATSAPP_APP_SECRET;

    // Verify signature if secret is configured
    if (appSecret && appSecret !== "your_meta_app_secret_here") {
      const isValid = verifyWebhookSignature(rawBody, signature, appSecret);
      if (!isValid) {
        console.warn("Invalid WhatsApp webhook signature");
        return new NextResponse("Invalid signature", { status: 401 });
      }
    }

    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return new NextResponse("Invalid JSON", { status: 400 });
    }

    const parsed = parseWhatsAppWebhook(body);

    // If status update or empty, acknowledge immediately
    if (!parsed) {
      return new NextResponse("OK", { status: 200 });
    }

    // Deduplicate by message ID (TTL 24 hours)
    const isNew = await checkAndSetDedupe(parsed.messageId);
    if (!isNew) {
      console.log(`[WhatsApp Dedupe] Skipping duplicate message ${parsed.messageId}`);
      return new NextResponse("OK", { status: 200 });
    }

    // Non-blocking processing inside after()
    after(async () => {
      try {
        // Mark message as read
        await markAsRead(parsed.messageId);

        // Check Sandbox Mode
        if (!isAllowedInSandbox(parsed.senderPhone)) {
          await sendText(
            parsed.senderPhone,
            "⚠️ KaamSathi is currently in test mode for registered test numbers.\n\nकामसाथी वर्तमान में पंजीकृत नंबरों के लिए टेस्ट मोड में है।"
          );
          return;
        }

        let mediaBytes: Buffer | undefined;
        let mimeType: string | undefined = parsed.mimeType;

        // Download voice notes in-memory
        if (parsed.type === "audio" && parsed.mediaId) {
          const media = await downloadMedia(parsed.mediaId);
          if (media) {
            mediaBytes = media.buffer;
            mimeType = media.mimeType;
          }
        }

        const inbound: InboundMessage = {
          userId: parsed.senderPhone,
          type: parsed.type === "unsupported" ? "text" : (parsed.type as any),
          text: parsed.text,
          buttonId: parsed.buttonId,
          selectedId: parsed.selectedId,
          mediaBytes,
          mimeType,
        };

        const replies = await handleMessage(inbound);

        // Send mapped replies back to WhatsApp
        await mapAndSendReplies(parsed.senderPhone, replies);
      } catch (err) {
        console.error("Error processing WhatsApp message in after():", err);
      }
    });

    return new NextResponse("EVENT_RECEIVED", { status: 200 });
  } catch (err) {
    console.error("WhatsApp webhook route error:", err);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
