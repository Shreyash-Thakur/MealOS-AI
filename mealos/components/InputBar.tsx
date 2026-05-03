"use client";

import { useState, KeyboardEvent } from "react";

interface InputBarProps {
  onSend: (text: string) => void;
  disabled?: boolean;
}

export default function InputBar({ onSend, disabled = false }: InputBarProps) {
  const [value, setValue] = useState("");

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleSend();
  };

  return (
    <div
      className="w-full border-t-2 border-black flex items-center gap-2 p-2 bg-white"
    >
      <input
        id="chat-input"
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder="What do you want to eat?"
        className="flex-1 px-4 py-3 font-medium text-base outline-none text-black placeholder:text-black/40 rounded-lg border-2 border-black"
        style={{
          backgroundColor: "#fff",
          boxShadow: "inset 2px 2px 0px rgba(0,0,0,0.05)",
        }}
        aria-label="Chat input"
      />
      <button
        id="chat-send-button"
        onClick={handleSend}
        disabled={disabled || !value.trim()}
        className="px-6 py-3 font-bold text-sm tracking-wide border-2 border-black rounded-lg text-black transition-all duration-100"
        style={{
          backgroundColor: "var(--yellow)",
          boxShadow: "2px 2px 0px #000",
          cursor: disabled || !value.trim() ? "not-allowed" : "pointer",
          opacity: disabled ? 0.6 : 1,
        }}
        onMouseDown={(e) => {
          const btn = e.currentTarget;
          if (!disabled && value.trim()) btn.style.transform = "translate(2px, 2px)";
        }}
        onMouseUp={(e) => {
          const btn = e.currentTarget;
          btn.style.transform = "translate(0,0)";
        }}
        aria-label="Send message"
      >
        Send →
      </button>
    </div>
  );
}
