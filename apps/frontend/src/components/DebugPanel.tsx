"use client";

import type { QueryPlan } from "@nextgen-location-search/types";

interface DebugPanelProps {
  queryPlan: QueryPlan | null;
  opensearchRequest: { index: string; body: Record<string, unknown> } | null;
  visible: boolean;
  onClose: () => void;
}

const preStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "0.75rem",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  color: "var(--text-secondary)",
  lineHeight: 1.55,
};

const sectionLabel: React.CSSProperties = {
  margin: "1.25rem 0 0.4rem",
  fontSize: "0.68rem",
  color: "var(--muted)",
  textTransform: "uppercase",
  letterSpacing: "0.07em",
  fontWeight: 600,
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: "0.5rem", fontSize: "0.8rem", marginBottom: "0.3rem", flexWrap: "wrap" }}>
      <span style={{ color: "var(--muted)", minWidth: 110, flexShrink: 0 }}>{label}</span>
      <span style={{ color: "var(--text)", fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function isHybridQuery(body: Record<string, unknown>): boolean {
  const q = body.query as Record<string, unknown> | undefined;
  const should = q?.bool && typeof q.bool === "object" && (q.bool as Record<string, unknown>).should;
  if (!Array.isArray(should)) return false;
  return should.some((clause: unknown) => typeof clause === "object" && clause != null && "knn" in (clause as Record<string, unknown>));
}

function hasKeywordSearch(body: Record<string, unknown>): boolean {
  const q = body.query as Record<string, unknown> | undefined;
  const check = (clause: unknown): boolean => {
    if (typeof clause !== "object" || clause == null) return false;
    const c = clause as Record<string, unknown>;
    if ("multi_match" in c || "match" in c) return true;
    if (c.bool && typeof c.bool === "object") {
      const b = c.bool as Record<string, unknown>;
      if (Array.isArray(b.must) && b.must.some(check)) return true;
      if (Array.isArray(b.should) && b.should.some(check)) return true;
    }
    if (c.function_score && typeof c.function_score === "object") {
      const fs = c.function_score as Record<string, unknown>;
      if (fs.query && check(fs.query)) return true;
    }
    return false;
  };
  return check(q);
}

function getKeywordQueryFromBody(body: Record<string, unknown>): string | null {
  const q = body.query as Record<string, unknown> | undefined;
  const checkClause = (clause: unknown): string | null => {
    if (typeof clause !== "object" || clause == null) return null;
    const c = clause as Record<string, unknown>;
    const mm = c.multi_match as Record<string, unknown> | undefined;
    if (mm && typeof mm.query === "string") return mm.query;
    const innerBool = c.bool as Record<string, unknown> | undefined;
    if (innerBool && Array.isArray(innerBool.must)) {
      for (const m of innerBool.must as unknown[]) {
        const found = checkClause(m);
        if (found) return found;
      }
    }
    const fs = c.function_score as Record<string, unknown> | undefined;
    if (fs && typeof fs.query === "object" && fs.query != null) return checkClause(fs.query);
    return null;
  };
  const bool = q?.bool as Record<string, unknown> | undefined;
  const must = Array.isArray(bool?.must) ? bool.must : [];
  for (const m of must) {
    const found = checkClause(m);
    if (found) return found;
  }
  const should = Array.isArray(bool?.should) ? bool.should : [];
  for (const s of should) {
    const found = checkClause(s);
    if (found) return found;
  }
  const knn = q?.knn as Record<string, unknown> | undefined;
  if (knn) return null;
  return null;
}

function HumanSummary({ plan, requestBody }: { plan: QueryPlan; requestBody: Record<string, unknown> | null }) {
  const hybrid = requestBody && isHybridQuery(requestBody);
  const hasKeyword = requestBody && hasKeywordSearch(requestBody);
  const keywordFromRequest = requestBody ? getKeywordQueryFromBody(requestBody) : null;

  const modeValue =
    requestBody && !hasKeyword && !hybrid
      ? "kNN vector only (1536 dims)"
      : hybrid
        ? "Hybrid (BM25 + kNN similarity)"
        : hasKeyword
          ? plan.mode === "beginner"
            ? "BM25 full-text"
            : "LLM intent + BM25 + boosting"
          : plan.mode === "beginner"
            ? "BM25 full-text"
            : plan.mode === "semantic"
              ? "kNN vector (1536 dims)"
              : "BM25 + boosting";

  const filterParts: string[] = [];
  if (plan.filters.geo) {
    if (plan.mode === "beginner") {
      filterParts.push(`geo_distance filter: ${plan.filters.geo.radiusKm} km`);
    } else if (plan.mode === "advanced") {
      filterParts.push("relevance sort, then proximity (no hard radius)");
    } else if (plan.mode !== "semantic") {
      filterParts.push("proximity sort (no hard radius)");
    }
  }
  if (plan.filters.openNow) filterParts.push("openNow = true");
  if (plan.filters.priceTier && plan.filters.priceTier !== "any") filterParts.push(`priceTier = ${plan.filters.priceTier}`);

  const boostParts: string[] = [];
  if (plan.boosts.rating) {
    const mult = plan.boosts.rating === "high" ? "2.0" : plan.boosts.rating === "medium" ? "1.5" : "1.2";
    boostParts.push(`rating ×${mult}`);
  }
  if (plan.boosts.distance) boostParts.push("proximity decay");
  if (plan.boosts.reviewEvidence) boostParts.push("review evidence");

  const queryText = keywordFromRequest ?? plan.query;

  return (
    <div>
      <p style={sectionLabel}>What this request is searching for</p>
      <Row label="Query type" value={modeValue} />
      {queryText ? <Row label="Keyword query" value={queryText} /> : null}
      {hybrid ? <Row label="Vector search" value="Same text embedded (kNN)" /> : null}
      {filterParts.length > 0 && <Row label="Filters" value={filterParts.join(", ")} />}
      {boostParts.length > 0 && <Row label="Boosting" value={boostParts.join(", ")} />}
      {plan.mustHaveFromReviews.length > 0 && (
        <Row label="Review match" value={plan.mustHaveFromReviews.join(", ")} />
      )}
    </div>
  );
}

export function DebugPanel({ queryPlan, opensearchRequest, visible, onClose }: DebugPanelProps) {
  if (!visible) return null;
  const hasRequest = opensearchRequest?.body != null;

  return (
    <div
      style={{
        position: "fixed", right: 0, top: 0, bottom: 0,
        width: "min(460px, 100vw)",
        background: "var(--surface)",
        borderLeft: "1px solid var(--border)",
        padding: "1.25rem",
        overflow: "auto",
        zIndex: 100,
        boxShadow: "-4px 0 20px rgba(0,0,0,0.06)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.1rem" }}>
        <strong style={{ fontSize: "0.9rem" }}>OpenSearch query inspector</strong>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "transparent", border: "1px solid var(--border)",
            color: "var(--text)", padding: "0.25rem 0.6rem",
            borderRadius: "var(--radius-sm)", fontSize: "0.8rem",
          }}
        >
          Close
        </button>
      </div>

      {hasRequest ? (
        <>
          {queryPlan && <HumanSummary plan={queryPlan} requestBody={opensearchRequest!.body} />}
          <p style={sectionLabel}>Raw OpenSearch request · index: {opensearchRequest!.index}</p>
          <pre style={preStyle}>{JSON.stringify(opensearchRequest!.body, null, 2)}</pre>
        </>
      ) : (
        <p style={{ color: "var(--muted)", fontSize: "0.88rem" }}>
          Run a search to see what was sent to OpenSearch.
        </p>
      )}
    </div>
  );
}
