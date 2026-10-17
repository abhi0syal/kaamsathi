import { describe, it, expect, beforeEach } from "vitest";
import crypto from "crypto";
import {
  verifyWebhookSignature,
  parseWhatsAppWebhook,
  isAllowedInSandbox,
} from "../lib/channels/whatsapp";
import { checkAndSetDedupe } from "../lib/store";

describe("WhatsApp Channel & Security", () => {
  const testSecret = "my_super_secret_whatsapp_app_secret_123";

  describe("Webhook Signature Verification", () => {
    it("accepts a valid HMAC-SHA256 signature", () => {
      const payload = JSON.stringify({ object: "whatsapp_business_account" });
      const hash = crypto
        .createHmac("sha256", testSecret)
        .update(payload, "utf8")
        .digest("hex");
      const signatureHeader = `sha256=${hash}`;

      const isValid = verifyWebhookSignature(payload, signatureHeader, testSecret);
      expect(isValid).toBe(true);
    });

    it("rejects a tampered signature", () => {
      const payload = JSON.stringify({ object: "whatsapp_business_account" });
      const hash = crypto
        .createHmac("sha256", testSecret)
        .update(payload, "utf8")
        .digest("hex");
      // Tamper with the hash
      const tamperedHash = "a" + hash.slice(1);
      const signatureHeader = `sha256=${tamperedHash}`;

      const isValid = verifyWebhookSignature(payload, signatureHeader, testSecret);
      expect(isValid).toBe(false);
    });

    it("rejects a tampered payload", () => {
      const payload = JSON.stringify({ object: "whatsapp_business_account" });
      const hash = crypto
        .createHmac("sha256", testSecret)
        .update(payload, "utf8")
        .digest("hex");
      const signatureHeader = `sha256=${hash}`;

      const tamperedPayload = payload + " ";
      const isValid = verifyWebhookSignature(tamperedPayload, signatureHeader, testSecret);
      expect(isValid).toBe(false);
    });

    it("rejects missing signature or missing secret", () => {
      const payload = "{}";
      expect(verifyWebhookSignature(payload, null, testSecret)).toBe(false);
      expect(verifyWebhookSignature(payload, "sha256=123", "")).toBe(false);
    });
  });

  describe("Message Deduplication", () => {
    it("accepts first message and dedupes second with identical ID", async () => {
      const uniqueMsgId = `wamid.HBgL${Date.now()}_test_unique`;

      // First call should be allowed (is new)
      const firstCheck = await checkAndSetDedupe(uniqueMsgId, 60);
      expect(firstCheck).toBe(true);

      // Second call with same ID should be rejected (duplicate)
      const secondCheck = await checkAndSetDedupe(uniqueMsgId, 60);
      expect(secondCheck).toBe(false);

      // Different ID should be allowed
      const thirdCheck = await checkAndSetDedupe(uniqueMsgId + "_diff", 60);
      expect(thirdCheck).toBe(true);
    });
  });

  describe("Payload Parsing", () => {
    it("parses incoming text message", () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      id: "wamid.12345",
                      from: "919876543210",
                      timestamp: "1700000000",
                      type: "text",
                      text: { body: "What is e-Shram?" },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const parsed = parseWhatsAppWebhook(payload);
      expect(parsed).not.toBeNull();
      expect(parsed?.type).toBe("text");
      expect(parsed?.senderPhone).toBe("919876543210");
      expect(parsed?.messageId).toBe("wamid.12345");
      expect(parsed?.text).toBe("What is e-Shram?");
    });

    it("parses interactive button reply", () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      id: "wamid.btn_reply_01",
                      from: "919876543210",
                      timestamp: "1700000000",
                      type: "interactive",
                      interactive: {
                        type: "button_reply",
                        button_reply: {
                          id: "lang_hi",
                          title: "हिंदी",
                        },
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const parsed = parseWhatsAppWebhook(payload);
      expect(parsed).not.toBeNull();
      expect(parsed?.type).toBe("button");
      expect(parsed?.buttonId).toBe("lang_hi");
      expect(parsed?.text).toBe("हिंदी");
    });

    it("parses interactive list reply", () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      id: "wamid.list_reply_01",
                      from: "919876543210",
                      timestamp: "1700000000",
                      type: "interactive",
                      interactive: {
                        type: "list_reply",
                        list_reply: {
                          id: "menu_rights",
                          title: "📜 Rights & Schemes",
                        },
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const parsed = parseWhatsAppWebhook(payload);
      expect(parsed).not.toBeNull();
      expect(parsed?.type).toBe("button");
      expect(parsed?.selectedId).toBe("menu_rights");
      expect(parsed?.text).toBe("📜 Rights & Schemes");
    });

    it("parses voice note / audio payload", () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      id: "wamid.audio_01",
                      from: "919876543210",
                      timestamp: "1700000000",
                      type: "audio",
                      audio: {
                        id: "media_id_audio_999",
                        mime_type: "audio/ogg; codecs=opus",
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const parsed = parseWhatsAppWebhook(payload);
      expect(parsed).not.toBeNull();
      expect(parsed?.type).toBe("audio");
      expect(parsed?.mediaId).toBe("media_id_audio_999");
      expect(parsed?.mimeType).toContain("audio/ogg");
    });

    it("parses location message", () => {
      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      id: "wamid.loc_01",
                      from: "919876543210",
                      timestamp: "1700000000",
                      type: "location",
                      location: {
                        latitude: 28.6139,
                        longitude: 77.209,
                        name: "New Delhi",
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const parsed = parseWhatsAppWebhook(payload);
      expect(parsed).not.toBeNull();
      expect(parsed?.type).toBe("location");
      expect(parsed?.location?.latitude).toBe(28.6139);
    });

    it("ignores status callbacks (sent, delivered, read)", () => {
      const statusPayload = {
        entry: [
          {
            changes: [
              {
                value: {
                  statuses: [
                    {
                      id: "wamid.12345",
                      status: "delivered",
                      timestamp: "1700000000",
                      recipient_id: "919876543210",
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const parsed = parseWhatsAppWebhook(statusPayload);
      expect(parsed).toBeNull();
    });
  });

  describe("Sandbox Mode", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    it("allows everyone when SANDBOX_MODE is false or unset", () => {
      process.env.SANDBOX_MODE = "false";
      expect(isAllowedInSandbox("919999999999")).toBe(true);
    });

    it("only allows listed numbers when SANDBOX_MODE is true", () => {
      process.env.SANDBOX_MODE = "true";
      process.env.ALLOWED_TEST_NUMBERS = "919876543210, 918888888888";

      // Whitelisted
      expect(isAllowedInSandbox("919876543210")).toBe(true);
      expect(isAllowedInSandbox("918888888888")).toBe(true);

      // Not whitelisted
      expect(isAllowedInSandbox("917777777777")).toBe(false);
    });
  });
});
