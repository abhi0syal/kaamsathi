import crypto from "crypto";
import { Button, ListItem, OutboundReply, InboundMessage } from "../types";
import { hashUserId } from "../crypto";

const GRAPH_API_VERSION = "v21.0";

export interface ParsedWhatsAppMessage {
  messageId: string;
  senderPhone: string;
  timestamp: string;
  type: "text" | "audio" | "image" | "location" | "button" | "unsupported";
  text?: string;
  buttonId?: string;
  selectedId?: string;
  mediaId?: string;
  mimeType?: string;
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };
}

/**
 * Constant-time HMAC-SHA256 signature verification for Meta Webhook.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string = process.env.WHATSAPP_APP_SECRET || ""
): boolean {
  if (!signatureHeader || !appSecret) {
    return false;
  }

  const parts = signatureHeader.split("=");
  if (parts.length !== 2 || parts[0] !== "sha256") {
    return false;
  }

  const signatureHash = parts[1].trim();
  const expectedHash = crypto
    .createHmac("sha256", appSecret)
    .update(rawBody, "utf8")
    .digest("hex");

  try {
    const signatureBuffer = Buffer.from(signatureHash, "hex");
    const expectedBuffer = Buffer.from(expectedHash, "hex");

    if (signatureBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

/**
 * Checks whether sender is allowed in SANDBOX_MODE.
 * Allowed phone numbers in ALLOWED_TEST_NUMBERS are evaluated by hashed ID.
 */
export function isAllowedInSandbox(senderPhone: string): boolean {
  if (process.env.SANDBOX_MODE !== "true") {
    return true; // Not in sandbox mode, all allowed
  }

  const allowedRaw = process.env.ALLOWED_TEST_NUMBERS || "";
  const allowedList = allowedRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (allowedList.length === 0) {
    return true;
  }

  const senderHash = hashUserId(senderPhone);
  for (const rawNumber of allowedList) {
    if (hashUserId(rawNumber) === senderHash || rawNumber === senderPhone) {
      return true;
    }
  }

  return false;
}

/**
 * Parses raw WhatsApp Webhook JSON body into normalized message info.
 * Returns null if payload is a status update or empty.
 */
export function parseWhatsAppWebhook(body: any): ParsedWhatsAppMessage | null {
  try {
    const entry = body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    // Ignore status callbacks (sent, delivered, read)
    if (!value || value.statuses || !value.messages || value.messages.length === 0) {
      return null;
    }

    const msg = value.messages[0];
    const senderPhone = msg.from || "unknown";
    const messageId = msg.id || (msg.timestamp ? `${senderPhone}_${msg.timestamp}` : crypto.randomUUID());
    const timestamp = msg.timestamp || String(Date.now());
    const type = msg.type;

    if (type === "text") {
      return {
        messageId,
        senderPhone,
        timestamp,
        type: "text",
        text: msg.text?.body || "",
      };
    }

    if (type === "audio") {
      return {
        messageId,
        senderPhone,
        timestamp,
        type: "audio",
        mediaId: msg.audio?.id,
        mimeType: msg.audio?.mime_type || "audio/ogg; codecs=opus",
      };
    }

    if (type === "image") {
      return {
        messageId,
        senderPhone,
        timestamp,
        type: "image",
        mediaId: msg.image?.id,
        mimeType: msg.image?.mime_type || "image/jpeg",
        text: msg.image?.caption || "",
      };
    }

    if (type === "location") {
      return {
        messageId,
        senderPhone,
        timestamp,
        type: "location",
        location: {
          latitude: msg.location?.latitude,
          longitude: msg.location?.longitude,
          name: msg.location?.name,
          address: msg.location?.address,
        },
      };
    }

    if (type === "interactive") {
      const interactive = msg.interactive;
      if (interactive.type === "button_reply") {
        return {
          messageId,
          senderPhone,
          timestamp,
          type: "button",
          buttonId: interactive.button_reply?.id,
          text: interactive.button_reply?.title,
        };
      }
      if (interactive.type === "list_reply") {
        return {
          messageId,
          senderPhone,
          timestamp,
          type: "button",
          selectedId: interactive.list_reply?.id,
          buttonId: interactive.list_reply?.id,
          text: interactive.list_reply?.title,
        };
      }
    }

    return {
      messageId,
      senderPhone,
      timestamp,
      type: "unsupported",
    };
  } catch (err) {
    console.error("Failed to parse WhatsApp payload:", err);
    return null;
  }
}

/**
 * Sends request to WhatsApp Cloud API messages endpoint.
 */
async function sendWhatsAppRequest(payload: Record<string, any>): Promise<boolean> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneId || token === "your_meta_whatsapp_access_token") {
    console.log("[WhatsApp Mock Send]:", JSON.stringify(payload));
    return true;
  }

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneId}/messages`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      console.error("WhatsApp API send error:", res.status, errJson);
      return false;
    }
    return true;
  } catch (err) {
    console.error("WhatsApp network send error:", err);
    return false;
  }
}

/**
 * Sends plain text message.
 */
export async function sendText(to: string, text: string): Promise<boolean> {
  return sendWhatsAppRequest({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { preview_url: false, body: text },
  });
}

/**
 * Sends interactive button message (max 3 buttons, title <= 20 chars).
 */
export async function sendButtons(
  to: string,
  text: string,
  buttons: Button[]
): Promise<boolean> {
  const safeButtons = buttons.slice(0, 3).map((b) => ({
    type: "reply",
    reply: {
      id: b.id,
      title: b.title.length > 20 ? b.title.slice(0, 17) + "..." : b.title,
    },
  }));

  return sendWhatsAppRequest({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text },
      action: { buttons: safeButtons },
    },
  });
}

/**
 * Sends interactive list message (max 10 items, title <= 24 chars).
 */
export async function sendList(
  to: string,
  text: string,
  list: ListItem[],
  buttonTitle: string = "Options"
): Promise<boolean> {
  const safeRows = list.slice(0, 10).map((item) => ({
    id: item.id,
    title: item.title.length > 24 ? item.title.slice(0, 21) + "..." : item.title,
    description: item.description
      ? item.description.length > 70
        ? item.description.slice(0, 67) + "..."
        : item.description
      : undefined,
  }));

  return sendWhatsAppRequest({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text },
      action: {
        button: buttonTitle.length > 20 ? buttonTitle.slice(0, 17) + "..." : buttonTitle,
        sections: [
          {
            title: "Menu",
            rows: safeRows,
          },
        ],
      },
    },
  });
}

/**
 * Marks an incoming WhatsApp message as read.
 */
export async function markAsRead(messageId: string): Promise<boolean> {
  return sendWhatsAppRequest({
    messaging_product: "whatsapp",
    status: "read",
    message_id: messageId,
  });
}

/**
 * Downloads media from Meta Graph API in memory only (never written to disk).
 */
export async function downloadMedia(
  mediaId: string
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const token = process.env.WHATSAPP_TOKEN;
  if (!token || token === "your_meta_whatsapp_access_token") {
    return null;
  }

  try {
    // 1. Get media URL
    const metaRes = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${mediaId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (!metaRes.ok) {
      console.error("Failed to query media metadata:", metaRes.status);
      return null;
    }

    const metaData = await metaRes.json();
    const mediaUrl = metaData.url;
    const mimeType = metaData.mime_type || "audio/ogg";

    // 2. Download media bytes
    const fileRes = await fetch(mediaUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!fileRes.ok) {
      console.error("Failed to download media file:", fileRes.status);
      return null;
    }

    const arrayBuffer = await fileRes.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      mimeType,
    };
  } catch (err) {
    console.error("Download media error:", err);
    return null;
  }
}

/**
 * Maps core OutboundReply[] to corresponding WhatsApp Cloud API messages.
 */
export async function mapAndSendReplies(
  to: string,
  replies: OutboundReply[]
): Promise<void> {
  for (const reply of replies) {
    if (reply.list && reply.list.length > 0) {
      await sendList(to, reply.text, reply.list, "Options / विकल्प");
    } else if (reply.buttons && reply.buttons.length > 0) {
      await sendButtons(to, reply.text, reply.buttons);
    } else {
      await sendText(to, reply.text);
    }
  }
}
