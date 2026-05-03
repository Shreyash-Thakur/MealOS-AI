# MealOS AI 🍔

> **DECIDE WHAT TO EAT. FAST.**

A bold neobrutalist AI food-decision frontend built with **Next.js 16 + Tailwind CSS v4**.

---

## 🚀 Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Run dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 📁 Project Structure

```
mealos/
├── app/
│   ├── layout.tsx          # Root layout + metadata
│   ├── page.tsx            # Landing page (/)
│   ├── globals.css         # Global styles
│   └── chat/
│       └── page.tsx        # Chat page (/chat)
├── components/
│   ├── Navbar.tsx          # Top navigation bar
│   ├── ChatBubble.tsx      # User + AI message bubbles
│   ├── DecisionCard.tsx    # Food / Instamart / Dineout cards
│   └── InputBar.tsx        # Fixed bottom input with send button
└── lib/
    ├── types.ts            # TypeScript interfaces
    └── mockResponses.ts    # Hardcoded AI response engine
```

---

## 🎨 Design System

| Token       | Value                   |
|-------------|-------------------------|
| Background  | `#FDF6E3`               |
| Primary     | `#FFD60A` (Yellow)      |
| Secondary   | `#FF3B3B` (Red)         |
| Accent      | `#3A86FF` (Blue)        |
| Green       | `#06D6A0`               |
| Pink        | `#FF85A1`               |
| Border      | `4px solid #000`        |
| Shadow      | `6px 6px 0px #000`      |

---

## 💬 Mock AI Triggers

| Input contains         | Response                          |
|------------------------|-----------------------------------|
| `healthy` / `under 300`| 2 Swiggy Food cards + 1 Instamart card  |
| `date night`           | 1 Swiggy Dineout card                    |
| `pizza`                | 2 Swiggy Food cards                      |
| `biryani`              | 1 Swiggy Food + 1 Instamart              |
| `lunch` / `quick`      | 2 fast Swiggy Food cards                 |
| `budget` / `cheap`     | 2 cheap Swiggy Food + 1 Instamart        |
| *(anything else)*      | Default mixed recommendation       |

---

## ✅ Pages

- `/` — Landing page with CTA, feature strip, example chips
- `/chat` — Full-screen chat with AI responses + decision cards
