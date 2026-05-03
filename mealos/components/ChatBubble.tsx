"use client";

import { Message } from "@/lib/types";
import DecisionCard from "./DecisionCard";

interface ChatBubbleProps {
  message: Message;
}

export default function ChatBubble({ message }: ChatBubbleProps) {
  const isUser = message.role === "user";

  return (
    <div
      className={`flex w-full mb-4 ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div className={`max-w-[80%] ${isUser ? "items-end" : "items-start"} flex flex-col gap-3`}>
        {/* Role label */}
        <span
          className="text-xs font-black uppercase tracking-widest px-2 py-0.5 border-2 border-black"
          style={{
            backgroundColor: isUser ? "#3A86FF" : "#FF3B3B",
            color: "#fff",
          }}
        >
          {isUser ? "YOU" : "MEALOS AI"}
        </span>

        {/* Text bubble */}
        {message.text && (
          <div
            className="px-4 py-3 border-4 border-black font-bold text-base text-black"
            style={{
              backgroundColor: isUser ? "#3A86FF" : "#FF3B3B",
              boxShadow: isUser
                ? "-5px 5px 0px #000"
                : "5px 5px 0px #000",
              color: "#fff",
              letterSpacing: "0.01em",
            }}
          >
            {message.text}
          </div>
        )}

        {/* Cards */}
        {message.cards && message.cards.length > 0 && (
          <div className="flex flex-wrap gap-4 mt-1">
            {message.cards.map((card, i) => (
              <DecisionCard key={i} card={card} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
