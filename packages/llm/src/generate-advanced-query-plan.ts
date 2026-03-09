import { z } from "zod";
import type { ChatMessage, QueryPlan, UserContext } from "@nextgen-location-search/types";
import type { LLMClientLike } from "./generate-intent.js";

// ── Zod schema for what the LLM returns ──────────────────────────────────────

const sortField = z.enum(["distance", "rating", "reviewScore", "_score", "priceTier"]);
const sortOrder = z.enum(["asc", "desc"]);
const boostLevel = z.enum(["low", "medium", "high"]);

const AdvancedQueryPlanSchema = z.object({
  isSearchQuery: z.boolean(),
  query: z.string(),
  filters: z.object({
    geo: z
      .object({
        lat: z.number(),
        lon: z.number(),
        radiusKm: z.number(),
      })
      .optional(),
    openNow: z.boolean().optional(),
    priceTier: z.enum(["cheap", "moderate", "expensive", "any"]).optional(),
  }),
  mustHaveFromReviews: z.array(z.string()),
  niceToHaveFromReviews: z.array(z.string()),
  boosts: z.object({
    distance: boostLevel.optional(),
    rating: boostLevel.optional(),
    reviewEvidence: boostLevel.optional(),
  }),
  sort: z.array(z.object({ field: sortField, order: sortOrder })),
  warningsToCheck: z.array(z.string()),
});

type AdvancedQueryPlanOutput = z.infer<typeof AdvancedQueryPlanSchema>;

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert OpenSearch query planner for a local place search chatbot.
The chatbot helps users find nearby places: coffee shops, cafes, restaurants, hotels, bars, etc.

The places index has:
  name, category, priceTier (cheap/moderate/expensive), rating (1-5), openNow (bool), location (geo_point)
  reviews: nested array of { text: string } — real customer review snippets written by visitors

You receive the full conversation history and the user's current location.

════ STEP 1 — UNDERSTAND THE USER'S INTENT ════
Before producing JSON, mentally answer these questions from the full conversation:
  A. What TYPE of place is the user looking for? (coffee shop, restaurant, cafe…)
  B. What QUALITIES or ATTRIBUTES did the user express across ALL turns?
     — look at every user message, not just the latest one
     — "best coffee" = high-quality coffee → translate to review terms: "good coffee", "best espresso", "quality coffee"
     — "calm", "quiet", "cozy" = atmosphere terms → keep in query and mustHaveFromReviews
  C. Is there a NEW criterion in the LATEST message? (e.g. "which one has wifi" → wifi is new)
  D. Are there any HARD requirements? (open now, price tier, within X km)
  E. Did the user ask about PROXIMITY specifically? (closest, nearest, within X km — this is rare)

CRITICAL — "which one" / "which one has X" / "which should I go to":
  These are REFINEMENTS of the previous search, not new searches.
  The user is saying: "From the places we were just discussing, which one ALSO has X?"
  You MUST carry forward ALL previous intent: place type + all quality terms + the new criterion.
  NEVER produce a query that only contains the new criterion — always combine with previous context.

Questions B and C together define what goes into mustHaveFromReviews and the query.
Question E is the ONLY case where distance matters for ranking. Otherwise, proximity is already handled by the geo filter.

════ STEP 2 — PRODUCE THE JSON ════
Output a single JSON object (no markdown, no code fences):
{
  "isSearchQuery": true | false,
  "query": "keyword string up to 6 words",
  "filters": {
    "geo": { "lat": <number>, "lon": <number>, "radiusKm": <number> },
    "openNow": true (omit if not mentioned),
    "priceTier": "cheap" | "moderate" | "expensive" (omit if not mentioned)
  },
  "mustHaveFromReviews": ["term1", "term2", "term3"],
  "niceToHaveFromReviews": ["term1"],
  "boosts": {
    "reviewEvidence": "high",
    "distance": "high" (ONLY when user asks for closest/nearest — omit otherwise),
    "rating": "high" (ONLY when user asks for best-rated — omit otherwise)
  },
  "sort": [{ "field": "_score", "order": "desc" }],
  "warningsToCheck": []
}

════ FIELD RULES ════

isSearchQuery:
  true  → user wants to find/search/refine a place
  false → pure chat (hi, thanks, who are you, etc.)
  When false: still output valid JSON with safe defaults.

"query":
  • Always include the place type from the conversation (e.g. "coffee shop", "cafe").
  • Always carry forward key quality words from PREVIOUS turns — these come from ALL earlier user messages.
  • Add the NEW criterion from the latest message.
  • "best X" or "good X" → translate to quality terms, do NOT drop them (e.g. "best coffee" → "coffee" + mustHaveFromReviews: ["quality coffee", "good coffee"])
  • Max 6 words. Never include question phrases, filler words ("as well", "too", "also"), or proximity words.
  • Examples:
      Turn 1 "calm cafe" → Turn 2 "which one has food"           → query: "quiet cafe food",    mustHaveFromReviews: ["quiet", "food"]
      Turn 1 "best coffee" → Turn 2 "which one has wifi"          → query: "coffee wifi",        mustHaveFromReviews: ["quality coffee", "wifi"]
      Turn 1 "quiet coffee shop" → Turn 2 "which one has espresso"→ query: "quiet coffee espresso", mustHaveFromReviews: ["quiet", "espresso"]
      Turn 1 "cafe" → Turn 2 "which one is open"                  → query: "cafe",               openNow filter handles it (no query change)
      Turn 1 "coffee shop" → Turn 2 "which is closest"            → query: "coffee shop",        sort by distance (no query change)

"mustHaveFromReviews" — THIS IS THE PRIMARY RANKING SIGNAL:
  • This is matched against real customer reviews to surface places where visitors actually mention these things.
  • Be GENEROUS — extract ALL meaningful quality/feature/attribute/food-drink terms from the ENTIRE conversation.
  • Always include attributes from previous turns too (e.g. if Turn 1 was "quiet cafe", mustHaveFromReviews should include "quiet" even in Turn 2).
  • Include: vibe words (quiet, cozy, lively, busy, calm, relaxed), features (wifi, outdoor seating, food, snacks, parking), specific drinks (espresso, latte, pour-over, cold brew, matcha), service words (friendly staff, fast service).
  • NEVER include: discourse markers ("as well", "too", "also"), generic words ("good", "nice", "great"), place types ("cafe", "shop").
  • Aim for 2-5 terms. More is better when the conversation gives you material.

"filters.geo":
  • ALWAYS include, using the user's lat/lon.
  • Default radiusKm = 5. Use the exact number the user states if they say "within X km".

"boosts":
  • reviewEvidence: ALWAYS set to "high" — reviews are the primary ranking signal.
  • distance: ONLY set to "high" when the user explicitly asks "which is closest/nearest/nearest to me". Leave it out otherwise.
  • rating: ONLY set to "high" when user asks for "best rated" or "highest rated".

"sort":
  • DEFAULT: [{ "field": "_score", "order": "desc" }] — relevance drives ranking.
  • When user asks for closest: [{ "field": "distance", "order": "asc" }, { "field": "_score", "order": "desc" }]
  • When user asks for best rated: [{ "field": "rating", "order": "desc" }, { "field": "_score", "order": "desc" }]

Conversation context:
  • "which one has X" / "which also has Y" → add X/Y to mustHaveFromReviews AND query; KEEP all previous attributes in both query and mustHaveFromReviews. NEVER drop previous intent.
  • "which one" with no new criterion → re-run the previous search exactly; use previous place type + all previous quality terms.
  • "best X" in any turn → translate to quality review terms (e.g. "best coffee" → mustHaveFromReviews: ["quality coffee", "consistent coffee"]).
  • "which is cheapest" → priceTier filter "cheap"; keep entity + previous attributes in query.
  • "which ones are open" → openNow: true filter; keep entity + previous attributes in query.
  • "which is closest/nearest" → sort by distance; keep entity + previous attributes in query. DO NOT add proximity words to mustHaveFromReviews.`;

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Advanced mode only: sends the entire conversation + user location to the LLM and
 * receives a complete QueryPlan in return. Bypasses all regex-based extraction and the
 * multi-step planner so the LLM can reason across turns natively.
 *
 * Returns null on failure; callers should fall back to the intermediate-mode pipeline.
 */
/** Returns a plain-text summary of what the user was searching for BEFORE the latest message.
 *  This is injected into the prompt so the LLM has an explicit anchor for "which one" refinements. */
function buildPreviousSearchSummary(messages: ChatMessage[]): string {
  const userMessages = messages.filter((m) => m.role === "user");
  if (userMessages.length <= 1) return "";
  // All user messages except the very last one
  const previous = userMessages.slice(0, -1).map((m) => m.content.trim()).filter(Boolean);
  return previous.length > 0 ? previous.join(" | ") : "";
}

export async function generateAdvancedQueryPlan(
  messages: ChatMessage[],
  userContext: UserContext,
  llm: LLMClientLike
): Promise<{ plan: QueryPlan; isSearchQuery: boolean } | null> {
  const conversationText = messages
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");

  const previousSearch = buildPreviousSearchSummary(messages);
  const latestUserMessage = messages.filter((m) => m.role === "user").pop()?.content ?? "";

  // Detect "which one" follow-ups so we can make the anchor explicit in the prompt
  const isRefinement = /^\s*(which|what)\s+(one|would|should|has|is|was|do)/i.test(latestUserMessage.trim());

  const refinementNote = isRefinement && previousSearch
    ? `\nIMPORTANT: The latest message is a REFINEMENT of the previous search.
Previous search context: "${previousSearch}"
The user is still looking for the same type of place and wants to narrow down by a new criterion.
Your query MUST include the place type and key quality words from the previous search PLUS the new criterion.
mustHaveFromReviews MUST include terms from BOTH the previous search AND the new criterion.\n`
    : "";

  const userPrompt = `User location: lat=${userContext.lat}, lon=${userContext.lon}. Current time: ${userContext.timestamp}.
${refinementNote}
Full conversation:
${conversationText}

Produce the best OpenSearch query plan JSON for this conversation.
Output JSON only.`;

  let raw: string;
  try {
    raw = await llm.chat([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ]);
  } catch {
    return null;
  }

  const cleaned = raw.replace(/^[\s\S]*?(\{[\s\S]*\})[\s\S]*$/m, "$1").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned) as unknown;
  } catch {
    return null;
  }

  const result = AdvancedQueryPlanSchema.safeParse(parsed);
  if (!result.success) {
    console.warn("[generateAdvancedQueryPlan] schema validation failed:", result.error.issues);
    return null;
  }

  const out: AdvancedQueryPlanOutput = result.data;

  // Always override geo with the actual user location so coordinates are never wrong.
  // The LLM only controls the radius.
  const plan: QueryPlan = {
    mode: "advanced",
    query: out.query.trim() || "place",
    filters: {
      geo: {
        lat: userContext.lat,
        lon: userContext.lon,
        radiusKm: out.filters.geo?.radiusKm ?? 5,
      },
      ...(out.filters.openNow !== undefined && { openNow: out.filters.openNow }),
      ...(out.filters.priceTier &&
        out.filters.priceTier !== "any" && { priceTier: out.filters.priceTier }),
    },
    mustHaveFromReviews: out.mustHaveFromReviews.slice(0, 5),
    niceToHaveFromReviews: out.niceToHaveFromReviews.slice(0, 5),
    boosts: {
      ...(out.boosts.distance && { distance: out.boosts.distance }),
      ...(out.boosts.rating &&
        out.boosts.rating !== "low" && { rating: out.boosts.rating }),
      ...(out.boosts.reviewEvidence && { reviewEvidence: out.boosts.reviewEvidence }),
    },
    sort:
      out.sort.length > 0
        ? out.sort
        : [{ field: "_score", order: "desc" }],
    warningsToCheck: out.warningsToCheck,
    useVector: true,
    useKeyword: true,
  };

  return { plan, isSearchQuery: out.isSearchQuery };
}
