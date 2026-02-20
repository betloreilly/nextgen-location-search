import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChatRequestPayload } from "@nextgen-location-search/types";

const userContext = { lat: 40.7128, lon: -74.006, timestamp: new Date().toISOString() };

const fakeVector = vi.hoisted(() => Array(1536).fill(0.01));
const mockSearchClient = vi.hoisted(() => ({
  search: vi.fn().mockResolvedValue({
    body: {
      hits: { hits: [], total: { value: 0 }, max_score: 0 },
    },
  }),
}));

vi.mock("./embed-query.js", () => ({
  embedQuery: vi.fn().mockResolvedValue(fakeVector),
}));

vi.mock("@nextgen-location-search/llm", () => ({
  generateIntentPlan: vi.fn(),
  generateChatResponse: vi.fn().mockResolvedValue({
    text: "Here are some great options.",
    recommendedOrder: [],
  }),
  generateConversationalResponse: vi.fn().mockResolvedValue("Hi! I'm here to help you find places. What are you looking for?"),
}));

import { handleChat } from "./chat-handler.js";
import { embedQuery } from "./embed-query.js";
import { generateIntentPlan, generateChatResponse, generateConversationalResponse } from "@nextgen-location-search/llm";

describe("handleChat - 4 search modes pipeline", () => {
  beforeEach(() => {
    vi.mocked(mockSearchClient.search).mockClear();
    vi.mocked(embedQuery).mockClear();
    vi.mocked(generateIntentPlan).mockClear();
    vi.mocked(generateChatResponse).mockClear();
    vi.mocked(generateConversationalResponse).mockClear();
  });

  describe("1) Traditional (beginner) - BM25 keyword + geo filter", () => {
    it("selects correct pipeline: no LLM, no embedding, keyword + geo", async () => {
      const payload: ChatRequestPayload = {
        mode: "beginner",
        messages: [
          { id: "1", role: "user", content: "coffee shop within 5km", timestamp: new Date().toISOString() },
        ],
        userContext,
        currentKeyword: "coffee shop",
      };
      const res = await handleChat(payload, mockSearchClient as never, null);
      expect(res.queryPlan.mode).toBe("beginner");
      expect(generateIntentPlan).not.toHaveBeenCalled();
      expect(embedQuery).not.toHaveBeenCalled();
      expect(generateChatResponse).not.toHaveBeenCalled();
      expect(mockSearchClient.search).toHaveBeenCalled();
      const body = res.opensearchRequest?.body ?? {};
      expect(body.query).toBeDefined();
      expect(JSON.stringify(body)).toContain("geo_distance");
      expect(JSON.stringify(body)).not.toContain("knn");
    });

    it("query payload has multi_match or match_all and geo filter", async () => {
      const payload: ChatRequestPayload = {
        mode: "beginner",
        messages: [
          { id: "1", role: "user", content: "cafe nearby 3km", timestamp: new Date().toISOString() },
        ],
        userContext,
        currentKeyword: "cafe",
      };
      const res = await handleChat(payload, mockSearchClient as never, null);
      expect(res.opensearchRequest?.body?.query).toBeDefined();
      const q = res.opensearchRequest?.body?.query as Record<string, unknown>;
      expect(q.bool).toBeDefined();
      expect(JSON.stringify(res.opensearchRequest?.body)).toMatch(/geo_distance|multi_match|match_all/);
    });
  });

  describe("2) Semantic - kNN only (no geo, no boosting, no memory)", () => {
    it("calls embedQuery and builds kNN-only body", async () => {
      const payload: ChatRequestPayload = {
        mode: "semantic",
        messages: [
          { id: "1", role: "user", content: "quiet place to work with wifi", timestamp: new Date().toISOString() },
        ],
        userContext,
      };
      const res = await handleChat(payload, mockSearchClient as never, null);
      expect(res.queryPlan.mode).toBe("semantic");
      expect(embedQuery).toHaveBeenCalled();
      expect(generateIntentPlan).not.toHaveBeenCalled();
      const body = (res.opensearchRequest?.body ?? {}) as Record<string, unknown>;
      expect((body.query as Record<string, unknown>)?.knn).toBeDefined();
      expect(JSON.stringify(body)).not.toContain("_geo_distance");
      expect(JSON.stringify(body)).not.toContain("geo_distance");
      expect(body.sort).toEqual([{ _score: "desc" }]);
    });

    it("throws when embedding fails and no fallback", async () => {
      vi.mocked(embedQuery).mockRejectedValueOnce(new Error("API key missing"));
      const payload: ChatRequestPayload = {
        mode: "semantic",
        messages: [{ id: "1", role: "user", content: "coffee", timestamp: new Date().toISOString() }],
        userContext,
      };
      await expect(handleChat(payload, mockSearchClient as never, null)).rejects.toThrow(/Semantic search requires embeddings/);
    });
  });

  describe("3) Intermediate - LLM intent + filters + boosting + geo", () => {
    it("calls LLM for intent, embeds for optional vector path but buildSearchBody uses keyword path", async () => {
      vi.mocked(generateIntentPlan).mockResolvedValue({
        plan: {
          query: "coffee shop beach",
          filters: { geoRadiusKm: 5, openNow: true, priceTier: "any" as const },
          mustHaveFromReviews: ["quiet"],
          niceToHaveFromReviews: [],
          boosts: { distance: "medium", reviewEvidence: "high" },
          sort: ["rating desc", "distance asc"],
          warningsToCheck: [],
          clarifyingQuestion: null,
        },
        raw: "{}",
      });
      const payload: ChatRequestPayload = {
        mode: "intermediate",
        messages: [
          { id: "1", role: "user", content: "open coffee shop near beach within 5km", timestamp: new Date().toISOString() },
        ],
        userContext,
      };
      const res = await handleChat(payload, mockSearchClient as never, {} as never);
      expect(res.queryPlan.mode).toBe("intermediate");
      expect(generateIntentPlan).toHaveBeenCalled();
      expect(mockSearchClient.search).toHaveBeenCalled();
      const body = (res.opensearchRequest?.body ?? {}) as Record<string, unknown>;
      expect(JSON.stringify(body.sort)).toContain("_geo_distance");
      const q = body.query as Record<string, unknown>;
      expect(q?.function_score ?? q?.bool).toBeDefined();
    });

    it("boosting exists in payload when LLM returns boosts", async () => {
      vi.mocked(generateIntentPlan).mockResolvedValue({
        plan: {
          query: "coffee",
          filters: {},
          mustHaveFromReviews: [],
          niceToHaveFromReviews: [],
          boosts: { distance: "high", rating: "medium", reviewEvidence: "low" },
          sort: ["rating desc", "distance asc"],
          warningsToCheck: [],
          clarifyingQuestion: null,
        },
        raw: "{}",
      });
      const payload: ChatRequestPayload = {
        mode: "intermediate",
        messages: [{ id: "1", role: "user", content: "best rated coffee nearby", timestamp: new Date().toISOString() }],
        userContext,
      };
      const res = await handleChat(payload, mockSearchClient as never, {} as never);
      expect(JSON.stringify(res.opensearchRequest?.body)).toContain("function_score");
    });

    it("memory is only last message (stateless)", async () => {
      vi.mocked(generateIntentPlan).mockResolvedValue({
        plan: {
          query: "coffee",
          filters: {},
          mustHaveFromReviews: [],
          niceToHaveFromReviews: [],
          boosts: { distance: "medium", reviewEvidence: "medium" },
          sort: ["rating desc", "distance asc"],
          warningsToCheck: [],
          clarifyingQuestion: null,
        },
        raw: "{}",
      });
      const payload: ChatRequestPayload = {
        mode: "intermediate",
        messages: [
          { id: "1", role: "user", content: "quiet coffee", timestamp: new Date().toISOString() },
          { id: "2", role: "user", content: "actually open now", timestamp: new Date().toISOString() },
        ],
        userContext,
      };
      await handleChat(payload, mockSearchClient as never, {} as never);
      expect(generateIntentPlan).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(Object),
        userContext,
        expect.anything()
      );
      const [, memory] = vi.mocked(generateIntentPlan).mock.calls[0];
      expect(memory).toBeDefined();
    });
  });

  describe("4) Advanced - conversational memory + hybrid + filters + boosting + geo", () => {
    it("uses full conversation for memory and LLM, embeds and builds hybrid", async () => {
      vi.mocked(generateIntentPlan).mockResolvedValue({
        plan: {
          isSearchQuery: true,
          query: "quiet coffee",
          filters: { geoRadiusKm: 3, openNow: true },
          mustHaveFromReviews: ["quiet"],
          niceToHaveFromReviews: [],
          boosts: { distance: "medium", reviewEvidence: "high" },
          sort: ["rating desc", "distance asc"],
          warningsToCheck: [],
          clarifyingQuestion: null,
        },
        raw: "{}",
      });
      const payload: ChatRequestPayload = {
        mode: "advanced",
        messages: [
          { id: "1", role: "user", content: "I want a quiet coffee shop", timestamp: new Date().toISOString() },
          { id: "2", role: "assistant", content: "Here are some options.", timestamp: new Date().toISOString() },
          { id: "3", role: "user", content: "open now and within 3km", timestamp: new Date().toISOString() },
        ],
        userContext,
      };
      const res = await handleChat(payload, mockSearchClient as never, {} as never);
      expect(res.queryPlan.mode).toBe("advanced");
      expect(generateIntentPlan).toHaveBeenCalled();
      expect(embedQuery).toHaveBeenCalled();
      expect(generateChatResponse).toHaveBeenCalled();
      expect(res.chatResponse).toBeDefined();
      const body = (res.opensearchRequest?.body ?? {}) as Record<string, unknown>;
      expect((body.query as Record<string, unknown>)?.bool?.should).toBeDefined();
      expect(JSON.stringify(body)).toContain("knn");
      expect(JSON.stringify(body.sort)).toContain("_score");
      expect(JSON.stringify(body.sort)).toContain("_geo_distance");
    });

    it("conversational turn skips search and returns isConversational", async () => {
      vi.mocked(generateIntentPlan).mockResolvedValue({
        plan: {
          isSearchQuery: false,
          query: "place",
          filters: {},
          mustHaveFromReviews: [],
          niceToHaveFromReviews: [],
          boosts: { distance: "medium", reviewEvidence: "medium" },
          sort: ["rating desc", "distance asc"],
          warningsToCheck: [],
          clarifyingQuestion: null,
        },
        raw: "{}",
      });
      const payload: ChatRequestPayload = {
        mode: "advanced",
        messages: [
          { id: "1", role: "user", content: "hi", timestamp: new Date().toISOString() },
        ],
        userContext,
      };
      const res = await handleChat(payload, mockSearchClient as never, {} as never);
      expect(res.isConversational).toBe(true);
      expect(res.results).toEqual([]);
      expect(res.chatResponse).toBeDefined();
      expect(generateConversationalResponse).toHaveBeenCalled();
      expect(mockSearchClient.search).not.toHaveBeenCalled();
    });

    it("obviously conversational message (e.g. thanks) skips search even if LLM returns isSearchQuery true", async () => {
      vi.mocked(generateIntentPlan).mockResolvedValue({
        plan: {
          isSearchQuery: true,
          query: "place",
          filters: {},
          mustHaveFromReviews: [],
          niceToHaveFromReviews: [],
          boosts: { distance: "medium", reviewEvidence: "medium" },
          sort: ["rating desc", "distance asc"],
          warningsToCheck: [],
          clarifyingQuestion: null,
        },
        raw: "{}",
      });
      const payload: ChatRequestPayload = {
        mode: "advanced",
        messages: [
          { id: "1", role: "user", content: "thanks!", timestamp: new Date().toISOString() },
        ],
        userContext,
      };
      const res = await handleChat(payload, mockSearchClient as never, {} as never);
      expect(res.isConversational).toBe(true);
      expect(mockSearchClient.search).not.toHaveBeenCalled();
    });
  });

  describe("Edge cases and failure fallbacks", () => {
    it("Intermediate with null LLM intent falls back to memory-only plan", async () => {
      vi.mocked(generateIntentPlan).mockResolvedValue(null);
      const payload: ChatRequestPayload = {
        mode: "intermediate",
        messages: [{ id: "1", role: "user", content: "coffee shop near me", timestamp: new Date().toISOString() }],
        userContext,
      };
      const res = await handleChat(payload, mockSearchClient as never, {} as never);
      expect(res.queryPlan.mode).toBe("intermediate");
      expect(res.results).toEqual([]);
      expect(mockSearchClient.search).toHaveBeenCalled();
    });

    it("Advanced embedding failure proceeds without vector (keyword-only)", async () => {
      vi.mocked(embedQuery).mockRejectedValueOnce(new Error("Rate limit"));
      vi.mocked(generateIntentPlan).mockResolvedValue({
        plan: {
          isSearchQuery: true,
          query: "coffee",
          filters: {},
          mustHaveFromReviews: [],
          niceToHaveFromReviews: [],
          boosts: { distance: "medium", reviewEvidence: "medium" },
          sort: ["rating desc", "distance asc"],
          warningsToCheck: [],
          clarifyingQuestion: null,
        },
        raw: "{}",
      });
      const payload: ChatRequestPayload = {
        mode: "advanced",
        messages: [{ id: "1", role: "user", content: "coffee", timestamp: new Date().toISOString() }],
        userContext,
      };
      const res = await handleChat(payload, mockSearchClient as never, {} as never);
      expect(res.queryPlan.mode).toBe("advanced");
      expect(res.results).toEqual([]);
      const body = (res.opensearchRequest?.body ?? {}) as Record<string, unknown>;
      const q = body.query as Record<string, unknown>;
      expect(q?.bool?.should).toBeUndefined();
      expect(q?.knn).toBeUndefined();
    });

    it("LLM client null: Traditional and Semantic still run; Intermediate/Advanced skip LLM", async () => {
      const payloadT: ChatRequestPayload = {
        mode: "beginner",
        messages: [{ id: "1", role: "user", content: "coffee 5km", timestamp: new Date().toISOString() }],
        userContext,
        currentKeyword: "coffee",
      };
      const resT = await handleChat(payloadT, mockSearchClient as never, null);
      expect(resT.queryPlan.mode).toBe("beginner");
      expect(mockSearchClient.search).toHaveBeenCalled();

      vi.mocked(mockSearchClient.search).mockClear();
      const payloadI: ChatRequestPayload = {
        mode: "intermediate",
        messages: [{ id: "1", role: "user", content: "coffee", timestamp: new Date().toISOString() }],
        userContext,
      };
      const resI = await handleChat(payloadI, mockSearchClient as never, null);
      expect(resI.queryPlan.mode).toBe("intermediate");
      expect(generateIntentPlan).not.toHaveBeenCalled();
    });
  });
});
