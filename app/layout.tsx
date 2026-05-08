import type { Metadata } from "next";
import "./globals.css";
import "@/src/frontend/mealos/mealos.css";

export const metadata: Metadata = {
  title: "MealOS AI - Decide What to Eat. Fast.",
  description:
    "MealOS AI helps you decide what to eat instantly across Swiggy Food, Instamart, and Dineout.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

