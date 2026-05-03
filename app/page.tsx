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
      style={{ backgroundColor: "var(--bg)" }}
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
            className="inline-block px-4 py-1.5 border-2 border-black rounded-lg font-bold text-xs uppercase tracking-widest"
            style={{
              backgroundColor: "var(--green)",
              color: "#000",
              boxShadow: "3px 3px 0px #000",
            }}
          >
            🤖 AI-POWERED FOOD DECISIONS
          </div>

          {/* Main title */}
          <h1
            className="text-[clamp(3.5rem,10vw,7rem)] font-black leading-none tracking-tight text-black"
            style={{ letterSpacing: "-0.02em" }}
          >
            Meal
            <span
              className="inline-block px-3 ml-2 rounded-xl"
              style={{
                backgroundColor: "var(--yellow)",
                border: "2px solid #000",
                boxShadow: "4px 4px 0px #000",
              }}
            >
              OS
            </span>
          </h1>

          {/* Subtitle */}
          <div
            className="px-6 py-3 border-2 border-black rounded-xl"
            style={{ backgroundColor: "#000", boxShadow: "4px 4px 0px var(--blue)" }}
          >
            <p className="font-bold text-lg tracking-wide" style={{ color: "var(--yellow)" }}>
              Decide what to eat. Fast.
            </p>
          </div>

          {/* Description */}
          <p className="text-lg font-medium text-black/70 max-w-md">
            Stop scrolling endlessly. MealOS AI acts as your personal food concierge — finding the perfect meal via Swiggy Food, ingredients on Swiggy Instamart, or booking tables with Swiggy Dineout.
          </p>

          {/* CTA */}
          <Link href="/chat" id="cta-start">
            <button
              className="px-10 py-4 text-xl font-bold border-2 border-black rounded-xl transition-all duration-100"
              style={{
                backgroundColor: "var(--yellow)",
                boxShadow: hovered ? "2px 2px 0px #000" : "4px 4px 0px #000",
                transform: hovered ? "translate(2px, 2px)" : "translate(0,0)",
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
      <section className="border-t-2 border-black px-4 py-6 overflow-x-auto bg-white">
        <div className="flex gap-3 min-w-max mx-auto justify-center flex-wrap">
          {EXAMPLES.map((ex) => (
            <Link key={ex} href={`/chat?q=${encodeURIComponent(ex)}`}>
              <div
                className="px-4 py-2 border-2 border-black rounded-lg font-bold text-sm tracking-wide cursor-pointer hover:bg-black hover:text-white transition-colors duration-100"
                style={{ backgroundColor: "var(--bg)" }}
              >
                {ex}
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ─── How it Works ──────────────────────────── */}
      <section className="bg-white border-t-2 border-black py-16 px-4">
        <div className="max-w-4xl mx-auto flex flex-col items-center text-center gap-10">
          <h2 className="text-3xl font-black tracking-tight">How It Works</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="flex flex-col items-center gap-4 group">
              <div className="w-16 h-16 rounded-full border-2 border-black bg-white flex items-center justify-center text-2xl font-bold shadow-[4px_4px_0px_var(--yellow)] group-hover:translate-y-1 group-hover:shadow-none transition-all">
                1
              </div>
              <h3 className="font-bold text-lg">Tell Us Your Vibe</h3>
              <p className="text-sm font-medium text-black/70">Type in exactly what you want, like "healthy under 300" or "date night spots".</p>
            </div>
            <div className="flex flex-col items-center gap-4 group">
              <div className="w-16 h-16 rounded-full border-2 border-black bg-white flex items-center justify-center text-2xl font-bold shadow-[4px_4px_0px_var(--green)] group-hover:translate-y-1 group-hover:shadow-none transition-all">
                2
              </div>
              <h3 className="font-bold text-lg">AI Computes</h3>
              <p className="text-sm font-medium text-black/70">MealOS AI scours Swiggy's entire ecosystem to find your perfect match instantly.</p>
            </div>
            <div className="flex flex-col items-center gap-4 group">
              <div className="w-16 h-16 rounded-full border-2 border-black bg-white flex items-center justify-center text-2xl font-bold shadow-[4px_4px_0px_var(--pink)] group-hover:translate-y-1 group-hover:shadow-none transition-all">
                3
              </div>
              <h3 className="font-bold text-lg">Order & Enjoy</h3>
              <p className="text-sm font-medium text-black/70">Pick the best card and order with one click. It's really that simple.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Feature strip ─────────────────────────── */}
      <section
        className="border-t-2 border-black grid grid-cols-1 md:grid-cols-3"
      >
        {[
          { color: "var(--yellow)", icon: "🛵", title: "SWIGGY FOOD", desc: "Get lightning fast food delivery directly to your door." },
          { color: "var(--green)", icon: "🛒", title: "SWIGGY INSTAMART", desc: "Craving a home-cooked meal? Ingredients in 10 mins." },
          { color: "var(--pink)", icon: "🍽️", title: "SWIGGY DINEOUT", desc: "Reserve the best tables and get exclusive offers." },
        ].map((f, i) => (
          <div
            key={i}
            className="flex flex-col items-center gap-4 px-8 py-12 border-b-2 md:border-b-0 md:border-r-2 border-black last:border-r-0 last:border-b-0 cursor-pointer hover:bg-black group transition-colors duration-300"
            style={{ backgroundColor: f.color }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#000'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = f.color; }}
          >
            <span className="text-5xl drop-shadow-md group-hover:scale-110 transition-transform duration-300">{f.icon}</span>
            <h2 className="text-xl font-bold tracking-wide text-black group-hover:text-white transition-colors duration-300">
              {f.title}
            </h2>
            <p className="text-sm font-medium text-black/70 text-center group-hover:text-white/70 transition-colors duration-300">
              {f.desc}
            </p>
          </div>
        ))}
      </section>

      {/* ─── Footer ────────────────────────────────── */}
      <footer
        className="border-t-2 border-black px-6 py-4 flex items-center justify-between"
        style={{ backgroundColor: "#000", color: "var(--yellow)" }}
      >
        <span className="font-bold tracking-wider text-sm">
          MEALOS AI
        </span>
        <span className="font-medium text-xs opacity-60">
          No backend. All raw. All fast.
        </span>
      </footer>
    </main>
  );
}
