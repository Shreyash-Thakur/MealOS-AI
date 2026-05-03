"use client";

import { Card } from "@/lib/types";

interface DecisionCardProps {
  card: Card;
}

const typeConfig = {
  food: {
    bg: "var(--yellow)",
    label: "🍔 Swiggy Food",
    labelBg: "#000",
    labelColor: "var(--yellow)",
  },
  instamart: {
    bg: "var(--green)",
    label: "🛒 Swiggy Instamart",
    labelBg: "#000",
    labelColor: "var(--green)",
  },
  dineout: {
    bg: "var(--pink)",
    label: "🍽️ Swiggy Dineout",
    labelBg: "#000",
    labelColor: "var(--pink)",
  },
};

export default function DecisionCard({ card }: DecisionCardProps) {
  const cfg = typeConfig[card.type];

  return (
    <div
      className="w-56 border-2 border-black rounded-xl overflow-hidden flex flex-col"
      style={{
        backgroundColor: cfg.bg,
        boxShadow: "3px 3px 0px #000",
      }}
    >
      {/* Type badge */}
      <div
        className="px-3 py-1.5 text-xs font-bold uppercase tracking-wide border-b-2 border-black"
        style={{ backgroundColor: cfg.labelBg, color: cfg.labelColor }}
      >
        {cfg.label}
      </div>

      {/* Card body */}
      <div className="p-4 flex flex-col gap-3">
        {/* Name */}
        <p className="text-base font-bold leading-tight text-black">
          {card.name}
        </p>

        {/* Food card fields */}
        {card.type === "food" && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase text-black/70">Price</span>
              <span
                className="px-2 py-0.5 border-2 border-black rounded-md text-sm font-bold text-black"
                style={{ backgroundColor: "#fff" }}
              >
                ₹{card.price}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase text-black/70">Delivery</span>
              <span
                className="px-2 py-0.5 border-2 border-black rounded-md text-sm font-bold text-black"
                style={{ backgroundColor: "var(--blue)", color: "#000" }}
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
              <p className="text-xs font-bold uppercase text-black/70 mb-1">Ingredients</p>
              <ul className="flex flex-wrap gap-1">
                {card.ingredients.map((ing, i) => (
                  <li
                    key={i}
                    className="text-xs px-1.5 py-0.5 border-2 border-black rounded-md font-medium bg-white text-black"
                  >
                    {ing}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs font-bold uppercase text-black/70">Total Cost</span>
              <span
                className="px-2 py-0.5 border-2 border-black rounded-md text-sm font-bold text-black"
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
            <p className="text-sm font-medium text-black">{card.restaurant}</p>
            {card.offer && (
              <div
                className="px-2 py-1 border-2 border-black rounded-md text-xs font-bold text-black mt-1"
                style={{ backgroundColor: "var(--yellow)" }}
              >
                🎉 {card.offer}
              </div>
            )}
          </>
        )}
      </div>

      {/* CTA */}
      <div className="mt-auto border-t-2 border-black">
        <button
          id={`card-cta-${card.name.replace(/\s+/g, "-").toLowerCase()}`}
          className="w-full py-3 font-bold text-sm text-black bg-white hover:bg-black hover:text-white transition-colors duration-100"
        >
          Order Now →
        </button>
      </div>
    </div>
  );
}
