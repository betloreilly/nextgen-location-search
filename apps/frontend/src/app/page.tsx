"use client";

import { ChatWindow } from "@/components/ChatWindow";

const HEADER_IMAGE =
  "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=1600&h=500&fit=crop";

export default function Home() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header
        style={{
          position: "relative",
          minHeight: 220,
          background: `linear-gradient(to bottom, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.5) 100%), url(${HEADER_IMAGE}) center / cover no-repeat`,
          display: "flex",
          alignItems: "flex-end",
          padding: "0 1.5rem 1.5rem",
        }}
      >
        <div
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            width: "100%",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: "1rem",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <span
              style={{
                width: 44,
                height: 44,
                borderRadius: "var(--radius-sm)",
                background: "rgba(255,255,255,0.95)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1.5rem",
                boxShadow: "var(--shadow)",
              }}
            >
              📍
            </span>
            <div>
              <h1
                style={{
                  margin: 0,
                  fontSize: "1.75rem",
                  fontWeight: 700,
                  fontFamily: "Fraunces, Georgia, serif",
                  color: "#fff",
                  textShadow: "0 1px 2px rgba(0,0,0,0.3)",
                }}
              >
                Find places
              </h1>
              <p
                style={{
                  margin: 0,
                  fontSize: "0.9rem",
                  color: "rgba(255,255,255,0.9)",
                }}
              >
                Coffee shops, cafés & more nearby
              </p>
            </div>
          </div>
        </div>
      </header>

      <main
        style={{
          flex: 1,
          padding: "1.5rem",
          maxWidth: 1200,
          margin: "0 auto",
          width: "100%",
        }}
      >
        <ChatWindow />
      </main>
    </div>
  );
}
