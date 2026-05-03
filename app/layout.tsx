import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MealOS AI — Decide What to Eat. Fast.",
  description: "MealOS AI helps you decide what to eat instantly. Get food recommendations, Instamart grocery options, and dineout picks — all in one raw, bold interface.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen" style={{ backgroundColor: "#FDF6E3" }}>
        {children}
      </body>
    </html>
  );
}
