import type { ChatRequestPayload, ChatResponsePayload, QueryPlan } from "@nextgen-location-search/types";
import { extractMemory } from "@nextgen-location-search/memory";
import {
  generateIntentPlan,
  generateAdvancedQueryPlan,
  generateChatResponse,
  generateConversationalResponse,
} from "@nextgen-location-search/llm";
import { buildQueryPlan } from "@nextgen-location-search/planner";
import { executeSearch, buildSearchBody, type OpenSearchClientLike } from "@nextgen-location-search/search";
import { buildExplanation } from "@nextgen-location-search/explain";
import type { LLMClientLike } from "./llm-client.js";
import { embedQuery } from "./embed-query.js";

/** Max number of results returned. Set SEARCH_RESULTS_SIZE in .env (default 15). */
const DEFAULT_RESULTS_SIZE = 15;
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
  const userLocation = { lat: userContext.lat, lon: userContext.lon };
  const size = getResultsSize();

  // ── Advanced mode: LLM reads the full conversation and produces the QueryPlan directly ──
  // This replaces the regex-based memory extraction + multi-step planner pipeline so the LLM
  // can reason across all conversation turns natively.
  if (mode === "advanced") {
    // Short-circuit obvious greetings before spending tokens on a full LLM call.
    const lastMsg = messages.filter((m) => m.role === "user").pop()?.content?.trim().toLowerCase() ?? "";
    const obviouslyConversational =
      /^(hi|hello|hey|thanks|thank you|great|ok|okay|sure|cool|awesome|who are you|what can you do|what do you do)\W*$/.test(
        lastMsg
      );

    if (obviouslyConversational && llmClient) {
      const chatResponse = await generateConversationalResponse(messages, llmClient);
      const memory = extractMemory(messages.slice(-1), userContext);
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

    // Ask the LLM to produce a complete QueryPlan from the full conversation.
    let advancedPlan: QueryPlan | null = null;
    if (llmClient) {
      const result = await generateAdvancedQueryPlan(messages, userContext, llmClient);

      if (result && !result.isSearchQuery) {
        // LLM determined this is a conversational (non-search) turn.
        const chatResponse = await generateConversationalResponse(messages, llmClient);
        const memory = extractMemory(messages.slice(-1), userContext);
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

      advancedPlan = result?.plan ?? null;
    }

    // Fallback: if LLM is unavailable or failed, build plan the old way using memory + IntentPlan.
    if (!advancedPlan) {
      const memory = extractMemory(messages, userContext);
      const intentResult = llmClient
        ? await generateIntentPlan(messages, memory, userContext, llmClient)
        : null;
      const lastUserMessage = (messages.filter((m) => m.role === "user").pop()?.content ?? "").trim() || undefined;
      advancedPlan = buildQueryPlan(mode, memory, intentResult?.plan ?? undefined, lastUserMessage, currentKeyword);
    }

    const plan = advancedPlan;

    let queryVector: number[] | undefined;
    try {
      queryVector = await embedQuery(plan.query);
    } catch {
      // Proceed without vector if embedding fails.
    }

    const opensearchRequest = buildSearchBody(plan, { size, userLocation, queryVector });
    const searchResult = await executeSearch(searchClient, plan, { size, userLocation, queryVector });

    let topHits = searchResult.hits.slice(0, size);
    let explanation = buildExplanation(topHits, plan);

    const response: ChatResponsePayload = {
      results: topHits,
      explanation,
      queryPlan: plan,
      warnings: explanation.warnings,
      opensearchRequest,
    };

    // Generate conversational reply and let the LLM reorder results by best fit.
    if (llmClient) {
      const { text, recommendedOrder } = await generateChatResponse(messages, topHits, llmClient);
      response.chatResponse = text;
      if (recommendedOrder.length > 0) {
        const byName = new Map(topHits.map((h) => [h.name, h]));
        const reordered: typeof topHits = [];
        for (const name of recommendedOrder) {
          const hit = byName.get(name);
          if (hit) { reordered.push(hit); byName.delete(name); }
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

  // ── Beginner / Semantic / Intermediate: unchanged ─────────────────────────
  const memoryMessages = messages.slice(-1);
  const memory = extractMemory(memoryMessages, userContext);

  let intentPlan = null;
  if (mode === "intermediate" && llmClient) {
    const result = await generateIntentPlan(messages, memory, userContext, llmClient);
    intentPlan = result?.plan ?? null;
  }

  const plan = buildQueryPlan(mode, memory, intentPlan ?? undefined, undefined, currentKeyword);

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

  const opensearchRequest = buildSearchBody(plan, { size, userLocation, queryVector });
  const searchResult = await executeSearch(searchClient, plan, { size, userLocation, queryVector });

  const topHits = searchResult.hits.slice(0, size);
  const explanation = buildExplanation(topHits, plan);

  const response: ChatResponsePayload = {
    results: topHits,
    explanation,
    queryPlan: plan,
    warnings: explanation.warnings,
    opensearchRequest,
  };

  if (mode === "intermediate" && intentPlan?.clarifyingQuestion) {
    response.clarifyingQuestion = intentPlan.clarifyingQuestion;
  }

  return response;
}
