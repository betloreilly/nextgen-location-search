"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type {
  ChatMessage as ChatMessageType,
  SearchMode,
  UserContext,
  ChatResponsePayload,
  SearchResultHit,
  ExplanationBlock,
  QueryPlan,
} from "@nextgen-location-search/types";
import { ModeTabs } from "./ModeTabs";
import { ResultCard } from "./ResultCard";
import { DebugPanel } from "./DebugPanel";
import { FilterSidebar, DEFAULT_FILTERS, type BasicFilters } from "./FilterSidebar";
import { ChatbotPanel } from "./ChatbotPanel";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const DEFAULT_CONTEXT: UserContext = {
  lat: 40.7128,
  lon: -74.006,
  timestamp: new Date().toISOString(),
};

const RADII_OPTIONS = [1, 2, 3, 5, 10, 15, 20];

function buildMessageFromFilters(f: BasicFilters): string {
  const parts: string[] = [];
  if (f.category) parts.push(f.category);
  if (f.keyword.trim()) parts.push(f.keyword.trim());
  parts.push("near me");
  parts.push(`within ${f.radiusKm} km`);
  if (f.openNow) parts.push("open now");
  if (f.priceTier === "cheap") parts.push("cheap");
  if (f.priceTier === "moderate") parts.push("moderate");
  if (f.priceTier === "expensive") parts.push("expensive");
  return parts.join(" ");
}

function filtersFromPlan(plan: QueryPlan, current: BasicFilters): BasicFilters {
  const geo = plan.filters.geo;
  const rawRadius = geo?.radiusKm ?? current.radiusKm;
  const radiusKm = RADII_OPTIONS.includes(rawRadius)
    ? rawRadius
    : RADII_OPTIONS.find((r) => r >= rawRadius) ?? 5;
  const openNow = plan.filters.openNow ?? current.openNow;
  const priceTier = plan.filters.priceTier === "any" || !plan.filters.priceTier ? "" : (plan.filters.priceTier ?? current.priceTier);
  const q = (plan.query || "").toLowerCase();
  let category = current.category;
  if (q.includes("coffee") || q.includes("café") || q.includes("cafe")) category = "coffee shop";
  else if (q.includes("restaurant") || q.includes("dining")) category = "restaurant";
  else if (q.includes("bar") || q.includes("pub")) category = "bar";
  else if (q.includes("hotel")) category = "hotel";
  else if (q.includes("park")) category = "park";
  else if (q.includes("gym") || q.includes("fitness")) category = "gym";
  else if (q.includes("bakery")) category = "bakery";
  // Keyword: Traditional mode uses only what user typed — don't overwrite with "place". Others: prefer review phrase, then query text.
  const queryTrimmed = (plan.query || "").trim();
  const keyword =
    plan.mode === "beginner"
      ? (queryTrimmed && queryTrimmed !== "place" ? queryTrimmed : current.keyword)
      : (plan.mustHaveFromReviews?.length ? plan.mustHaveFromReviews[0] : null) ??
        (queryTrimmed && queryTrimmed !== "place" ? queryTrimmed : current.keyword);
  return { ...current, category, priceTier, openNow, radiusKm, keyword };
}

// ---- Unified query summary ----
function QuerySummary({ plan, explanation }: { plan: QueryPlan; explanation: ExplanationBlock | null }) {
  const modeLabel =
    plan.mode === "beginner"      ? "Traditional keyword search" :
    plan.mode === "semantic"      ? "Vector similarity (kNN)" :
    plan.mode === "intermediate"  ? "LLM intent + BM25 + boosting" :
                                    "Conversational AI + LLM intent + boosting";

  const modeColor =
    plan.mode === "semantic"      ? "#5a39b0" :
    plan.mode === "intermediate"  ? "var(--accent)" :
    plan.mode === "advanced"      ? "#7c3aed" :
                                    "#1a6090";

  const pills: string[] = [];
  if (plan.filters.geo) {
    if (plan.mode === "beginner") {
      pills.push(`Within ${plan.filters.geo.radiusKm} km`);
    } else if (plan.mode === "advanced") {
      pills.push("Sorted by relevance, then proximity");
    } else if (plan.mode !== "semantic") {
      pills.push("Sorted by proximity");
    }
  }
  if (plan.filters.openNow) pills.push("Open now");
  if (plan.filters.priceTier && plan.filters.priceTier !== "any") {
    const labels: Record<string, string> = { cheap: "Budget-friendly", moderate: "Moderate", expensive: "Upscale" };
    pills.push(labels[plan.filters.priceTier] ?? plan.filters.priceTier);
  }
  if (plan.boosts.rating) {
    const mult = plan.boosts.rating === "high" ? "×2.0" : plan.boosts.rating === "medium" ? "×1.5" : "×1.2";
    pills.push(`Rating boost ${mult}`);
  }
  if (plan.boosts.distance) pills.push("Proximity ranked");
  if (plan.mustHaveFromReviews.length > 0) pills.push(`Review: "${plan.mustHaveFromReviews[0]}"`);

  const reviewMatches = explanation?.reviewSnippetsSupport ?? [];
  const warnings = explanation?.warnings ?? [];

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: "0.85rem 1.1rem",
        boxShadow: "var(--shadow)",
        display: "flex",
        flexDirection: "column",
        gap: "0.55rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem", flexWrap: "wrap" }}>
        <span
          style={{
            fontSize: "0.7rem",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: modeColor,
            flexShrink: 0,
          }}
        >
          {modeLabel}
        </span>
        <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
          Query: <strong style={{ color: "var(--text)" }}>{plan.query}</strong>
        </span>
        {(plan.mode === "intermediate" || plan.mode === "advanced") && (
          <span style={{ fontSize: "0.72rem", color: "var(--muted)" }}>built by LLM</span>
        )}
        {plan.mode === "semantic" && (
          <span style={{ fontSize: "0.72rem", color: "var(--muted)" }}>1536-dim vector, no keywords</span>
        )}
      </div>

      {pills.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
          {pills.map((p) => (
            <span
              key={p}
              style={{
                fontSize: "0.72rem",
                fontWeight: 500,
                padding: "0.18rem 0.55rem",
                borderRadius: 20,
                background: "var(--bg)",
                border: "1px solid var(--border)",
                color: "var(--text-secondary)",
              }}
            >
              {p}
            </span>
          ))}
        </div>
      )}

      {reviewMatches.length > 0 && (
        <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--text-secondary)" }}>
          Review evidence: {reviewMatches.map((r) => `"${r.claim}" (${r.count} snippet${r.count !== 1 ? "s" : ""})`).join(" · ")}
        </p>
      )}

      {warnings.map((w, i) => (
        <p key={i} style={{ margin: 0, fontSize: "0.78rem", color: "#8a6914" }}>{w}</p>
      ))}
    </div>
  );
}

export function ChatWindow() {
  const [mode, setMode] = useState<SearchMode>("beginner");
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResultHit[]>([]);
  const [explanation, setExplanation] = useState<ExplanationBlock | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [queryPlan, setQueryPlan] = useState<QueryPlan | null>(null);
  const [opensearchRequest, setOpensearchRequest] = useState<{ index: string; body: Record<string, unknown> } | null>(null);
  const [clarifyingQuestion, setClarifyingQuestion] = useState<string | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [basicFilters, setBasicFilters] = useState<BasicFilters>(DEFAULT_FILTERS);
  const didDefaultTraditionalRef = useRef(false);

  const runSearch = useCallback(
    async (searchMessages: ChatMessageType[]) => {
      setLoading(true);
      setResults([]);
      setExplanation(null);
      setWarnings([]);
      setQueryPlan(null);
      setOpensearchRequest(null);
      setClarifyingQuestion(null);
      try {
        const res = await fetch(`${API_URL}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode,
            messages: searchMessages,
            userContext: DEFAULT_CONTEXT,
            currentKeyword: basicFilters.keyword?.trim() || undefined,
          }),
        });
        const data = (await res.json()) as ChatResponsePayload | { error: string };
        if (!res.ok) {
          const err = "error" in data ? data.error : "Request failed";
          setWarnings([err]);
          return;
        }
        const payloadData = data as ChatResponsePayload;
        setResults(payloadData.results ?? []);
        setExplanation(payloadData.explanation ?? null);
        setWarnings(payloadData.warnings ?? []);
        setQueryPlan(payloadData.queryPlan ?? null);
        setOpensearchRequest(payloadData.opensearchRequest ?? null);
        if (payloadData.clarifyingQuestion) setClarifyingQuestion(payloadData.clarifyingQuestion);
        if (payloadData.queryPlan) {
          setBasicFilters((prev) => filtersFromPlan(payloadData.queryPlan!, prev));
        }
      } catch (e) {
        setWarnings([e instanceof Error ? e.message : "Network error"]);
      } finally {
        setLoading(false);
      }
    },
    [mode, basicFilters.keyword]
  );

  const searchWithBasicFilters = useCallback(() => {
    const text = buildMessageFromFilters(basicFilters);
    const userMessage: ChatMessageType = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    };
    runSearch([userMessage]);
  }, [basicFilters, runSearch]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    const userMessage: ChatMessageType = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    };
    setInput("");
    runSearch([userMessage]);
  }, [input, loading, runSearch]);

  // Handle results update from the chatbot panel (Advanced mode)
  const handleChatbotResults = useCallback(
    (
      newResults: SearchResultHit[],
      plan: QueryPlan,
      opensearchRequest?: { index: string; body: Record<string, unknown> } | null,
      explanation?: ExplanationBlock | null
    ) => {
      setResults(newResults);
      setQueryPlan(plan);
      if (opensearchRequest !== undefined) setOpensearchRequest(opensearchRequest);
      if (explanation !== undefined) setExplanation(explanation);
      setBasicFilters((prev) => filtersFromPlan(plan, prev));
    },
    []
  );

  const resetState = () => {
    setMessages([]);
    setInput("");
    setResults([]);
    setQueryPlan(null);
    setExplanation(null);
    setWarnings([]);
    setClarifyingQuestion(null);
    setBasicFilters(DEFAULT_FILTERS);
  };

  // Traditional mode: run a default "match all" search so users see options before filtering
  useEffect(() => {
    if (mode !== "beginner") {
      didDefaultTraditionalRef.current = false;
      return;
    }
    if (results.length > 0 || loading) return;
    if (didDefaultTraditionalRef.current) return;
    didDefaultTraditionalRef.current = true;
    const msg: ChatMessageType = {
      id: crypto.randomUUID(),
      role: "user",
      content: buildMessageFromFilters(basicFilters),
      timestamp: new Date().toISOString(),
    };
    runSearch([msg]);
  }, [mode, results.length, loading, runSearch, basicFilters]);

  // Layout flags
  const showFilterSidebar = mode === "beginner" || mode === "intermediate";
  const isAdvancedMode = mode === "advanced";

  // For Advanced mode, always show filter sidebar (read-only context panel) too
  const showSidebar = showFilterSidebar || isAdvancedMode;
  const maxWidth = showSidebar ? 1160 : 680;

  const modeHint =
    mode === "beginner"
      ? "Use the filters on the left and click Search. Leave keyword empty to see all places in the area."
      : mode === "intermediate"
        ? "Type your request — the LLM extracts filters and builds the query. Try: quiet coffee shop open now within 3km cheap"
        : "Describe what you're looking for. Your text is embedded as a vector and matched by meaning. Try: cozy place to study with good coffee";

  const geoLabel = queryPlan?.filters.geo
    ? queryPlan.mode === "beginner"
      ? `geo filter active: ${queryPlan.filters.geo.radiusKm} km`
      : queryPlan.mode === "semantic"
        ? null
        : queryPlan.mode === "advanced"
          ? "relevance, then proximity"
          : "sorted by proximity"
    : null;

  return (
    <div style={{ width: "100%", maxWidth, display: "flex", flexDirection: "column", gap: "1rem" }}>

      <ModeTabs
        value={mode}
        onChange={(m) => { setMode(m); resetState(); }}
      />

      {/* Location context bar */}
      <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--text-secondary)" }}>
        Demo location: <strong>New York, NY</strong>
        {geoLabel && (
          <span style={{ color: "var(--accent)", marginLeft: "0.4rem" }}>· {geoLabel}</span>
        )}
        {isAdvancedMode && (
          <span style={{ color: "#7c3aed", marginLeft: "0.5rem", fontSize: "0.72rem", fontWeight: 500 }}>
            · conversational memory active
          </span>
        )}
      </p>

      {/* Advanced mode banner */}
      {isAdvancedMode && (
        <div
          style={{
            padding: "0.75rem 1rem",
            background: "linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)",
            border: "1px solid #c4b5fd",
            borderRadius: "var(--radius)",
            fontSize: "0.85rem",
            color: "#4c1d95",
          }}
        >
          <strong>Advanced mode</strong> — use the filters on the left or open the AI assistant (bottom-right) to refine results conversationally. The assistant remembers your previous requests.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: showSidebar ? "row" : "column", gap: "1rem", alignItems: "stretch" }}>
        {showSidebar && (
          <FilterSidebar
            filters={basicFilters}
            onChange={setBasicFilters}
            onSearch={searchWithBasicFilters}
            loading={loading}
          />
        )}

        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "1rem", minWidth: 0 }}>

          {/* Search text area — Traditional: no middle content. Semantic & Intermediate: text area + Search */}
          {!isAdvancedMode && mode !== "beginner" && (
            <div
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                boxShadow: "var(--shadow)",
              }}
            >
              <form
                    onSubmit={(e) => { e.preventDefault(); void sendMessage(); }}
                    style={{ display: "flex", flexDirection: "column", gap: "0.75rem", padding: "1rem 1.25rem" }}
                  >
                    <label htmlFor="search-query" style={{ fontSize: "0.8rem", fontWeight: 500, color: "var(--text-secondary)" }}>
                      What are you looking for?
                    </label>
                    <textarea
                      id="search-query"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder={mode === "semantic" ? "e.g. cozy place to study with good coffee" : "e.g. quiet coffee shop open now within 3km cheap"}
                      disabled={loading}
                      rows={3}
                      style={{
                        width: "100%",
                        padding: "0.6rem 0.75rem",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--border)",
                        background: "var(--bg)",
                        color: "var(--text)",
                        fontSize: "0.88rem",
                        resize: "vertical",
                        minHeight: 72,
                        fontFamily: "inherit",
                      }}
                    />
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                      <button
                        type="submit"
                        disabled={loading || !input.trim()}
                        style={{
                          padding: "0.55rem 1.25rem",
                          borderRadius: "var(--radius-sm)",
                          border: "none",
                          background: "var(--accent)",
                          color: "#fff",
                          fontWeight: 600,
                          fontSize: "0.88rem",
                          cursor: loading || !input.trim() ? "not-allowed" : "pointer",
                        }}
                      >
                        Search
                      </button>
                      {loading && (
                        <span style={{ fontSize: "0.82rem", color: "var(--muted)" }}>Searching…</span>
                      )}
                    </div>
                  </form>
            </div>
          )}

          {/* Clarifying question */}
          {clarifyingQuestion && (
            <div style={{
              padding: "0.7rem 1rem",
              background: "var(--surface)",
              border: "1px solid var(--accent)",
              borderRadius: "var(--radius)",
              fontSize: "0.88rem",
            }}>
              <strong>Clarification: </strong>{clarifyingQuestion}
            </div>
          )}

          {/* Query summary — hidden for Traditional (filters only, no explanation in middle) */}
          {queryPlan && !loading && mode !== "beginner" && (
            <QuerySummary plan={queryPlan} explanation={explanation} />
          )}

          {/* Results */}
          {results.length > 0 && (
            <section>
              <h2 style={{ fontSize: "1rem", margin: "0 0 0.85rem", fontFamily: "Fraunces, Georgia, serif" }}>
                Results
                <span style={{ fontSize: "0.75rem", fontWeight: 400, marginLeft: "0.5rem", color: "var(--muted)" }}>
                  {results.length} place{results.length !== 1 ? "s" : ""}
                </span>
              </h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "1rem" }}>
                {results.map((hit, i) => (
                  <ResultCard
                    key={hit.id}
                    hit={hit}
                    rank={i + 1}
                    explanation={i === 0 && explanation?.topResultSummary ? explanation.topResultSummary : undefined}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Warnings */}
          {warnings.length > 0 && (
            <div style={{
              padding: "0.7rem 1rem",
              background: "rgba(196,154,44,0.1)",
              border: "1px solid var(--warning)",
              borderRadius: "var(--radius)",
              color: "#8a6914",
              fontSize: "0.88rem",
            }}>
              {warnings.map((w, i) => <div key={i}>{w}</div>)}
            </div>
          )}

          {/* Debug toggle */}
          <button
            type="button"
            onClick={() => setDebugOpen((v) => !v)}
            style={{
              alignSelf: "flex-start",
              padding: "0.35rem 0.7rem",
              fontSize: "0.78rem",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              color: "var(--muted)",
              borderRadius: "var(--radius-sm)",
            }}
          >
            {debugOpen ? "Hide" : "Show"} OpenSearch query
          </button>

          <DebugPanel
            queryPlan={queryPlan}
            opensearchRequest={opensearchRequest}
            visible={debugOpen}
            onClose={() => setDebugOpen(false)}
          />
        </div>
      </div>

      {/* Floating chatbot panel — Advanced mode only */}
      {isAdvancedMode && (
        <ChatbotPanel
          userContext={DEFAULT_CONTEXT}
          onResultsUpdate={handleChatbotResults}
          currentKeyword={basicFilters.keyword?.trim() || undefined}
        />
      )}
    </div>
  );
}
