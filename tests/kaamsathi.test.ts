import { describe, it, expect, beforeEach } from "vitest";
import { handleMessage } from "../lib/core";
import { answerWithSources, CONFIDENCE_THRESHOLD, retrieveTopK } from "../lib/rag";
import { deleteUserData, getUserState, setUserState } from "../lib/store";
import { hashUserId } from "../lib/crypto";

describe("KaamSathi Core & Trust Engine", () => {
  const testUserId = "test_worker_phone_9876543210";
  const hashed = hashUserId(testUserId);

  beforeEach(async () => {
    await deleteUserData(hashed);
  });

  describe("Command Routing", () => {
    it("routes first interaction to language selection with 2 buttons", async () => {
      const replies = await handleMessage({
        userId: testUserId,
        type: "text",
        text: "hello",
      });

      expect(replies).toHaveLength(1);
      expect(replies[0].buttons).toBeDefined();
      expect(replies[0].buttons).toHaveLength(2);
      expect(replies[0].buttons![0].id).toBe("lang_en");
      expect(replies[0].buttons![1].id).toBe("lang_hi");
    });

    it("handles language selection and displays consent message", async () => {
      // First handshake
      await handleMessage({ userId: testUserId, type: "text", text: "hi" });

      // Pick Hindi
      const consentReplies = await handleMessage({
        userId: testUserId,
        type: "button",
        buttonId: "lang_hi",
      });

      expect(consentReplies).toHaveLength(1);
      expect(consentReplies[0].text).toContain("गोपनीयता");
      expect(consentReplies[0].buttons![0].id).toBe("consent_agree");
    });

    it("processes consent agreement and transitions to Main Menu", async () => {
      // Setup state in consent
      await setUserState(hashed, {
        hashedUserId: hashed,
        lang: "en",
        flowState: "awaiting_consent",
        lastActive: Date.now(),
      });

      const menuReplies = await handleMessage({
        userId: testUserId,
        type: "button",
        buttonId: "consent_agree",
      });

      expect(menuReplies.length).toBeGreaterThanOrEqual(1);
      const menuMsg = menuReplies.find((r) => r.list && r.list.length > 0);
      expect(menuMsg).toBeDefined();
      expect(menuMsg!.list!.length).toBe(5);
      expect(menuMsg!.list![0].id).toBe("menu_earnings");
      expect(menuMsg!.list![2].id).toBe("menu_rights");
    });

    it("DELETE MY DATA command wipes all keys and confirms deletion", async () => {
      // Pre-populate state
      await setUserState(hashed, {
        hashedUserId: hashed,
        lang: "en",
        consentGiven: true,
        flowState: "menu",
        lastActive: Date.now(),
      });

      const replies = await handleMessage({
        userId: testUserId,
        type: "text",
        text: "DELETE MY DATA",
      });

      expect(replies).toHaveLength(1);
      expect(replies[0].text).toContain("completely erased");

      // Verify state was destroyed
      const stateAfter = await getUserState(hashed);
      expect(stateAfter).toBeNull();
    });

    it("LANGUAGE command re-prompts language selection from any state", async () => {
      await setUserState(hashed, {
        hashedUserId: hashed,
        lang: "hi",
        flowState: "rights_qa",
        lastActive: Date.now(),
      });

      const replies = await handleMessage({
        userId: testUserId,
        type: "text",
        text: "LANGUAGE",
      });

      expect(replies[0].buttons).toHaveLength(2);
      expect(replies[0].buttons![0].id).toBe("lang_en");
      expect(replies[0].buttons![1].id).toBe("lang_hi");
    });
  });

  describe("Trust & RAG Verification", () => {
    it("refuses unknown or fake schemes below confidence threshold", async () => {
      const fakeSchemeQuestion = "How do I get free 50,000 cash bonus under Pradhan Mantri Free Money Gift Yojana?";
      const response = await answerWithSources(fakeSchemeQuestion, "en");

      // Should be refused
      expect(response.refused).toBe(true);
      expect(response.answer).toContain("I don't have verified information on this");
      expect(response.answer).toContain("14434"); // e-Shram helpline
    });

    it("refuses fake schemes in Hindi with localized helpline recommendation", async () => {
      const fakeSchemeHindi = "फ्री में 5 लाख रुपये कैश देने वाली नई सरकारी गिफ्ट योजना का फॉर्म कैसे भरें?";
      const response = await answerWithSources(fakeSchemeHindi, "hi");

      expect(response.refused).toBe(true);
      expect(response.answer).toContain("सत्यापित सरकारी जानकारी नहीं है");
      expect(response.answer).toContain("14434");
    });

    it("answers real schemes with full official source citations and verification dates", async () => {
      const realQuestion = "What is the e-Shram portal and what are the eligibility requirements?";
      const response = await answerWithSources(realQuestion, "en");

      expect(response.refused).toBe(false);
      expect(response.sources.length).toBeGreaterThan(0);
      expect(response.answer).toContain("Source:");
      expect(response.answer).toContain("https://eshram.gov.in");
      expect(response.answer).toContain("checked 2026-10-17");
    });

    it("verifies PMSBY insurance benefit and citation", async () => {
      const realQuestion = "What is PMSBY accident insurance premium and sum insured?";
      const response = await answerWithSources(realQuestion, "en");

      expect(response.refused).toBe(false);
      expect(response.answer).toContain("Source:");
      expect(response.answer).toContain("https://jansuraksha.gov.in");
    });

    it("enforces WhatsApp button limits (max 3 buttons, title <= 20 chars)", async () => {
      await setUserState(hashed, {
        hashedUserId: hashed,
        lang: "en",
        flowState: "menu",
        lastActive: Date.now(),
      });

      const replies = await handleMessage({
        userId: testUserId,
        type: "button",
        buttonId: "menu_rights",
      });

      expect(replies[0].buttons).toBeDefined();
      expect(replies[0].buttons!.length).toBeLessThanOrEqual(3);
      for (const btn of replies[0].buttons!) {
        expect(btn.title.length).toBeLessThanOrEqual(20);
      }
    });
  });
});
