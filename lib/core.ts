import {
  InboundMessage,
  OutboundReply,
  UserState,
  SupportedLanguage,
  Button,
  ListItem,
} from "./types";
import { hashUserId } from "./crypto";
import { getUserState, setUserState, deleteUserData } from "./store";
import { answerWithSources } from "./rag";
import { classifyIntent } from "./intent";
import { GoogleGenAI } from "@google/genai";

/**
 * Truncate button titles to 20 chars (WhatsApp Cloud API hard constraint)
 * and ensure max 3 buttons.
 */
function sanitizeButtons(buttons?: Button[]): Button[] | undefined {
  if (!buttons || buttons.length === 0) return undefined;
  return buttons.slice(0, 3).map((b) => ({
    id: b.id,
    title: b.title.length > 20 ? b.title.slice(0, 17) + "..." : b.title,
  }));
}

/**
 * Sanitize list items (max 10 items)
 */
function sanitizeList(list?: ListItem[]): ListItem[] | undefined {
  if (!list || list.length === 0) return undefined;
  return list.slice(0, 10).map((item) => ({
    id: item.id,
    title: item.title.length > 24 ? item.title.slice(0, 21) + "..." : item.title,
    description: item.description
      ? item.description.length > 70
        ? item.description.slice(0, 67) + "..."
        : item.description
      : undefined,
  }));
}

function createReply(
  text: string,
  buttons?: Button[],
  list?: ListItem[]
): OutboundReply {
  return {
    text: text.trim(),
    buttons: sanitizeButtons(buttons),
    list: sanitizeList(list),
  };
}

/**
 * Standard Main Menu list
 */
function getMainMenu(lang: SupportedLanguage = "en"): OutboundReply {
  if (lang === "hi") {
    return createReply(
      "नीचे मेनू से एक विकल्प चुनें: 📋",
      [
        { id: "menu_rights", title: "📜 योजनाएं व अधिकार" },
        { id: "menu_earnings", title: "💰 कमाई" },
        { id: "menu_safety", title: "🛡️ सुरक्षा" },
      ],
      [
        { id: "menu_earnings", title: "💰 कमाई (Earnings)", description: "दैनिक कमाई और पेट्रोल खर्च" },
        { id: "menu_safety", title: "🛡️ सुरक्षा (Safety)", description: "सड़क सुरक्षा और मौसम नियम" },
        { id: "menu_rights", title: "📜 योजनाएं (Schemes)", description: "ई-श्रम, बीमा व सरकारी लाभ" },
        { id: "menu_docs", title: "📄 दस्तावेज़ (Docs)", description: "आधार, पैन व आरसी सहायता" },
        { id: "menu_complaint", title: "✍️ शिकायत (Complaint)", description: "कंपनी के लिए शिकायत पत्र" },
      ]
    );
  }

  return createReply(
    "Choose an option from the menu: 📋",
    [
      { id: "menu_rights", title: "📜 Rights & Schemes" },
      { id: "menu_earnings", title: "💰 Earnings" },
      { id: "menu_safety", title: "🛡️ Safety" },
    ],
    [
      { id: "menu_earnings", title: "💰 Earnings", description: "Log daily trips and fuel expenses" },
      { id: "menu_safety", title: "🛡️ Safety", description: "Road safety tips & weather advice" },
      { id: "menu_rights", title: "📜 Rights & Schemes", description: "e-Shram, insurance & govt welfare" },
      { id: "menu_docs", title: "📄 Document Help", description: "Aadhaar, PAN & ID guidance" },
      { id: "menu_complaint", title: "✍️ Write a Complaint", description: "Draft formal grievance against platform" },
    ]
  );
}

/**
 * Transcribes audio buffer/base64 using Gemini
 */
async function transcribeAudio(
  mediaBytes: Buffer | Uint8Array | string,
  mimeType: string = "audio/ogg"
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "your_gemini_api_key_here") {
    return "";
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    let base64Data: string;
    if (typeof mediaBytes === "string") {
      base64Data = mediaBytes.includes(",") ? mediaBytes.split(",")[1] : mediaBytes;
    } else {
      base64Data = Buffer.from(mediaBytes).toString("base64");
    }

    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      contents: [
        {
          inlineData: {
            mimeType: mimeType.split(";")[0],
            data: base64Data,
          },
        },
        {
          text: "Transcribe this audio verbatim in its original spoken language (Hindi, English, or Hinglish). Output ONLY the transcript text with no extra commentary.",
        },
      ],
    });

    return (response?.text || "").trim();
  } catch (err) {
    console.error("Audio transcription error:", err);
    return "";
  }
}

/**
 * Primary Channel-Agnostic Core Message Handler
 */
export async function handleMessage(
  inbound: InboundMessage
): Promise<OutboundReply[]> {
  const hashedUserId = hashUserId(inbound.userId);
  let state = await getUserState(hashedUserId);

  let rawText = (inbound.text || inbound.buttonId || inbound.selectedId || "").trim();

  // If audio, transcribe
  if (inbound.type === "audio") {
    if (inbound.mediaBytes) {
      const transcript = await transcribeAudio(inbound.mediaBytes, inbound.mimeType);
      rawText = transcript;
    }
    if (!rawText) {
      const isHi = state?.lang === "hi";
      return [
        createReply(
          isHi
            ? "आवाज़ स्पष्ट नहीं थी। 🎙️ कृपया दोबारा बोलें या नीचे लिखकर पूछें।"
            : "Could not hear audio clearly. 🎙️ Please record again or type your question.",
          [{ id: "cmd_menu", title: isHi ? "🏠 मुख्य मेनू" : "🏠 Main Menu" }]
        ),
      ];
    }
  }

  const normalizedInput = rawText.toUpperCase();

  // 1. GLOBAL COMMAND: DELETE MY DATA
  if (
    normalizedInput === "DELETE MY DATA" ||
    normalizedInput === "DELETE DATA" ||
    normalizedInput === "डेटा डिलीट करें"
  ) {
    await deleteUserData(hashedUserId);
    return [
      createReply(
        state?.lang === "hi"
          ? "आपका सारा डेटा हमारे सर्वर से पूरी तरह हटा दिया गया है। 🗑️\n\nदोबारा शुरू करने के लिए 'नमस्ते' लिखें।"
          : "Your data has been completely erased from our servers. 🗑️\n\nSend 'Hi' or click below to start fresh.",
        [{ id: "cmd_start", title: "Start Fresh / शुरू" }]
      ),
    ];
  }

  // 2. GLOBAL COMMAND: LANGUAGE
  if (
    normalizedInput === "LANGUAGE" ||
    normalizedInput === "LANG" ||
    normalizedInput === "भाषा" ||
    inbound.buttonId === "cmd_lang"
  ) {
    const nextState: UserState = {
      hashedUserId,
      consentGiven: state?.consentGiven || false,
      flowState: "awaiting_language",
      lastActive: Date.now(),
    };
    await setUserState(hashedUserId, nextState);

    return [
      createReply(
        "Please choose your language / कृपया अपनी भाषा चुनें: 🌐",
        [
          { id: "lang_en", title: "English" },
          { id: "lang_hi", title: "हिंदी" },
        ]
      ),
    ];
  }

  // 3. GLOBAL COMMAND: HELP
  if (
    normalizedInput === "HELP" ||
    normalizedInput === "मदद" ||
    normalizedInput === "सहायता"
  ) {
    const isHi = state?.lang === "hi";
    return [
      createReply(
        isHi
          ? "कामसाथी गिग और असंगठित कामगारों के लिए सहायक है। 🤝\n\n- MENU: विकल्प देखें\n- LANGUAGE: भाषा बदलें\n- DELETE MY DATA: डेटा हटाएं"
          : "KaamSathi supports gig and informal workers with schemes, rights, and earnings. 🤝\n\n- MENU: View options\n- LANGUAGE: Change lang\n- DELETE MY DATA: Wipe data",
        [
          { id: "cmd_menu", title: isHi ? "🏠 मुख्य मेनू" : "🏠 Main Menu" },
          { id: "cmd_lang", title: "🌐 Language / भाषा" },
        ]
      ),
    ];
  }

  // 4. GLOBAL COMMAND: MENU
  if (
    normalizedInput === "MENU" ||
    normalizedInput === "MAIN MENU" ||
    normalizedInput === "मेनू" ||
    inbound.buttonId === "cmd_menu" ||
    inbound.buttonId === "cmd_start"
  ) {
    const currentLang = state?.lang || "en";
    const nextState: UserState = {
      hashedUserId,
      lang: currentLang,
      consentGiven: state?.consentGiven || false,
      flowState: "menu",
      lastActive: Date.now(),
    };
    await setUserState(hashedUserId, nextState);
    return [getMainMenu(currentLang)];
  }

  // First interaction (no state exists yet)
  if (!state) {
    const newState: UserState = {
      hashedUserId,
      flowState: "awaiting_language",
      lastActive: Date.now(),
    };
    await setUserState(hashedUserId, newState);

    return [
      createReply(
        "Namaste! Welcome to KaamSathi 🙏\nPlease select your preferred language:\n\nनमस्ते! कामसाथी में स्वागत है। कृपया भाषा चुनें:",
        [
          { id: "lang_en", title: "English" },
          { id: "lang_hi", title: "हिंदी" },
        ]
      ),
    ];
  }

  // State 1: Awaiting Language
  if (state.flowState === "awaiting_language") {
    let chosenLang: SupportedLanguage = "en";
    if (
      inbound.buttonId === "lang_hi" ||
      rawText.toLowerCase() === "hindi" ||
      rawText === "हिंदी" ||
      rawText === "2"
    ) {
      chosenLang = "hi";
    } else if (
      inbound.buttonId === "lang_en" ||
      rawText.toLowerCase() === "english" ||
      rawText === "1"
    ) {
      chosenLang = "en";
    }

    state.lang = chosenLang;
    state.flowState = "awaiting_consent";
    state.lastActive = Date.now();
    await setUserState(hashedUserId, state);

    if (chosenLang === "hi") {
      return [
        createReply(
          "🔒 **गोपनीयता व सहमति (DPDP)**:\nहम केवल आपकी भाषा और आपकी प्रविष्टियाँ सुरक्षित अज्ञात आईडी में रखते हैं।\n\nफ़ोटो, ऑडियो या फ़ोन नंबर कभी स्टोर नहीं होते। डेटा हटाने के लिए DELETE MY DATA भेजें।\n\nक्या आप सहमत हैं?",
          [{ id: "consent_agree", title: "✅ सहमत हूँ (Agree)" }]
        ),
      ];
    }

    return [
      createReply(
        "🔒 **Privacy & Consent (DPDP)**:\nWe only store your chosen language and your own entries under a secure anonymous ID.\n\nNever stored: photos, voice audio, or phone numbers. To wipe records, send DELETE MY DATA.\n\nDo you agree to continue?",
        [{ id: "consent_agree", title: "✅ Agree / सहमत" }]
      ),
    ];
  }

  // State 2: Awaiting Consent
  if (state.flowState === "awaiting_consent") {
    if (
      inbound.buttonId === "consent_agree" ||
      normalizedInput.includes("AGREE") ||
      normalizedInput.includes("सहमत") ||
      normalizedInput.includes("YES") ||
      normalizedInput.includes("हाँ")
    ) {
      state.consentGiven = true;
      state.flowState = "menu";
      state.lastActive = Date.now();
      await setUserState(hashedUserId, state);

      const welcomeText =
        state.lang === "hi"
          ? "धन्यवाद! कामसाथी में आपका स्वागत है। 🤝"
          : "Thank you! Welcome to KaamSathi. 🤝";

      return [createReply(welcomeText), getMainMenu(state.lang)];
    }

    // Re-prompt consent
    return [
      createReply(
        state.lang === "hi"
          ? "कृपया आगे बढ़ने के लिए नीचे दिए गए 'सहमत हूँ' बटन पर क्लिक करें:"
          : "Please tap the 'Agree' button below to continue:",
        [{ id: "consent_agree", title: state.lang === "hi" ? "✅ सहमत हूँ" : "✅ Agree" }]
      ),
    ];
  }

  const currentLang = state.lang || "en";

  // State 3: Menu Buttons / Clicks
  const triggerId = inbound.buttonId || inbound.selectedId || "";

  if (triggerId === "menu_rights") {
    state.flowState = "rights_qa";
    state.lastActive = Date.now();
    await setUserState(hashedUserId, state);

    return [
      createReply(
        currentLang === "hi"
          ? "सरकारी योजनाओं या कामगार अधिकारों पर कोई भी सवाल पूछें! 📜\n(जैसे: ई-श्रम, जीवन ज्योति बीमा, पेंशन, या मोटर वाहन नियम)"
          : "Ask any question about government schemes or gig worker rights! 📜\n(e.g., e-Shram card, PMJJBY insurance, pension, or traffic rules)",
        [
          { id: "q_eshram", title: currentLang === "hi" ? "ई-श्रम कार्ड?" : "e-Shram card?" },
          { id: "q_pmjjby", title: currentLang === "hi" ? "PMJJBY बीमा?" : "PMJJBY Insurance?" },
          { id: "cmd_menu", title: currentLang === "hi" ? "🏠 मुख्य मेनू" : "🏠 Main Menu" },
        ]
      ),
    ];
  }

  if (triggerId === "menu_earnings") {
    state.flowState = "earnings";
    await setUserState(hashedUserId, state);
    return [createReply(currentLang === "hi"
      ? "आज की कमाई और खर्च लिखें। उदाहरण: कमाई 1200, पेट्रोल 200, खाना 80।"
      : "Enter today's earnings and expenses. Example: earnings 1200, fuel 200, food 80. I'll calculate an estimate.")];
  }

  if (triggerId === "menu_safety") {
    return [createReply(currentLang === "hi"
      ? "🛡️ सुरक्षा: हेलमेट बाँधें, वाहन चलाते समय फोन न देखें, ब्रेक/टायर/लाइट जाँचें और थकान या खराब दृश्यता में सुरक्षित जगह रुकें। तत्काल आपातकाल में भारत में 112 पर कॉल करें।"
      : "🛡️ Safety: wear a fastened helmet, never use your phone while driving, check brakes/tyres/lights, and stop safely if tired or visibility is poor. For an immediate emergency in India, call 112.")];
  }

  if (triggerId === "menu_docs") {
    state.flowState = "document_help";
    await setUserState(hashedUserId, state);
    return [createReply(currentLang === "hi"
      ? "नोटिस या दस्तावेज़ का टेक्स्ट लिखें, मैं सरल भाषा में समझाऊँगा। आधार/बैंक नंबर या OTP साझा न करें।"
      : "Paste text from a notice or document and I'll explain it simply. Do not share Aadhaar/bank numbers or OTPs.")];
  }

  if (triggerId === "menu_complaint") {
    state.flowState = "grievance";
    await setUserState(hashedUserId, state);
    return [createReply(currentLang === "hi"
      ? "कंपनी/ऐप, समस्या, तारीख और राशि लिखें। संवेदनशील जानकारी न भेजें। मैं समीक्षा के लिए शिकायत ड्राफ्ट बनाऊँगा; यह अपने-आप नहीं भेजा जाएगा।"
      : "Send the company/app, issue, date and amount. Do not include sensitive IDs. I'll draft a complaint for your review; it won't be sent automatically.")];
  }

  // Handle feature-specific free text before the government-scheme RAG path.
  if (state.flowState === "earnings" && rawText && !triggerId) {
    const nums = rawText.match(/\\d[\\d,]*(?:\\.\\d{1,2})?/g);
    const values = (nums || []).map((v) => Number(v.replace(/,/g, ""))).filter((v) => Number.isFinite(v) && v >= 0);
    if (values.length < 2) return [createReply(currentLang === "hi" ? "कमाई और कम-से-कम एक खर्च लिखें। उदाहरण: कमाई 1200, पेट्रोल 200।" : "Please include earnings and at least one expense. Example: earnings 1200, fuel 200.")];
    const money = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
    const income = values[0];
    const costs = values.slice(1).reduce((sum, n) => sum + n, 0);
    return [createReply(currentLang === "hi"
      ? "💰 अनुमानित हिसाब\\nकमाई: " + money(income) + "\\nदर्ज खर्च: " + money(costs) + "\\nखर्च के बाद: " + money(income - costs) + "\\nयह आपके संदेश में दिए गए अंकों पर आधारित है।"
      : "💰 Earnings estimate\\nEarnings: " + money(income) + "\\nExpenses (remaining amounts): " + money(costs) + "\\nAfter expenses: " + money(income - costs) + "\\nBased only on the numbers you provided.")];
  }

  if (state.flowState === "grievance" && rawText && !triggerId) {
    const draft = currentLang === "hi"
      ? "शिकायत का मसौदा — भेजने से पहले जाँचें\\n\\nसेवा टीम के नाम,\\n\\nमैं इस समस्या की शिकायत दर्ज करना चाहता/चाहती हूँ: " + rawText + "\\nकृपया जाँच करें, समाधान और समय-सीमा लिखित में दें तथा शिकायत संख्या साझा करें।\\n\\nसादर,\\n[अपना नाम भरें]"
      : "Complaint draft — review before sending\\n\\nTo the Support Team,\\n\\nI am raising a complaint about: " + rawText + "\\nPlease investigate, explain the resolution and timeline in writing, and share a complaint reference number.\\n\\nRegards,\\n[Your name]";
    return [createReply(draft + (currentLang === "hi" ? "\\n\\nतथ्य जाँचें और केवल सही जानकारी भेजें।" : "\\n\\nCheck facts and edit placeholders before sending."))];
  }

  if (state.flowState === "document_help" && rawText && !triggerId) {
    const answer = await answerWithSources(
      (currentLang === "hi" ? "दिए गए दस्तावेज़ के पाठ को सरल हिंदी में समझाएं। जानकारी न गढ़ें। पाठ: " : "Explain the following document text in simple English without inventing details. Text: ") + rawText,
      currentLang
    );
    return [createReply(answer.answer)];
  }

  // Pre-set quick questions
  if (triggerId === "q_eshram") {
    rawText = "What is e-Shram portal and who is eligible?";
  } else if (triggerId === "q_pmjjby") {
    rawText = "What is PMJJBY insurance premium and benefit?";
  }

  // If in rights_qa state or user typed a question in menu
  if (state.flowState === "rights_qa" || rawText.length > 0) {
    // If user is in menu and typed free text, run intent router
    if (state.flowState === "menu" && !triggerId) {
      const intent = await classifyIntent(rawText);

      if (intent.category === "earnings") {
        return [
          createReply(
            currentLang === "hi"
              ? "💰 कमाई ट्रैकिंग मॉड्यूल अगले चरण में आ रहा है!"
              : "💰 Earnings tracking module is coming in the next step!",
            [
              { id: "menu_rights", title: currentLang === "hi" ? "📜 योजनाएं देखें" : "📜 Schemes & Rights" },
              { id: "cmd_menu", title: currentLang === "hi" ? "🏠 मुख्य मेनू" : "🏠 Main Menu" },
            ]
          ),
        ];
      }
      if (intent.category === "safety") {
        return [
          createReply(
            currentLang === "hi"
              ? "🛡️ सुरक्षा मॉड्यूल अगले चरण में आ रहा है!"
              : "🛡️ Safety module is coming in the next step!",
            [
              { id: "menu_rights", title: currentLang === "hi" ? "📜 योजनाएं देखें" : "📜 Schemes & Rights" },
              { id: "cmd_menu", title: currentLang === "hi" ? "🏠 मुख्य मेनू" : "🏠 Main Menu" },
            ]
          ),
        ];
      }
      if (intent.category === "document_help") {
        return [
          createReply(
            currentLang === "hi"
              ? "📄 दस्तावेज़ सहायता मॉड्यूल अगले चरण में आ रहा है!"
              : "📄 Document help module is coming in the next step!",
            [
              { id: "menu_rights", title: currentLang === "hi" ? "📜 योजनाएं देखें" : "📜 Schemes & Rights" },
              { id: "cmd_menu", title: currentLang === "hi" ? "🏠 मुख्य मेनू" : "🏠 Main Menu" },
            ]
          ),
        ];
      }
      if (intent.category === "complaint") {
        return [
          createReply(
            currentLang === "hi"
              ? "✍️ शिकायत लेखन मॉड्यूल अगले चरण में आ रहा है!"
              : "✍️ Write a Complaint module is coming in the next step!",
            [
              { id: "menu_rights", title: currentLang === "hi" ? "📜 योजनाएं देखें" : "📜 Schemes & Rights" },
              { id: "cmd_menu", title: currentLang === "hi" ? "🏠 मुख्य मेनू" : "🏠 Main Menu" },
            ]
          ),
        ];
      }
    }

    // Answer via verified KB RAG pipeline
    const answerResult = await answerWithSources(rawText, currentLang);

    return [
      createReply(
        answerResult.answer,
        [
          { id: "menu_rights", title: currentLang === "hi" ? "❓ दूसरा सवाल" : "❓ Ask Another" },
          { id: "cmd_menu", title: currentLang === "hi" ? "🏠 मुख्य मेनू" : "🏠 Main Menu" },
        ]
      ),
    ];
  }

  // Default fallback
  return [getMainMenu(currentLang)];
}
