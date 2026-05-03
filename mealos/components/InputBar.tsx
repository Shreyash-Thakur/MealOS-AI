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
      className="w-full border-t-4 border-black flex items-stretch gap-0"
      style={{ backgroundColor: "#FDF6E3" }}
    >
      <input
        id="chat-input"
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder="WHAT DO YOU WANT TO EAT?"
        className="flex-1 px-5 py-4 font-black text-base uppercase border-r-4 border-black outline-none text-black placeholder:text-black/30"
        style={{
          backgroundColor: "#fff",
          letterSpacing: "0.04em",
        }}
        aria-label="Chat input"
      />
      <button
        id="chat-send-button"
        onClick={handleSend}
        disabled={disabled || !value.trim()}
        className="px-6 py-4 font-black uppercase text-sm tracking-widest border-0 text-black transition-all duration-100"
        style={{
          backgroundColor: "#FFD60A",
          cursor: disabled || !value.trim() ? "not-allowed" : "pointer",
          opacity: disabled ? 0.6 : 1,
        }}
        onMouseDown={(e) => {
          const btn = e.currentTarget;
          btn.style.transform = "translate(2px, 2px)";
        }}
        onMouseUp={(e) => {
          const btn = e.currentTarget;
          btn.style.transform = "translate(0,0)";
        }}
        aria-label="Send message"
      >
        SEND →
      </button>
    </div>
  );
}
