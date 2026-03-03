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

/** Strip distance/location phrases so they are used as filters, not as keyword query. */
function stripDistanceAndLocationPhrases(q: string): string {
  const t = q
    .replace(/\bwithin\s+\d+\s*km\b/gi, "")
    .replace(/\b\d+\s*km\b/g, "")
    .replace(/\bnear\s+me\b/gi, "")
    .replace(/\bnearby\b/gi, "")
    .replace(/\baround\s+here\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return t;
}

/** Extract "within N km" from text for geo radius. Returns null if not found. */
function extractRadiusKm(text: string): number | null {
  const m = text.match(/\bwithin\s+(\d+)\s*km\b/i) || text.match(/\b(\d+)\s*km\b/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n >= 1 && n <= 100 ? n : null;
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

/** True if the user is asking to rank by reviews/rating (e.g. "which one has better reviews"). Do NOT use as keyword query. */
function isReviewRefinement(msg: string, criterion: string | null): boolean {
  const t = (msg + " " + (criterion ?? "")).toLowerCase();
  return /\b(better|best|good|great|higher|top)\s*(reviews?|rated|rating)\b/.test(t) || /\b(reviews?|rated|rating)\s*(better|best|good|higher)\b/.test(t);
}

/** True if the user is asking to filter by open now (e.g. "which ones are open", "cafes that are open"). Do NOT use "open" as keyword. */
function isOpenFilterRefinement(msg: string): boolean {
  const lower = msg.toLowerCase();
  return /\b(open|opened)\b/.test(lower) && (/\b(which|that are|which ones|the ones|show me|list)\b/.test(lower) || /(are|that's|that are)\s+open/.test(lower));
}

/** True if the user is asking to sort/filter by proximity (e.g. "which one is closest", "which is nearest to me", "which one is close to me"). Do NOT use proximity terms as keywords — sort by distance instead. */
function isProximityRefinement(msg: string): boolean {
  const lower = msg.toLowerCase();
  return /\b(close(r|st)?|near(er|est)?|closest|nearest|nearby|proximity|distance)\b/.test(lower);
}

/** True if the user is asking to filter by price (e.g. "which one is cheaper", "the cheaper one"). Do NOT use "cheaper" as keyword. */
function isPriceFilterRefinement(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    /\b(cheaper|cheapest|less\s+expensive|more\s+affordable|budget|cheap)\b/.test(lower) &&
    (/\bwhich\s+(one|is|was)\b/.test(lower) || /\b(the\s+)?cheaper\b/.test(lower) || /\bcheapest\b/.test(lower))
  );
}

const STOP_WORDS = new Set(["one", "the", "has", "have", "had", "more", "most", "best", "for", "with", "that", "this", "any", "some", "was", "were", "is", "are", "be", "been", "being", "do", "does", "did", "can", "could", "would", "should", "which", "what", "where", "how", "a", "an", "to", "me", "my", "us", "near", "close", "nearest", "closest", "closer", "nearer", "as", "too", "also", "though"]);

const QUESTION_STARTERS = new Set(["which", "what", "where", "how"]);

/** When the user asks "which one has X" or "which is best for Y", extract X/Y so we can search by it (e.g. "students", "wifi"). */
function extractCriterionFromQuestion(s: string): string | null {
  // Strip trailing discourse markers first so "food as well" → "food", "wifi too" → "wifi"
  const stripped = s
    .replace(/\s+(as\s+well|as\s+well\s+as|too|also|though|though)\s*\??\s*$/i, "")
    .replace(/\?/g, "")
    .trim();
  let words = stripped
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
  if (words.length === 0) return null;
  // Drop leading question word so "which students" -> "students", "which one wifi" (after stop) -> "wifi"
  if (QUESTION_STARTERS.has(words[0])) words = words.slice(1);
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
  const reviewRefinement = isAdvanced && fallbackCurrentTurn && isReviewRefinement(fallbackCurrentTurn, refinementCriterion);
  const openFilterRefinement = isAdvanced && fallbackCurrentTurn && isOpenFilterRefinement(fallbackCurrentTurn);
  const priceFilterRefinement = isAdvanced && fallbackCurrentTurn && isPriceFilterRefinement(fallbackCurrentTurn);
  const proximityRefinement = isAdvanced && fallbackCurrentTurn && isProximityRefinement(fallbackCurrentTurn);

  // Build raw query with mode-specific priority:
  // Advanced: trust the LLM (it sees the full conversation) — llmQuery comes before regex extraction.
  //   Never fall back to memory.rawQuery (it accumulates all user messages and is noisy).
  // Intermediate: keep regex-first priority (stateless, LLM only sees the last message anyway).
  let rawQuery: string;
  if (isAdvanced) {
    if (refinementCriterion && !reviewRefinement && !openFilterRefinement && !priceFilterRefinement && !proximityRefinement) {
      // Always combine memoryFallback (entity + previous attributes, e.g. "coffee shop quiet") with the new
      // criterion from the LLM or regex so prior conversation keywords carry forward into this search.
      const newCriterion = llmQuery || refinementCriterion;
      rawQuery = panelKeyword || (memoryFallback ? memoryFallback + " " + newCriterion : newCriterion) || "place";
    } else {
      // Fresh search or a special refinement (review/open/price/proximity): LLM drives, then clean memory fallback.
      rawQuery = panelKeyword || llmQuery || memoryFallback || "place";
    }
  } else {
    // Intermediate: regex-based extraction is primary (stateless; full conversation not available to LLM here).
    if (refinementCriterion && !reviewRefinement && !openFilterRefinement && !priceFilterRefinement) {
      const context = memoryFallback || "place";
      rawQuery = context + " " + refinementCriterion;
    } else {
      rawQuery =
        panelKeyword ||
        refinementCriterion ||
        llmQuery ||
        fallbackCurrentTurn ||
        (memory.rawQuery && memory.rawQuery.trim()) ||
        memoryFallback ||
        "place";
    }
  }

  // Don't use "better reviews", "open", "cheap", or proximity words as keywords:
  // keep entity/context from conversation and apply filter/sort/boost instead.
  if (reviewRefinement) {
    rawQuery = panelKeyword || (llmQuery && !isReviewRefinement("", llmQuery) ? llmQuery : null) || memoryFallback || "place";
  }
  if (openFilterRefinement) {
    rawQuery = panelKeyword || memoryFallback || (llmQuery && !/^\s*open\s*$/i.test(llmQuery.trim()) ? llmQuery : null) || memoryFallback || "place";
  }
  if (priceFilterRefinement) {
    rawQuery = panelKeyword || memoryFallback || (llmQuery && !isPriceFilterRefinement(llmQuery) ? llmQuery : null) || memoryFallback || "place";
  }
  if (proximityRefinement) {
    rawQuery = panelKeyword || memoryFallback || (llmQuery && !isProximityRefinement(llmQuery) ? llmQuery : null) || memoryFallback || "place";
  }
  // Don't send "within 2 km" etc. as keyword—strip so the geo filter handles distance.
  rawQuery = stripDistanceAndLocationPhrases(rawQuery) || memoryFallback || "place";
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
    let radiusKm = llmIntent.filters?.geoRadiusKm ?? memory.filters.geoRadiusKm ?? 5;
    // If user said "within N km" but intent didn't set it, extract from the last message so the filter is correct.
    const msgForRadius = fallbackCurrentTurn || llmQuery || "";
    const extractedKm = extractRadiusKm(msgForRadius);
    if (extractedKm != null) radiusKm = extractedKm;
    filters.geo = { lat, lon, radiusKm };
  }
  // Preserve filters from conversation memory when LLM doesn't override (e.g. "which one has X" often has no filter in intent)
  if (llmIntent.filters?.openNow !== undefined) filters.openNow = llmIntent.filters.openNow;
  else if (isAdvanced && memory.filters.openNow !== undefined) filters.openNow = memory.filters.openNow;
  if (llmIntent.filters?.priceTier) filters.priceTier = llmIntent.filters.priceTier;
  else if (isAdvanced && memory.filters.priceTier) filters.priceTier = memory.filters.priceTier;
  if (openFilterRefinement) filters.openNow = true;
  if (priceFilterRefinement) filters.priceTier = "cheap";

  const boosts: QueryPlan["boosts"] = {};
  if (llmIntent.boosts?.distance) boosts.distance = sanitizeBoostLevel(llmIntent.boosts.distance);
  if (llmIntent.boosts?.rating && llmIntent.boosts.rating !== "low")
    boosts.rating = sanitizeBoostLevel(llmIntent.boosts.rating);
  if (llmIntent.boosts?.reviewEvidence)
    boosts.reviewEvidence = sanitizeBoostLevel(llmIntent.boosts.reviewEvidence);

  let sort: Array<{ field: AllowedSortField; order: "asc" | "desc" }> = (llmIntent.sort ?? ["rating", "distance"])
    .slice(0, 3)
    .map((s) => {
      const [field, order] = s.toLowerCase().split(/\s+/);
      return {
        field: sanitizeSortField(field || "rating"),
        order: (order === "asc" ? "asc" : "desc") as "asc" | "desc",
      };
    });
  if (sort.length === 0) sort.push({ field: "rating", order: "desc" });
  if (reviewRefinement) {
    boosts.rating = boosts.rating ?? "high";
    boosts.reviewEvidence = boosts.reviewEvidence ?? "high";
    sort = [{ field: "rating", order: "desc" }, { field: "distance", order: "asc" }];
  }

  if (proximityRefinement) {
    boosts.distance = "high";
    sort = [{ field: "distance", order: "asc" }, { field: "rating", order: "desc" }];
  }

  const mustHaveFromReviews =
    refinementCriterion && !reviewRefinement && !priceFilterRefinement && !proximityRefinement
      ? [refinementCriterion, ...(Array.isArray(llmIntent.mustHaveFromReviews) ? llmIntent.mustHaveFromReviews : [])].slice(0, 5)
      : (Array.isArray(llmIntent.mustHaveFromReviews) ? llmIntent.mustHaveFromReviews.slice(0, 5) : []);

  if (refinementCriterion && !proximityRefinement && !boosts.reviewEvidence) boosts.reviewEvidence = "high";

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
