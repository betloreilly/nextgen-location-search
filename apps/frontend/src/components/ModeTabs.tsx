"use client";

import type { SearchMode } from "@nextgen-location-search/types";

const MODES: { value: SearchMode; label: string; sub: string; color?: string }[] = [
  { value: "beginner",     label: "Traditional",   sub: "BM25 keyword + geo filter" },
  { value: "semantic",     label: "Semantic",       sub: "kNN vector similarity" },
  { value: "intermediate", label: "Intermediate",   sub: "LLM intent + filters + boosting" },
  { value: "advanced",     label: "Advanced",       sub: "Conversational memory + AI chat", color: "#7c3aed" },
];

interface ModeTabsProps {
  value: SearchMode;
  onChange: (mode: SearchMode) => void;
}

export function ModeTabs({ value, onChange }: ModeTabsProps) {
  return (
    <div
      role="tablist"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
        gap: "0.5rem",
      }}
    >
      {MODES.map((m) => {
        const active = value === m.value;
        const accentColor = m.color ?? "var(--accent)";
        return (
          <button
            key={m.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(m.value)}
            style={{
              padding: "0.55rem 1.1rem 0.5rem",
              borderRadius: "var(--radius-sm)",
              border: `1px solid ${active ? accentColor : "var(--border)"}`,
              background: active ? accentColor : "var(--surface)",
              color: active ? "#fff" : "var(--text)",
              fontWeight: active ? 600 : 500,
              fontSize: "0.88rem",
              boxShadow: active ? "var(--shadow)" : "none",
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: "0.1rem",
              minWidth: 0,
              transition: "background 0.15s, border-color 0.15s",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span>{m.label}</span>
            <span style={{ fontSize: "0.68rem", fontWeight: 400, opacity: active ? 0.82 : 0.5 }}>
              {m.sub}
            </span>
          </button>
        );
      })}
    </div>
  );
}
