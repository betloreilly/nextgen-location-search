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

"query" (search keywords sent to OpenSearch):
- Include BOTH place type AND location/atmosphere when the user mentions them. Examples: "coffee shop beach", "restaurant near water", "quiet cafe wifi". Do not drop location terms like "beach".
- "query" must be 1-5 words: place type + optional location (beach, water, harbor, downtown) + optional vibe (quiet, lively). NEVER include question phrases ("where should i go", "should i go", "can you find").
- CRITICAL for follow-ups: When the user asks "which one has X", "which one is better for Y", or "which has more Z", set "query" to the CRITERION (X, Y, Z) so search can rank by it. Examples: "which one has more students" -> "query": "students" or "student cafe"; "which one has wifi?" -> "query": "wifi"; "which one is best for studying?" -> "query": "studying" or "student"; "which has outdoor seating?" -> "query": "outdoor seating". This ensures places like Campus Brew (student cafe) rank when the user asks for students.
- Example: "I want to go to an open coffee shop near the beach, where should i go?" -> "query": "coffee shop beach", "filters": { "openNow": true }, and geoRadiusKm if they said a distance.
- Example: "quiet place to work with wifi" -> "query": "quiet wifi" or "quiet coffee shop", mustHaveFromReviews: ["quiet", "wifi"] or similar.
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
