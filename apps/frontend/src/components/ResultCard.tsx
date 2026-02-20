"use client";

import { useState, useEffect } from "react";
import type { SearchResultHit } from "@nextgen-location-search/types";

const PLACEHOLDER_IMAGE = "https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=600&h=400&fit=crop";
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/** Resolve /data/* to backend URL so place images load (backend serves repo root data/). */
function resolveImageUrl(url: string | undefined): string {
  if (!url) return PLACEHOLDER_IMAGE;
  if (url.startsWith("/data/")) return `${API_URL.replace(/\/$/, "")}${url}`;
  return url;
}

interface ResultCardProps {
  hit: SearchResultHit;
  rank: number;
  explanation?: string;
}

export function ResultCard({ hit, rank, explanation }: ResultCardProps) {
  const resolved = resolveImageUrl(hit.imageUrl) || PLACEHOLDER_IMAGE;
  const [imageUrl, setImageUrl] = useState(resolved);

  useEffect(() => {
    setImageUrl(resolved);
  }, [resolved]);

  const handleImageError = () => {
    setImageUrl(PLACEHOLDER_IMAGE);
  };

  return (
    <article
      style={{
        background: "var(--surface)",
        borderRadius: "var(--radius)",
        overflow: "hidden",
        boxShadow: "var(--shadow)",
        border: "1px solid var(--border)",
        transition: "box-shadow 0.2s ease",
      }}
      className="result-card"
    >
      <div style={{ position: "relative", height: 180, background: "var(--border)", overflow: "hidden" }}>
        <img
          src={imageUrl}
          alt={hit.name}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
          onError={handleImageError}
        />
        <div
          style={{
            position: "absolute", top: "0.75rem", left: "0.75rem",
            background: "rgba(0,0,0,0.55)", color: "#fff",
            fontSize: "0.72rem", fontWeight: 600,
            padding: "0.2rem 0.45rem", borderRadius: "var(--radius-sm)",
          }}
        >
          #{rank}
        </div>
        {hit.openNow !== undefined && (
          <div
            style={{
              position: "absolute", top: "0.75rem", right: "0.75rem",
              background: hit.openNow ? "var(--success)" : "var(--muted)",
              color: "#fff", fontSize: "0.68rem", fontWeight: 600,
              padding: "0.2rem 0.45rem", borderRadius: "var(--radius-sm)",
            }}
          >
            {hit.openNow ? "Open" : "Closed"}
          </div>
        )}
        <div
          style={{
            position: "absolute", bottom: "0.75rem", right: "0.75rem",
            background: "rgba(255,255,255,0.95)", color: "var(--text)",
            fontSize: "0.82rem", fontWeight: 600,
            padding: "0.3rem 0.55rem", borderRadius: "var(--radius-sm)",
          }}
        >
          {hit.rating}
        </div>
      </div>

      <div style={{ padding: "1rem 1.1rem" }}>
        <h3 style={{ margin: "0 0 0.3rem", fontSize: "1.05rem", fontWeight: 600 }}>
          {hit.name}
        </h3>
        <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "0.82rem" }}>
          {hit.category}
          {hit.priceTier && ` · ${hit.priceTier}`}
          {hit.distanceKm != null && (
            <span style={{ color: "var(--accent)", marginLeft: "0.35rem" }}>
              · {hit.distanceKm.toFixed(1)} km
            </span>
          )}
        </p>
        {explanation && (
          <p style={{ marginTop: "0.5rem", fontSize: "0.78rem", color: "var(--muted)", lineHeight: 1.4 }}>
            {explanation}
          </p>
        )}
        {hit.reviews && hit.reviews.length > 0 && (
          <details style={{ marginTop: "0.5rem" }}>
            <summary style={{ fontSize: "0.78rem", color: "var(--muted)", cursor: "pointer" }}>
              Review snippets
            </summary>
            <ul style={{ margin: "0.35rem 0 0", paddingLeft: "1.1rem", fontSize: "0.78rem", color: "var(--text-secondary)" }}>
              {hit.reviews.slice(0, 3).map((r, i) => (
                <li key={i}>{(r as { text?: string }).text ?? ""}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </article>
  );
}
