"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Navbar from "@/components/Navbar";
import ChatBubble from "@/components/ChatBubble";
import InputBar from "@/components/InputBar";
import { buildAIMessage } from "@/lib/mockResponses";
import { Message } from "@/lib/types";

const WELCOME_MESSAGE: Message = {
  id: "welcome",
  role: "ai",
  text: "Yo. Tell me what you feel like eating. I'll sort it out.",
};

const SUGGESTIONS = [
  "Healthy under 300",
  "Date night",
  "Quick biryani",
  "Budget lunch",
  "Pizza time",
  "Cheap and fast",
];

function ChatContent() {
  const searchParams = useSearchParams();
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE]);
  const [thinking, setThinking] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const initialQueryFired = useRef(false);

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  // Handle ?q= param from landing page chips
  useEffect(() => {
    const q = searchParams.get("q");
    if (q && !initialQueryFired.current) {
      initialQueryFired.current = true;
      setTimeout(() => handleSend(q), 300);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handleSend = (text: string) => {
    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      text,
    };
    setMessages((prev) => [...prev, userMsg]);
    setThinking(true);

    // Simulate AI "thinking" delay
    setTimeout(() => {
      const aiMsg = buildAIMessage(text);
      setMessages((prev) => [...prev, aiMsg]);
      setThinking(false);
    }, 1200);
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Navbar />

      {/* ─── Messages area ────────────────────────── */}
      <div
        className="flex-1 overflow-y-auto px-4 py-6"
        style={{ backgroundColor: "var(--bg)" }}
        id="chat-messages-area"
      >
        <div className="max-w-3xl mx-auto flex flex-col gap-2">
          {messages.map((msg) => (
            <ChatBubble key={msg.id} message={msg} />
          ))}

          {/* Thinking indicator */}
          {thinking && (
            <div className="flex justify-start mb-4">
              <div className="flex flex-col gap-1 items-start">
                <span
                  className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 border-2 border-black rounded-md"
                  style={{ backgroundColor: "var(--red)", color: "#000" }}
                >
                  MealOS AI
                </span>
                <div
                  className="px-5 py-3 border-2 border-black font-medium text-base rounded-xl"
                  style={{
                    backgroundColor: "var(--red)",
                    boxShadow: "3px 3px 0px #000",
                    color: "#000",
                  }}
                >
                  <ThinkingDots />
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* ─── Suggestions ──────────────────────────── */}
      {messages.length <= 1 && !thinking && (
        <div
          className="border-t-2 border-black px-4 py-3 overflow-x-auto"
          style={{ backgroundColor: "#fff" }}
        >
          <div className="flex gap-2 flex-wrap max-w-3xl mx-auto">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                id={`suggestion-${s.replace(/\s+/g, "-").toLowerCase()}`}
                onClick={() => handleSend(s)}
                className="px-3 py-1.5 border-2 border-black rounded-lg font-bold text-xs tracking-wide hover:bg-black hover:text-white transition-colors duration-100"
                style={{ backgroundColor: "var(--bg)" }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ─── Input bar ────────────────────────────── */}
      <InputBar onSend={handleSend} disabled={thinking} />
    </div>
  );
}

function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-1">
      Thinking
      <span className="inline-flex gap-0.5 ml-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1.5 h-1.5 bg-black rounded-full"
            style={{
              animation: `pulse 1s ease-in-out ${i * 0.2}s infinite`,
            }}
          />
        ))}
      </span>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.2; transform: scaleY(0.5); }
          50% { opacity: 1; transform: scaleY(1); }
        }
      `}</style>
    </span>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={null}>
      <ChatContent />
    </Suspense>
  );
}
