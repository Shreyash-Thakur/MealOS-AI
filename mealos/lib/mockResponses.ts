import { Card, Message } from "./types";

// ─── Hardcoded Response Map ──────────────────────────────────────────────────

interface MockResponse {
  text: string;
  cards: Card[];
}

const RESPONSES: { pattern: RegExp; response: MockResponse }[] = [
  {
    // "healthy under 300" — 2 food cards + 1 instamart
    pattern: /healthy|under\s*300|low.cal|light/i,
    response: {
      text: "LOCKED IN. Here's your healthy meal lineup — all under ₹300.",
      cards: [
        {
          type: "food",
          name: "Grilled Veggie Bowl",
          price: 249,
          deliveryTime: "28 min",
        },
        {
          type: "food",
          name: "Oats & Berry Smoothie Bowl",
          price: 199,
          deliveryTime: "22 min",
        },
        {
          type: "instamart",
          name: "DIY Salad Kit",
          ingredients: ["Spinach", "Cucumber", "Chickpeas", "Olive Oil", "Feta"],
          totalCost: 220,
        },
      ],
    },
  },
  {
    // "date night" — dineout card
    pattern: /date.?night|romantic|special.?occasion|anniversary|dinner/i,
    response: {
      text: "DATE NIGHT MODE: ACTIVATED. Here's the perfect spot.",
      cards: [
        {
          type: "dineout",
          name: "Whisper & Wine",
          restaurant: "Whisper & Wine — Bandra West",
          offer: "20% OFF for 2 | Candlelight Dinner Package",
        },
      ],
    },
  },
  {
    // "pizza" — 2 food cards
    pattern: /pizza/i,
    response: {
      text: "PIZZA TIME. No cap. Here's the best in your area.",
      cards: [
        {
          type: "food",
          name: "Double Cheese Margherita",
          price: 349,
          deliveryTime: "35 min",
        },
        {
          type: "food",
          name: "BBQ Chicken Loaded Pizza",
          price: 449,
          deliveryTime: "40 min",
        },
      ],
    },
  },
  {
    // "biryani" — 1 food + 1 instamart
    pattern: /biryani|biriyani/i,
    response: {
      text: "BIRYANI INCOMING. The real deal.",
      cards: [
        {
          type: "food",
          name: "Hyderabadi Dum Biryani",
          price: 299,
          deliveryTime: "45 min",
        },
        {
          type: "instamart",
          name: "Make-at-Home Biryani Kit",
          ingredients: ["Basmati Rice", "Chicken", "Shan Masala", "Saffron", "Ghee"],
          totalCost: 380,
        },
      ],
    },
  },
  {
    // "lunch" or "quick" — 2 food cards
    pattern: /lunch|quick|fast|hurry/i,
    response: {
      text: "QUICK LUNCH SORTED. These will be at your door fast.",
      cards: [
        {
          type: "food",
          name: "Club Sandwich Combo",
          price: 179,
          deliveryTime: "18 min",
        },
        {
          type: "food",
          name: "Paneer Wrap + Coke",
          price: 199,
          deliveryTime: "20 min",
        },
      ],
    },
  },
  {
    // "budget" or "cheap" — 2 food cards + 1 instamart
    pattern: /budget|cheap|under.?100|under.?200|affordable/i,
    response: {
      text: "BUDGET MODE ON. Maximum taste, minimum spend.",
      cards: [
        {
          type: "food",
          name: "Vada Pav Combo",
          price: 79,
          deliveryTime: "15 min",
        },
        {
          type: "food",
          name: "Egg Roll (2 pcs)",
          price: 99,
          deliveryTime: "20 min",
        },
        {
          type: "instamart",
          name: "Maggi Noodle Pack × 4",
          ingredients: ["Maggi Noodles ×4", "Masala", "Ketchup"],
          totalCost: 60,
        },
      ],
    },
  },
];

const DEFAULT_RESPONSE: MockResponse = {
  text: "I'M ON IT. Here's what MealOS AI recommends right now.",
  cards: [
    {
      type: "food",
      name: "Butter Chicken + Naan",
      price: 329,
      deliveryTime: "32 min",
    },
    {
      type: "food",
      name: "Masala Dosa + Sambar",
      price: 149,
      deliveryTime: "25 min",
    },
    {
      type: "dineout",
      name: "The Bombay Canteen",
      restaurant: "The Bombay Canteen — Lower Parel",
      offer: "15% OFF | Table for 2 Available",
    },
  ],
};

// ─── Main resolver ───────────────────────────────────────────────────────────

export function getMockResponse(userInput: string): MockResponse {
  for (const { pattern, response } of RESPONSES) {
    if (pattern.test(userInput)) {
      return response;
    }
  }
  return DEFAULT_RESPONSE;
}

export function buildAIMessage(userInput: string): Message {
  const { text, cards } = getMockResponse(userInput);
  return {
    id: `ai-${Date.now()}`,
    role: "ai",
    text,
    cards,
  };
}
