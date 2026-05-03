"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Navbar() {
  const pathname = usePathname();

  return (
    <nav
      className="w-full border-b-4 border-black sticky top-0 z-50"
      style={{ backgroundColor: "#FFD60A" }}
    >
      <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 group">
          <div
            className="w-10 h-10 border-4 border-black flex items-center justify-center font-black text-lg"
            style={{
              backgroundColor: "#FF3B3B",
              boxShadow: "3px 3px 0px #000",
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
              className="ml-1 px-1 text-xs font-black border-2 border-black align-middle"
              style={{ backgroundColor: "#000", color: "#FFD60A" }}
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
            className="px-3 py-1 font-black uppercase text-sm border-2 border-transparent hover:border-black transition-all"
            style={
              pathname === "/"
                ? {
                    backgroundColor: "#000",
                    color: "#FFD60A",
                    border: "2px solid #000",
                  }
                : { color: "#000" }
            }
          >
            Home
          </Link>
          <Link
            href="/chat"
            id="nav-chat"
            className="px-3 py-1 font-black uppercase text-sm border-2 border-transparent hover:border-black transition-all"
            style={
              pathname === "/chat"
                ? {
                    backgroundColor: "#000",
                    color: "#FFD60A",
                    border: "2px solid #000",
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
