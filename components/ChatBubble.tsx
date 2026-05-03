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
          className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 border-2 border-black rounded-md"
          style={{
            backgroundColor: isUser ? "var(--blue)" : "var(--red)",
            color: "#000",
          }}
        >
          {isUser ? "You" : "MealOS AI"}
        </span>

        {/* Text bubble */}
        {message.text && (
          <div
            className="px-4 py-3 border-2 border-black font-medium text-base text-black rounded-xl"
            style={{
              backgroundColor: isUser ? "var(--blue)" : "var(--red)",
              boxShadow: isUser
                ? "-3px 3px 0px #000"
                : "3px 3px 0px #000",
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
