import type { ChatRequestPayload, ChatResponsePayload } from "@nextgen-location-search/types";
import { extractMemory } from "@nextgen-location-search/memory";
import { generateIntentPlan, generateChatResponse, generateConversationalResponse } from "@nextgen-location-search/llm";
import { buildQueryPlan } from "@nextgen-location-search/planner";
import { executeSearch, buildSearchBody, type OpenSearchClientLike } from "@nextgen-location-search/search";
import { buildExplanation } from "@nextgen-location-search/explain";
import type { LLMClientLike } from "./llm-client.js";
import { embedQuery } from "./embed-query.js";

/** Max number of results returned (Beginner, Semantic, Intermediate, Advanced). Set SEARCH_RESULTS_SIZE in .env (default 10). */
const DEFAULT_RESULTS_SIZE = 10;
function getResultsSize(): number {
  const raw = process.env.SEARCH_RESULTS_SIZE;
  if (raw == null || raw === "") return DEFAULT_RESULTS_SIZE;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 && n <= 100 ? n : DEFAULT_RESULTS_SIZE;
}

export async function handleChat(
  payload: ChatRequestPayload,
  searchClient: OpenSearchClientLike,
  llmClient: LLMClientLike | null
): Promise<ChatResponsePayload> {
  const { mode, messages, userContext, currentKeyword } = payload;

  // Beginner, Semantic and Intermediate are stateless — only the latest user message
  // is used for memory extraction. Advanced uses the full conversation history.
  const memoryMessages = mode === "advanced" ? messages : messages.slice(-1);
  const memory = extractMemory(memoryMessages, userContext);

  // LLM intent planning runs for Intermediate and Advanced modes
  let intentPlan = null;
  if ((mode === "intermediate" || mode === "advanced") && llmClient) {
    const result = await generateIntentPlan(messages, memory, userContext, llmClient);
    intentPlan = result?.plan ?? null;
    console.log("[chat-handler] intentPlan.isSearchQuery =", intentPlan?.isSearchQuery, "| query =", intentPlan?.query);
  }

  // Advanced conversational: if the LLM says this is not a search query, skip the search pipeline entirely
  const lastMsg = messages.filter((m) => m.role === "user").pop()?.content?.trim().toLowerCase() ?? "";
  const obviouslyConversational = /^(hi|hello|hey|thanks|thank you|great|ok|okay|sure|cool|awesome|who are you|what can you do|what do you do)\W*$/.test(lastMsg);
  const isRefinementQuestion = /\bwhich\s+(one|has|is|was)\b/.test(lastMsg);
  const isConversationalTurn =
    mode === "advanced" &&
    !isRefinementQuestion &&
    (intentPlan?.isSearchQuery === false || obviouslyConversational);
  if (isConversationalTurn && llmClient) {
    console.log("[chat-handler] → conversational branch, skipping search");
    const chatResponse = await generateConversationalResponse(messages, llmClient);
    // Return a minimal response — no results, no OpenSearch query
    const emptyPlan = buildQueryPlan(mode, memory, undefined, undefined, undefined);
    return {
      results: [],
      explanation: { whyMatched: "", filtersApplied: [], reviewSnippetsSupport: [], warnings: [] },
      queryPlan: emptyPlan,
      warnings: [],
      chatResponse,
      isConversational: true,
    };
  }

  const lastUserMessage =
    mode === "advanced"
      ? (messages.filter((m) => m.role === "user").pop()?.content ?? "").trim() || undefined
      : undefined;
  const plan = buildQueryPlan(mode, memory, intentPlan ?? undefined, lastUserMessage, currentKeyword);
  // Single canonical origin for distance: always from user context so distance is consistent across all modes
  const userLocation = { lat: userContext.lat, lon: userContext.lon };

  let queryVector: number[] | undefined;
  if (mode === "semantic") {
    try {
      queryVector = await embedQuery(plan.query);
    } catch (err) {
      throw new Error(
        `Semantic search requires embeddings. ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  if (mode === "advanced") {
    try {
      queryVector = await embedQuery(plan.query);
    } catch {
      // Optional: proceed without vector for Advanced if embedding fails
    }
  }

  const size = getResultsSize();
  const opensearchRequest = buildSearchBody(plan, {
    size,
    userLocation,
    queryVector,
  });

  const searchResult = await executeSearch(searchClient, plan, {
    size,
    userLocation,
    queryVector,
  });

  let topHits = searchResult.hits.slice(0, size);
  let explanation = buildExplanation(topHits, plan);
  const warnings = explanation.warnings;

  const response: ChatResponsePayload = {
    results: topHits,
    explanation,
    queryPlan: plan,
    warnings,
    opensearchRequest,
  };

  if (mode === "intermediate" && intentPlan?.clarifyingQuestion) {
    response.clarifyingQuestion = intentPlan.clarifyingQuestion;
  }

  // Advanced mode: generate conversational reply and reorder results to match AI recommendation
  if (mode === "advanced" && llmClient) {
    const { text, recommendedOrder } = await generateChatResponse(messages, topHits, llmClient);
    response.chatResponse = text;
    if (intentPlan?.clarifyingQuestion) {
      response.clarifyingQuestion = intentPlan.clarifyingQuestion;
    }
    if (recommendedOrder.length > 0) {
      const byName = new Map(topHits.map((h) => [h.name, h]));
      const reordered: typeof topHits = [];
      for (const name of recommendedOrder) {
        const hit = byName.get(name);
        if (hit) {
          reordered.push(hit);
          byName.delete(name);
        }
      }
      for (const hit of byName.values()) reordered.push(hit);
      if (reordered.length > 0) {
        topHits = reordered;
        response.results = topHits;
        response.explanation = buildExplanation(topHits, plan);
      }
    }
  }

  return response;
}
