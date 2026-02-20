import type {
  SearchMode,
  MemoryResult,
  IntentPlan,
  QueryPlan,
  AllowedSortField,
  BoostLevel,
} from "@nextgen-location-search/types";

const ALLOWED_SORT_FIELDS: AllowedSortField[] = ["distance", "rating", "reviewScore", "priceTier"];

function sanitizeBoostLevel(v: string): BoostLevel {
  if (v === "low" || v === "medium" || v === "high") return v;
  return "medium";
}

function sanitizeSortField(field: string): AllowedSortField {
  if (ALLOWED_SORT_FIELDS.includes(field as AllowedSortField)) return field as AllowedSortField;
  return "rating";
}

/** Cap query at 5 words so OpenSearch gets keyword-style text; LLM is the source of truth for which keywords to use. */
function capQueryWords(q: string, maxWords = 5): string {
  const t = q.trim();
  if (!t) return t;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return t;
  return words.slice(-maxWords).join(" ");
}

/** True if the string looks like a question or conversational fragment, not valid search keywords. */
function isQuestionLike(s: string): boolean {
  const lower = s.toLowerCase();
  const bad =
    /\b(should|where|which|what|how|can you|could you|do you know|is there|are there)\b/.test(lower) ||
    /\?/.test(s) ||
    /^\s*near\s*$/i.test(lower.trim());
  return bad;
}

const STOP_WORDS = new Set(["one", "the", "has", "have", "had", "more", "most", "best", "for", "with", "that", "this", "any", "some", "was", "were", "is", "are", "be", "been", "being", "do", "does", "did", "can", "could", "would", "should", "which", "what", "where", "how", "a", "an"]);

/** When the user asks "which one has X" or "which is best for Y", extract X/Y so we can search by it (e.g. "students", "wifi"). */
function extractCriterionFromQuestion(s: string): string | null {
  const words = s
    .replace(/\?/g, "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
  if (words.length === 0) return null;
  if (words.length <= 2) return words.join(" ");
  return words.slice(-2).join(" ");
}

/**
 * Build a structured query plan from mode, memory, and optional LLM intent.
 * beginner    — BM25 + hard geo filter, stateless
 * semantic    — kNN vector only, stateless
 * intermediate — LLM intent + BM25 + boosting + proximity sort, stateless
 * advanced    — same as intermediate; when currentKeyword is set (left-panel KEYWORD), it drives keyword/similarity search so OpenSearch matches the UI.
 */
export function buildQueryPlan(
  mode: SearchMode,
  memory: MemoryResult,
  llmIntent?: IntentPlan | null,
  lastUserMessage?: string | null,
  currentKeyword?: string | null
): QueryPlan {
  switch (mode) {
    case "beginner":
      return buildBeginnerPlan(memory, currentKeyword ?? undefined);
    case "semantic":
      return buildSemanticPlan(memory);
    case "intermediate":
      return buildIntermediatePlan(memory, llmIntent, false, lastUserMessage ?? undefined, currentKeyword ?? undefined);
    case "advanced":
      return buildIntermediatePlan(memory, llmIntent, true, lastUserMessage ?? undefined, currentKeyword ?? undefined);
    default:
      return buildBeginnerPlan(memory, currentKeyword ?? undefined);
  }
}

/** Traditional mode: keyword search uses only the KEYWORD field when user types something; otherwise "place" (match all). No auto keyword from category. */
function buildBeginnerPlan(memory: MemoryResult, currentKeyword?: string): QueryPlan {
  const userKeyword = currentKeyword?.trim();
  const query = userKeyword || "place";

  const filters: QueryPlan["filters"] = {};
  if (memory.filters.location) {
    filters.geo = {
      lat: memory.filters.location.lat,
      lon: memory.filters.location.lon,
      radiusKm: memory.filters.geoRadiusKm ?? 5,
    };
  }
  if (memory.filters.openNow !== undefined) filters.openNow = memory.filters.openNow;
  if (memory.filters.priceTier) filters.priceTier = memory.filters.priceTier;

  return {
    mode: "beginner",
    query: query || "place",
    filters,
    mustHaveFromReviews: [],
    niceToHaveFromReviews: [],
    boosts: {},
    sort: [{ field: "distance", order: "asc" }],
    warningsToCheck: [],
    useVector: false,
    useKeyword: true,
  };
}

function buildSemanticPlan(memory: MemoryResult): QueryPlan {
  const base = buildBeginnerPlan(memory);
  const derivedQuery = [memory.entity, ...memory.attributes, ...(memory.reviewPreferences ?? [])]
    .filter(Boolean)
    .join(" ");
  const query = memory.rawQuery && memory.rawQuery.length > derivedQuery.length
    ? memory.rawQuery
    : derivedQuery;

  return {
    ...base,
    mode: "semantic",
    query: query || "place",
    mustHaveFromReviews: memory.attributes.length ? memory.attributes.slice(0, 3) : [],
    niceToHaveFromReviews: memory.reviewPreferences ?? [],
    boosts: {},
    sort: [{ field: "_score", order: "desc" }],
    useVector: true,
    useKeyword: false,
  };
}

function buildIntermediatePlan(
  memory: MemoryResult,
  llmIntent?: IntentPlan | null,
  isAdvanced = false,
  lastUserMessage?: string,
  currentKeyword?: string
): QueryPlan {
  const modeLabel: SearchMode = isAdvanced ? "advanced" : "intermediate";

  // Left-panel KEYWORD (currentKeyword) drives keyword search when set so OpenSearch matches the UI. Otherwise LLM/last message/memory.
  const panelKeyword = currentKeyword?.trim() || null;
  let llmQuery = llmIntent?.query?.trim() || null;
  const fallbackCurrentTurn = isAdvanced && lastUserMessage?.trim() ? lastUserMessage.trim() : null;
  const memoryFallback = [memory.entity, ...memory.attributes].filter(Boolean).join(" ") || null;
  // If LLM returned a question phrase (e.g. "which one has more students"), extract the criterion so we search by it
  if (llmQuery && isQuestionLike(llmQuery)) {
    const criterion = extractCriterionFromQuestion(llmQuery);
    llmQuery = criterion || null;
  }
  // CRITICAL: When the user's latest message is "which one has X" / "which is best for Y", use that criterion as the query
  // so we re-rank by the new ask (e.g. "students") and don't keep showing the previous search (e.g. "quiet coffee").
  const refinementCriterion =
    fallbackCurrentTurn && isQuestionLike(fallbackCurrentTurn)
      ? extractCriterionFromQuestion(fallbackCurrentTurn)
      : null;
  let rawQuery =
    panelKeyword ||
    refinementCriterion ||
    llmQuery ||
    fallbackCurrentTurn ||
    (memory.rawQuery && memory.rawQuery.trim()) ||
    memoryFallback ||
    "place";
  const keywordQuery = capQueryWords(rawQuery);
  const finalQuery = isQuestionLike(keywordQuery) ? (memoryFallback || "place") : keywordQuery;

  if (!llmIntent) {
    const filters: QueryPlan["filters"] = {};
    if (memory.filters.location) {
      filters.geo = {
        lat: memory.filters.location.lat,
        lon: memory.filters.location.lon,
        radiusKm: memory.filters.geoRadiusKm ?? 5,
      };
    }
    if (memory.filters.openNow !== undefined) filters.openNow = memory.filters.openNow;
    if (memory.filters.priceTier) filters.priceTier = memory.filters.priceTier;
    return {
      mode: modeLabel,
      query: finalQuery,
      filters,
      mustHaveFromReviews: memory.attributes.slice(0, 3),
      niceToHaveFromReviews: memory.reviewPreferences ?? [],
      boosts: {},
      sort: [{ field: "rating", order: "desc" }, { field: "distance", order: "asc" }],
      warningsToCheck: [],
      useVector: true,
      useKeyword: true,
    };
  }

  const filters: QueryPlan["filters"] = {};
  if (memory.filters.location || (llmIntent.filters && llmIntent.filters.geoRadiusKm !== undefined)) {
    const lat = memory.filters.location?.lat ?? 0;
    const lon = memory.filters.location?.lon ?? 0;
    const radiusKm = llmIntent.filters?.geoRadiusKm ?? memory.filters.geoRadiusKm ?? 5;
    filters.geo = { lat, lon, radiusKm };
  }
  if (llmIntent.filters?.openNow !== undefined) filters.openNow = llmIntent.filters.openNow;
  if (llmIntent.filters?.priceTier) filters.priceTier = llmIntent.filters.priceTier;

  const boosts: QueryPlan["boosts"] = {};
  if (llmIntent.boosts?.distance) boosts.distance = sanitizeBoostLevel(llmIntent.boosts.distance);
  if (llmIntent.boosts?.rating && llmIntent.boosts.rating !== "low")
    boosts.rating = sanitizeBoostLevel(llmIntent.boosts.rating);
  if (llmIntent.boosts?.reviewEvidence)
    boosts.reviewEvidence = sanitizeBoostLevel(llmIntent.boosts.reviewEvidence);

  const sort: Array<{ field: AllowedSortField; order: "asc" | "desc" }> = (llmIntent.sort ?? ["rating", "distance"])
    .slice(0, 3)
    .map((s) => {
      const [field, order] = s.toLowerCase().split(/\s+/);
      return {
        field: sanitizeSortField(field || "rating"),
        order: (order === "asc" ? "asc" : "desc") as "asc" | "desc",
      };
    });
  if (sort.length === 0) sort.push({ field: "rating", order: "desc" });

  const mustHaveFromReviews = refinementCriterion
    ? [refinementCriterion, ...(Array.isArray(llmIntent.mustHaveFromReviews) ? llmIntent.mustHaveFromReviews : [])].slice(0, 5)
    : (Array.isArray(llmIntent.mustHaveFromReviews) ? llmIntent.mustHaveFromReviews.slice(0, 5) : []);

  if (refinementCriterion && !boosts.reviewEvidence) boosts.reviewEvidence = "high";

  return {
    mode: modeLabel,
    query: finalQuery,
    filters,
    mustHaveFromReviews,
    niceToHaveFromReviews: Array.isArray(llmIntent.niceToHaveFromReviews)
      ? llmIntent.niceToHaveFromReviews.slice(0, 5)
      : [],
    boosts,
    sort,
    warningsToCheck: Array.isArray(llmIntent.warningsToCheck) ? llmIntent.warningsToCheck : [],
    useVector: true,
    useKeyword: true,
  };
}
