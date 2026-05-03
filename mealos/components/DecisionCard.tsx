"use client";

import { Card } from "@/lib/types";

interface DecisionCardProps {
  card: Card;
}

const typeConfig = {
  food: {
    bg: "#FFD60A",
    label: "🍔 SWIGGY / ZOMATO",
    labelBg: "#000",
    labelColor: "#FFD60A",
  },
  instamart: {
    bg: "#06D6A0",
    label: "🛒 INSTAMART",
    labelBg: "#000",
    labelColor: "#06D6A0",
  },
  dineout: {
    bg: "#FF85A1",
    label: "🍽️ DINEOUT",
    labelBg: "#000",
    labelColor: "#FF85A1",
  },
};

export default function DecisionCard({ card }: DecisionCardProps) {
  const cfg = typeConfig[card.type];

  return (
    <div
      className="w-56 border-4 border-black flex flex-col"
      style={{
        backgroundColor: cfg.bg,
        boxShadow: "6px 6px 0px #000",
      }}
    >
      {/* Type badge */}
      <div
        className="px-3 py-1 text-xs font-black uppercase tracking-wider border-b-4 border-black"
        style={{ backgroundColor: cfg.labelBg, color: cfg.labelColor }}
      >
        {cfg.label}
      </div>

      {/* Card body */}
      <div className="p-3 flex flex-col gap-2">
        {/* Name */}
        <p className="text-base font-black uppercase leading-tight text-black">
          {card.name}
        </p>

        {/* Food card fields */}
        {card.type === "food" && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase text-black/70">Price</span>
              <span
                className="px-2 py-0.5 border-2 border-black text-sm font-black text-black"
                style={{ backgroundColor: "#fff" }}
              >
                ₹{card.price}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase text-black/70">Delivery</span>
              <span
                className="px-2 py-0.5 border-2 border-black text-sm font-black text-black"
                style={{ backgroundColor: "#3A86FF", color: "#fff" }}
              >
                {card.deliveryTime}
              </span>
            </div>
          </>
        )}

        {/* Instamart fields */}
        {card.type === "instamart" && card.ingredients && (
          <>
            <div>
              <p className="text-xs font-black uppercase text-black/70 mb-1">Ingredients</p>
              <ul className="flex flex-wrap gap-1">
                {card.ingredients.map((ing, i) => (
                  <li
                    key={i}
                    className="text-xs px-1.5 py-0.5 border-2 border-black font-bold bg-white text-black"
                  >
                    {ing}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className="text-xs font-bold uppercase text-black/70">Total Cost</span>
              <span
                className="px-2 py-0.5 border-2 border-black text-sm font-black text-black"
                style={{ backgroundColor: "#fff" }}
              >
                ₹{card.totalCost}
              </span>
            </div>
          </>
        )}

        {/* Dineout fields */}
        {card.type === "dineout" && (
          <>
            <div className="flex items-center gap-1">
              <span className="text-xs font-bold uppercase text-black/70">Restaurant</span>
            </div>
            <p className="text-sm font-black text-black">{card.restaurant}</p>
            {card.offer && (
              <div
                className="px-2 py-1 border-2 border-black text-xs font-black uppercase text-black"
                style={{ backgroundColor: "#FFD60A" }}
              >
                🎉 {card.offer}
              </div>
            )}
          </>
        )}
      </div>

      {/* CTA */}
      <div className="mt-auto border-t-4 border-black">
        <button
          id={`card-cta-${card.name.replace(/\s+/g, "-").toLowerCase()}`}
          className="w-full py-2 font-black uppercase text-sm text-black bg-white hover:bg-black hover:text-white transition-colors duration-100 tracking-wider"
        >
          ORDER NOW →
        </button>
      </div>
    </div>
  );
}
