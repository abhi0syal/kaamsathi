"use client";

import React, { useState, useEffect, useRef } from "react";
import { Mic, Send, Square, CheckCheck, RefreshCw, Trash2, Globe, Menu } from "lucide-react";
import { OutboundReply, Button, ListItem } from "@/lib/types";

interface ChatMessage {
  id: string;
  sender: "user" | "bot";
  text: string;
  buttons?: Button[];
  list?: ListItem[];
  time: string;
}

export default function WebChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [userId, setUserId] = useState("web_demo_user_1");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Initialize unique user session
  useEffect(() => {
    let savedId = localStorage.getItem("kaamsathi_web_uid");
    if (!savedId) {
      savedId = "web_" + Math.random().toString(36).substring(2, 10);
      localStorage.setItem("kaamsathi_web_uid", savedId);
    }
    setUserId(savedId);

    // Initial bot handshake
    initChat(savedId);
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const getTimeString = () => {
    const now = new Date();
    return now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const initChat = async (uid: string) => {
    setLoading(true);
    try {
      const res = await fetch("/api/web/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: uid, type: "text", text: "hi" }),
      });
      const data = await res.json();
      if (data.replies && data.replies.length > 0) {
        const botMsgs: ChatMessage[] = data.replies.map((r: OutboundReply, idx: number) => ({
          id: `init_${Date.now()}_${idx}`,
          sender: "bot",
          text: r.text,
          buttons: r.buttons,
          list: r.list,
          time: getTimeString(),
        }));
        setMessages(botMsgs);
      }
    } catch (err) {
      console.error("Init chat error:", err);
    } finally {
      setLoading(false);
    }
  };

  const sendMessagePayload = async (payload: {
    type: "text" | "audio" | "button";
    text?: string;
    buttonId?: string;
    selectedId?: string;
    mediaBytes?: string;
    mimeType?: string;
  }) => {
    const userMsgId = `usr_${Date.now()}`;
    const displayText = payload.text || (payload.type === "audio" ? "🎙️ [Voice Note]" : "");

    if (displayText) {
      setMessages((prev) => [
        ...prev,
        {
          id: userMsgId,
          sender: "user",
          text: displayText,
          time: getTimeString(),
        },
      ]);
    }

    setLoading(true);
    try {
      const res = await fetch("/api/web/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          ...payload,
        }),
      });

      const data = await res.json();
      if (data.replies && data.replies.length > 0) {
        const botMsgs: ChatMessage[] = data.replies.map((r: OutboundReply, idx: number) => ({
          id: `bot_${Date.now()}_${idx}`,
          sender: "bot",
          text: r.text,
          buttons: r.buttons,
          list: r.list,
          time: getTimeString(),
        }));
        setMessages((prev) => [...prev, ...botMsgs]);
      }
    } catch (err) {
      console.error("Send error:", err);
      setMessages((prev) => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          sender: "bot",
          text: "⚠️ Connection error. Please try again.",
          time: getTimeString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleSendText = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || loading) return;
    const txt = inputText.trim();
    setInputText("");
    sendMessagePayload({ type: "text", text: txt });
  };

  const handleButtonClick = (button: Button) => {
    if (loading) return;
    sendMessagePayload({
      type: "button",
      buttonId: button.id,
      text: button.title,
    });
  };

  const handleListItemClick = (item: ListItem) => {
    if (loading) return;
    sendMessagePayload({
      type: "button",
      selectedId: item.id,
      buttonId: item.id,
      text: item.title,
    });
  };

  // Mic voice recording with MediaRecorder
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, {
          type: mediaRecorder.mimeType || "audio/webm",
        });

        // Convert blob to base64
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64Data = reader.result as string;
          sendMessagePayload({
            type: "audio",
            mediaBytes: base64Data,
            mimeType: audioBlob.type,
          });
        };
        reader.readAsDataURL(audioBlob);

        // Stop all audio tracks
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.warn("Microphone access denied or error:", err);
      alert("Microphone permission was not granted. You can type your message.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  return (
    <div className="w-full max-w-md h-[100dvh] sm:h-[92vh] sm:rounded-3xl shadow-2xl bg-[#efeae2] flex flex-col overflow-hidden border border-slate-300">
      {/* WhatsApp Green Top Bar */}
      <header className="bg-[#075E54] text-white px-4 py-3 flex items-center justify-between shadow-md z-10">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-full bg-emerald-700 flex items-center justify-center font-bold text-lg border-2 border-emerald-400">
            🤝
          </div>
          <div>
            <h1 className="font-semibold text-base leading-tight">KaamSathi (कामसाथी)</h1>
            <p className="text-xs text-emerald-200 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block animate-pulse"></span>
              Govt Verified AI Sahayak
            </p>
          </div>
        </div>

        {/* Global Quick Action Buttons */}
        <div className="flex items-center space-x-2 text-xs">
          <button
            onClick={() => sendMessagePayload({ type: "text", text: "MENU" })}
            title="Menu"
            className="p-1.5 bg-emerald-800 hover:bg-emerald-700 rounded-full transition"
          >
            <Menu className="w-4 h-4" />
          </button>
          <button
            onClick={() => sendMessagePayload({ type: "text", text: "LANGUAGE" })}
            title="Language"
            className="p-1.5 bg-emerald-800 hover:bg-emerald-700 rounded-full transition"
          >
            <Globe className="w-4 h-4" />
          </button>
          <button
            onClick={() => sendMessagePayload({ type: "text", text: "DELETE MY DATA" })}
            title="Delete My Data"
            className="p-1.5 bg-red-900/60 hover:bg-red-800 rounded-full transition text-red-200"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Chat Messages Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[url('https://static.whatsapp.net/rsrc.php/v3/y6/r/wa_bg.png')] bg-repeat bg-opacity-10">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col ${
              msg.sender === "user" ? "items-end" : "items-start"
            }`}
          >
            {/* Bubble */}
            <div
              className={`max-w-[85%] rounded-2xl p-3 shadow-sm text-sm relative break-words whitespace-pre-wrap ${
                msg.sender === "user"
                  ? "bg-[#d9fdd3] text-[#111b21] rounded-tr-none"
                  : "bg-white text-[#111b21] rounded-tl-none border border-slate-200"
              }`}
            >
              <div>{msg.text}</div>
              <div className="flex justify-end items-center gap-1 mt-1 text-[10px] text-slate-500">
                <span>{msg.time}</span>
                {msg.sender === "user" && <CheckCheck className="w-3.5 h-3.5 text-blue-500" />}
              </div>
            </div>

            {/* Interactive WhatsApp-style Buttons */}
            {msg.buttons && msg.buttons.length > 0 && (
              <div className="flex flex-col w-[85%] gap-1.5 mt-2">
                {msg.buttons.map((btn) => (
                  <button
                    key={btn.id}
                    onClick={() => handleButtonClick(btn)}
                    disabled={loading}
                    className="w-full bg-white hover:bg-emerald-50 active:bg-emerald-100 text-[#075E54] font-medium text-xs py-2 px-3 rounded-xl border border-[#075E54]/30 shadow-sm transition flex items-center justify-center gap-1.5"
                  >
                    <span>{btn.title}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Interactive WhatsApp-style List Items */}
            {msg.list && msg.list.length > 0 && (
              <div className="w-[85%] mt-2 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden divide-y divide-slate-100">
                <div className="bg-slate-50 px-3 py-1.5 text-[11px] font-semibold text-slate-600">
                  📋 SELECT AN OPTION:
                </div>
                {msg.list.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => handleListItemClick(item)}
                    disabled={loading}
                    className="w-full text-left px-3 py-2 hover:bg-emerald-50 active:bg-emerald-100 transition flex flex-col"
                  >
                    <span className="font-medium text-xs text-slate-800">{item.title}</span>
                    {item.description && (
                      <span className="text-[11px] text-slate-500">{item.description}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-2 text-slate-500 text-xs italic bg-white/80 p-2 rounded-xl w-fit shadow-sm">
            <RefreshCw className="w-3 h-3 animate-spin text-[#075E54]" />
            <span>KaamSathi is typing...</span>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Input Bar */}
      <footer className="bg-[#f0f2f5] p-2.5 flex items-center gap-2 border-t border-slate-200">
        <form onSubmit={handleSendText} className="flex-1 flex items-center gap-2">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={isRecording ? "Recording voice note..." : "Type in Hindi, English, Hinglish..."}
            disabled={isRecording || loading}
            className="flex-1 bg-white text-sm text-slate-800 px-4 py-2.5 rounded-full border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#075E54]"
          />

          {inputText.trim() ? (
            <button
              type="submit"
              disabled={loading}
              className="w-10 h-10 rounded-full bg-[#075E54] hover:bg-[#128C7E] text-white flex items-center justify-center transition shadow-md"
            >
              <Send className="w-4 h-4" />
            </button>
          ) : isRecording ? (
            <button
              type="button"
              onClick={stopRecording}
              className="w-10 h-10 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center animate-pulse shadow-md"
              title="Stop Recording"
            >
              <Square className="w-4 h-4 fill-white" />
            </button>
          ) : (
            <button
              type="button"
              onClick={startRecording}
              disabled={loading}
              className="w-10 h-10 rounded-full bg-[#075E54] hover:bg-[#128C7E] text-white flex items-center justify-center transition shadow-md"
              title="Record Voice Note"
            >
              <Mic className="w-4 h-4" />
            </button>
          )}
        </form>
      </footer>
    </div>
  );
}
