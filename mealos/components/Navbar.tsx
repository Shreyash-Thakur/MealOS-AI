"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Navbar() {
  const pathname = usePathname();

  return (
    <nav
      className="w-full border-b-2 border-black sticky top-0 z-50 bg-white"
    >
      <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 group">
          <div
            className="w-10 h-10 border-2 border-black rounded-lg flex items-center justify-center font-black text-lg"
            style={{
              backgroundColor: "var(--red)",
              boxShadow: "2px 2px 0px #000",
              transition: "transform 0.1s, box-shadow 0.1s",
            }}
          >
            M
          </div>
          <span
            className="text-xl font-black uppercase tracking-widest text-black"
            style={{ letterSpacing: "0.15em" }}
          >
            MealOS
            <span
              className="ml-1 px-2 py-0.5 rounded-md text-xs font-bold border-2 border-black align-middle"
              style={{ backgroundColor: "#000", color: "var(--yellow)" }}
            >
              AI
            </span>
          </span>
        </Link>

        {/* Nav links */}
        <div className="flex items-center gap-3">
          <Link
            href="/"
            id="nav-home"
            className="px-4 py-1.5 font-bold text-sm border-2 border-transparent rounded-lg hover:border-black transition-all"
            style={
              pathname === "/"
                ? {
                    backgroundColor: "var(--yellow)",
                    color: "#000",
                    border: "2px solid #000",
                    boxShadow: "2px 2px 0px #000",
                  }
                : { color: "#000" }
            }
          >
            Home
          </Link>
          <Link
            href="/chat"
            id="nav-chat"
            className="px-4 py-1.5 font-bold text-sm border-2 border-transparent rounded-lg hover:border-black transition-all"
            style={
              pathname === "/chat"
                ? {
                    backgroundColor: "var(--yellow)",
                    color: "#000",
                    border: "2px solid #000",
                    boxShadow: "2px 2px 0px #000",
                  }
                : { color: "#000" }
            }
          >
            Chat
          </Link>
        </div>
      </div>
    </nav>
  );
}
