export type MessageType = "text" | "audio" | "image" | "location" | "button";

export interface Button {
  id: string;
  title: string; // Max 20 chars
}

export interface ListItem {
  id: string;
  title: string;
  description?: string;
}

export interface InboundMessage {
  userId: string;
  type: MessageType;
  text?: string;
  mediaBytes?: Buffer | Uint8Array | string; // base64 or buffer
  mimeType?: string;
  buttonId?: string;
  selectedId?: string;
}

export interface OutboundReply {
  text: string;
  buttons?: Button[]; // Max 3
  list?: ListItem[];  // Max 10
}

export type SupportedLanguage = "en" | "hi";

export type FlowState = 
  | "awaiting_language"
  | "awaiting_consent"
  | "menu"
  | "rights_qa"
  | "earnings"
  | "safety"
  | "document_help"
  | "grievance";

export interface UserState {
  hashedUserId: string;
  lang?: SupportedLanguage;
  consentGiven?: boolean;
  flowState: FlowState;
  lastActive: number;
}

export interface KBEntry {
  id: string;
  title: string;
  summary: string;
  eligibility_notes: string;
  how_to_apply: string;
  source_name: string;
  source_url: string;
  last_verified: string;
  embedding?: number[];
}
