import type { ChatMessage, IntentPlan, MemoryResult, UserContext } from "@nextgen-location-search/types";
import { IntentPlanSchema, type IntentPlanOutput } from "./schema.js";

export interface LLMClientLike {
  chat(messages: Array<{ role: string; content: string }>): Promise<string>;
}

const SYSTEM_PROMPT = `You are a conversational assistant that also helps users find local places (coffee shops, restaurants, hotels, etc.).

First, decide if the user is asking to find / search for a place:
- "isSearchQuery": true  → user wants to find a place, get recommendations, or refine a previous place search
- "isSearchQuery": false → user is just chatting (greetings, general questions, asking about you, following up conversationally with no place intent)

Examples:
- "hi", "hello", "how are you?" → isSearchQuery: false
- "thanks!", "great, thanks" → isSearchQuery: false
- "what can you do?", "who are you?" → isSearchQuery: false
- "find me a coffee shop", "I want somewhere quiet to work" → isSearchQuery: true
- "what was that first one again?", "which one was cheaper?" → isSearchQuery: true (refining previous search)
- "show me open places near the beach" → isSearchQuery: true
- "which one from the list", "which should I go to", "which would you recommend?" → isSearchQuery: true

Output a single JSON object (no markdown, no code fence) with this exact schema:
{
  "isSearchQuery": true | false,
  "query": "search keywords only, 1-5 words",
  "filters": {
    "geoRadiusKm": number or omit,
    "openNow": boolean or omit,
    "priceTier": "cheap" | "moderate" | "expensive" | "any" or omit
  },
  "mustHaveFromReviews": ["phrase1", "phrase2"],
  "niceToHaveFromReviews": ["phrase1"],
  "boosts": {
    "distance": "low" | "medium" | "high",
    "rating": "medium" | "high" (omit key unless user asks to prioritize rating),
    "reviewEvidence": "low" | "medium" | "high"
  },
  "sort": ["rating desc", "distance asc"],
  "warningsToCheck": ["e.g. gets busy after 11"],
  "clarifyingQuestion": "optional question or null"
}

When isSearchQuery is false, you still must output the full JSON (use empty/default values for search fields).

Critical rules:

Filters (you MUST set these when the user mentions them):
- When the user says "open", "open now", "currently open", or "that's open" -> set "filters.openNow": true. Never omit openNow when they ask for an open place.
- When the user says "near the beach", "by the water", "within X km", etc. -> set "filters.geoRadiusKm" if they give a distance; location terms like "beach" go into "query" so the search can match them.

"mustHaveFromReviews" (CRITICAL — use this whenever the user asks about a specific quality, item, or feature):
- When the user asks for a specific food or drink item (espresso, latte, pour-over, cappuccino, matcha, flat white, cold brew, etc.) → add that item to mustHaveFromReviews AND set boosts.reviewEvidence: "high". These items are mentioned in customer reviews, not in place names.
- When the user asks about any specific feature, vibe, or quality that customers would mention in reviews (quiet, wifi, outdoor seating, students, friendly staff, good for work, cozy, food, snacks, etc.) → add to mustHaveFromReviews.
- IMPORTANT: NEVER add discourse markers or filler phrases to mustHaveFromReviews. Words like "as well", "too", "also", "as well as", "though" are NOT search terms — they are English filler. For "which one has food as well", only add "food", not "as well".
- Example: "best espresso in town" → query: "coffee espresso", mustHaveFromReviews: ["espresso"], boosts: { distance: "low", reviewEvidence: "high" }
- Example: "where can I get a good pour-over?" → query: "coffee pour-over", mustHaveFromReviews: ["pour-over"], boosts: { reviewEvidence: "high" }
- Example: "quiet place to work with wifi" → query: "quiet coffee shop", mustHaveFromReviews: ["quiet", "wifi"], boosts: { reviewEvidence: "high" }

"query" (search keywords sent to OpenSearch):
- Include BOTH place type AND location/atmosphere when the user mentions them. Examples: "coffee shop beach", "restaurant near water", "quiet cafe wifi". Do not drop location terms like "beach".
- "query" must be 1-5 words: place type + optional location (beach, water, harbor, downtown) + optional vibe (quiet, lively). NEVER include question phrases ("where should i go", "should i go", "can you find").
- CRITICAL for follow-ups: When the user asks "which one has X", "which one is better for Y", or "which has more Z", set "query" to the CRITERION (X, Y, Z) so search can rank by it. Also add X/Y/Z to mustHaveFromReviews. Examples: "which one has more students" -> "query": "students" or "student cafe", mustHaveFromReviews: ["students"]; "which one has wifi?" -> "query": "wifi", mustHaveFromReviews: ["wifi"]; "which one is best for studying?" -> "query": "studying", mustHaveFromReviews: ["studying", "students"]; "which has outdoor seating?" -> "query": "outdoor seating", mustHaveFromReviews: ["outdoor seating"].
- CRITICAL for vague follow-ups ("which one from the list", "which one would you recommend", "which should I go to", "which one is better"): Look at the conversation history to find what place type/category was being searched. Keep that place type as the query (e.g. "coffee shop"). Set boosts.rating: "high", boosts.reviewEvidence: "high". Do NOT set query to "which one" or any question phrase.
- When the user asks "which one is close to me", "which is nearest", "which is closest", "which one is nearby", or similar proximity questions: Keep the place type from context as the query (e.g. "coffee shop"). Set boosts.distance: "high", sort: ["distance asc"]. Do NOT set query to "close", "near", "closest", "nearest", or any proximity term.
- EXCEPTION: When the user asks about "better reviews", "best reviews", or "good reviews", do NOT set query to those words. Keep "query" as the place type from context (e.g. "coffee shop") and set "boosts": { "rating": "high", "reviewEvidence": "high" }, "sort": ["rating desc", "distance asc"]. When the user asks for "open" places or "which ones are open" or "cafes that are open", do NOT set query to "open". Keep "query" as the place type (e.g. "coffee shop") and set "filters": { "openNow": true }. When the user asks "which one is cheaper", "the cheaper one", or "which is cheapest", do NOT set query to "cheaper" or "cheapest". Keep "query" as the place type and set "filters": { "priceTier": "cheap" }.
- Example: "I want to go to an open coffee shop near the beach, where should i go?" -> "query": "coffee shop beach", "filters": { "openNow": true }, and geoRadiusKm if they said a distance.
- In boosts, only set "rating" to medium or high when the user explicitly asks to prioritize or sort by rating. Otherwise omit "rating". sort is array of "field order". Output only valid JSON.`;

/**
 * Generate intent plan from messages, memory, and user context.
 * Returns validated IntentPlan or null on failure (caller should fallback to Semantic mode).
 */
export async function generateIntentPlan(
  messages: ChatMessage[],
  memory: MemoryResult,
  userContext: UserContext,
  llm?: LLMClientLike | null
): Promise<{ plan: IntentPlan; raw?: string } | null> {
  if (!llm) return null;

  const conversationText = messages
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");
  const memorySummary = JSON.stringify({
    entity: memory.entity,
    attributes: memory.attributes,
    filters: memory.filters,
    reviewPreferences: memory.reviewPreferences,
  });
  const contextSummary = `User location: ${userContext.lat}, ${userContext.lon}. Time: ${userContext.timestamp}.`;

  const userPrompt = `Full conversation (use it to understand context; latest user message may override earlier intent):\n${conversationText}\n\nExtracted memory: ${memorySummary}\n\n${contextSummary}\n\nOutput the intent plan JSON only. For "query" include ALL relevant terms: place type AND location (e.g. beach, water) when the user mentions them. Set filters.openNow to true whenever the user asks for an "open" or "open now" place. Do not include question phrases in "query".`;

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

  const result = IntentPlanSchema.safeParse(parsed);
  if (!result.success) {
    return null;
  }

  const out: IntentPlan = result.data as IntentPlanOutput;
  return { plan: out, raw: cleaned };
}

export type { IntentPlanOutput };
