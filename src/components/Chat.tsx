import React, { useState, useRef, useEffect } from "react";
import { ChatMessage } from "../types";
import { Send, MessageSquare } from "lucide-react";

interface ChatProps {
  messages: ChatMessage[];
  onSendMessage: (msg: string) => void;
  myPlayerId: string;
}

const QUICK_CHAT_PHRASES = [
  "GG! 🎮",
  "Nice Shot! ⚽",
  "Speeed! ⚡",
  "So Close! 😮",
  "Bring it on! 🔥",
  "Revenge! 💀",
  "Lucky! 😉",
  "Oops! 🤖",
];

export default function Chat({ messages, onSendMessage, myPlayerId }: ChatProps) {
  const [inputText, setInputText] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onSendMessage(inputText);
    setInputText("");
  };

  return (
    <div className="flex flex-col bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden w-full h-[320px] md:h-[400px] shadow-lg" id="chat-panel">
      {/* Panel Header */}
      <div className="flex items-center gap-2 bg-zinc-900 px-4 py-3 border-b border-zinc-800">
        <MessageSquare className="w-4 h-4 text-cyan-400" />
        <span className="text-sm font-semibold tracking-wide text-zinc-100 font-mono">
          BANTER RADAR (CHAT)
        </span>
      </div>

      {/* Messages Display */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5 custom-scrollbar" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-4">
            <p className="text-xs text-zinc-500 italic">No banter yet...</p>
            <p className="text-[10px] text-zinc-600 font-mono mt-1">Use the quick chat below to spark the rivalry!</p>
          </div>
        ) : (
          messages.map((msg, idx) => {
            const isMe = msg.senderId === myPlayerId;
            return (
              <div
                key={idx}
                className={`flex flex-col max-w-[85%] ${isMe ? "ml-auto items-end" : "mr-auto items-start"}`}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className={`text-[10px] font-bold font-mono ${isMe ? "text-cyan-400" : "text-purple-400"}`}>
                    {msg.senderName}
                  </span>
                  <span className="text-[8px] text-zinc-600 font-mono">
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </div>
                <div
                  className={`px-3 py-1.5 rounded-xl text-xs break-all border ${
                    isMe
                      ? "bg-cyan-950/40 text-cyan-200 border-cyan-900/50 rounded-tr-none"
                      : "bg-purple-950/40 text-purple-200 border-purple-900/50 rounded-tl-none"
                  }`}
                >
                  {msg.message}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Quick Chat Bubble Bar */}
      <div className="bg-zinc-900/40 p-2 border-t border-zinc-900/80">
        <div className="flex flex-wrap gap-1.5 max-h-[70px] overflow-y-auto custom-scrollbar">
          {QUICK_CHAT_PHRASES.map((phrase, idx) => (
            <button
              key={idx}
              onClick={() => onSendMessage(phrase)}
              className="px-2 py-0.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-zinc-300 hover:text-white rounded text-[10px] transition font-sans select-none"
            >
              {phrase}
            </button>
          ))}
        </div>
      </div>

      {/* Standard Input Form */}
      <form onSubmit={handleSubmit} className="flex p-2 bg-zinc-900 border-t border-zinc-800 gap-1.5">
        <input
          id="chat-input"
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Send banter message..."
          maxLength={100}
          className="flex-1 bg-zinc-950 text-white placeholder-zinc-500 text-xs px-3 py-2 rounded-lg border border-zinc-800 focus:outline-none focus:border-cyan-500 font-sans"
        />
        <button
          id="btn-chat-send"
          type="submit"
          className="p-2 bg-cyan-600 hover:bg-cyan-500 text-black rounded-lg transition hover:scale-105 active:scale-95"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </form>
    </div>
  );
}
