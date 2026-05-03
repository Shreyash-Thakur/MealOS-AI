"use client";

import Link from "next/link";
import { useState } from "react";

const EXAMPLES = [
  "HEALTHY UNDER 300",
  "DATE NIGHT",
  "QUICK BIRYANI",
  "BUDGET LUNCH",
  "PIZZA TIME",
];

export default function LandingPage() {
  const [hovered, setHovered] = useState(false);

  return (
    <main
      className="min-h-screen flex flex-col"
      style={{ backgroundColor: "#FDF6E3" }}
    >
      {/* ─── Hero ─────────────────────────────────────── */}
      <section className="flex-1 flex flex-col items-center justify-center px-4 pt-16 pb-8 relative overflow-hidden">
        {/* Background grid pattern */}
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, #000 0, #000 1px, transparent 1px, transparent 40px), repeating-linear-gradient(90deg, #000 0, #000 1px, transparent 1px, transparent 40px)",
          }}
        />

        {/* Content */}
        <div className="relative z-10 flex flex-col items-center gap-6 max-w-3xl text-center">
          {/* Badge */}
          <div
            className="inline-block px-4 py-1 border-4 border-black font-black text-xs uppercase tracking-widest"
            style={{
              backgroundColor: "#FF3B3B",
              color: "#fff",
              boxShadow: "4px 4px 0px #000",
            }}
          >
            🤖 AI-POWERED FOOD DECISIONS
          </div>

          {/* Main title */}
          <h1
            className="text-[clamp(4rem,15vw,9rem)] font-black uppercase leading-none tracking-tighter text-black"
            style={{ letterSpacing: "-0.04em" }}
          >
            MEAL
            <span
              className="inline-block px-3 ml-2"
              style={{
                backgroundColor: "#FFD60A",
                border: "4px solid #000",
                boxShadow: "6px 6px 0px #000",
              }}
            >
              OS
            </span>
          </h1>

          {/* Subtitle */}
          <div
            className="px-6 py-3 border-4 border-black"
            style={{ backgroundColor: "#000", boxShadow: "6px 6px 0px #3A86FF" }}
          >
            <p className="font-black uppercase text-xl tracking-widest" style={{ color: "#FFD60A" }}>
              DECIDE WHAT TO EAT. FAST.
            </p>
          </div>

          {/* Description */}
          <p className="text-base font-bold text-black/70 max-w-md uppercase tracking-wide">
            Stop wasting time. MealOS AI reads your mood and picks the perfect
            meal — delivery, groceries, or dineout.
          </p>

          {/* CTA */}
          <Link href="/chat" id="cta-start">
            <button
              className="px-12 py-5 text-2xl font-black uppercase tracking-widest border-4 border-black transition-all duration-100"
              style={{
                backgroundColor: "#FFD60A",
                boxShadow: hovered ? "2px 2px 0px #000" : "8px 8px 0px #000",
                transform: hovered ? "translate(4px, 4px)" : "translate(0,0)",
                color: "#000",
              }}
              onMouseEnter={() => setHovered(true)}
              onMouseLeave={() => setHovered(false)}
              onMouseDown={() => setHovered(true)}
            >
              START →
            </button>
          </Link>
        </div>
      </section>

      {/* ─── Example chips ─────────────────────────── */}
      <section className="border-t-4 border-black px-4 py-6 overflow-x-auto">
        <div className="flex gap-3 min-w-max mx-auto justify-center flex-wrap">
          {EXAMPLES.map((ex) => (
            <Link key={ex} href={`/chat?q=${encodeURIComponent(ex)}`}>
              <div
                className="px-4 py-2 border-4 border-black font-black text-sm uppercase tracking-wider cursor-pointer hover:bg-black hover:text-yellow-400 transition-colors duration-100"
                style={{ backgroundColor: "#fff" }}
              >
                {ex}
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ─── Feature strip ─────────────────────────── */}
      <section
        className="border-t-4 border-black grid grid-cols-1 md:grid-cols-3"
      >
        {[
          { color: "#FFD60A", icon: "🛵", title: "DELIVERY", desc: "Order from Swiggy or Zomato in seconds" },
          { color: "#06D6A0", icon: "🛒", title: "GROCERIES", desc: "Get ingredients via Instamart. Cook it fresh." },
          { color: "#FF85A1", icon: "🍽️", title: "DINEOUT", desc: "Find the best table in town, right now" },
        ].map((f, i) => (
          <div
            key={i}
            className="flex flex-col items-center gap-3 px-8 py-10 border-b-4 md:border-b-0 md:border-r-4 border-black last:border-r-0 last:border-b-0"
            style={{ backgroundColor: f.color }}
          >
            <span className="text-5xl">{f.icon}</span>
            <h2 className="text-2xl font-black uppercase tracking-widest text-black">
              {f.title}
            </h2>
            <p className="text-sm font-bold text-black/70 text-center uppercase">
              {f.desc}
            </p>
          </div>
        ))}
      </section>

      {/* ─── Footer ────────────────────────────────── */}
      <footer
        className="border-t-4 border-black px-6 py-4 flex items-center justify-between"
        style={{ backgroundColor: "#000", color: "#FFD60A" }}
      >
        <span className="font-black uppercase tracking-widest text-sm">
          MEALOS AI
        </span>
        <span className="font-bold text-xs uppercase opacity-60">
          NO BACKEND. ALL RAW. ALL FAST.
        </span>
      </footer>
    </main>
  );
}
