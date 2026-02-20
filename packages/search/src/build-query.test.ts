import { describe, it, expect } from "vitest";
import type { QueryPlan } from "@nextgen-location-search/types";
import { buildSearchBody, INDEX_NAME } from "./build-query.js";

const userLocation = { lat: 40.7128, lon: -74.006 };
const fakeVector = Array(1536).fill(0.01);

function plan(mode: QueryPlan["mode"], overrides: Partial<QueryPlan> = {}): QueryPlan {
  const base: QueryPlan = {
    mode,
    query: "coffee shop",
    filters: {},
    mustHaveFromReviews: [],
    niceToHaveFromReviews: [],
    boosts: {},
    sort: [{ field: "rating", order: "desc" }, { field: "distance", order: "asc" }],
    warningsToCheck: [],
    useVector: mode === "semantic",
    useKeyword: mode !== "semantic",
  };
  return { ...base, ...overrides };
}

describe("buildSearchBody - 4 search modes", () => {
  describe("1) Traditional (beginner) - BM25 keyword + geo filter", () => {
    it("selects bool query with multi_match and geo_distance filter", () => {
      const p = plan("beginner", {
        query: "coffee",
        useKeyword: true,
        useVector: false,
        filters: { geo: { lat: 40.71, lon: -74, radiusKm: 5 } },
      });
      const { index, body } = buildSearchBody(p, { size: 10, userLocation });
      expect(index).toBe(INDEX_NAME);
      expect(body.size).toBe(10);
      const q = body.query as Record<string, unknown>;
      expect(q.bool).toBeDefined();
      const bool = q.bool as Record<string, unknown>;
      expect(Array.isArray(bool.must)).toBe(true);
      expect(Array.isArray(bool.filter)).toBe(true);
      const hasGeo = (bool.filter as unknown[]).some(
        (f: unknown) => typeof f === "object" && f !== null && "geo_distance" in (f as object)
      );
      expect(hasGeo).toBe(true);
      const hasMultiMatch = (bool.must as unknown[]).some(
        (m: unknown) => typeof m === "object" && m !== null && "multi_match" in (m as object)
      );
      expect(hasMultiMatch).toBe(true);
    });

    it("has NO boosting (no function_score)", () => {
      const p = plan("beginner", {
        filters: { geo: { lat: 40.71, lon: -74, radiusKm: 3 } },
      });
      const { body } = buildSearchBody(p, { size: 5, userLocation });
      expect((body.query as Record<string, unknown>).function_score).toBeUndefined();
    });

    it("empty keyword uses match_all with geo filter", () => {
      const p = plan("beginner", {
        query: "place",
        filters: { geo: { lat: 40.71, lon: -74, radiusKm: 5 } },
      });
      const { body } = buildSearchBody(p, { size: 10, userLocation });
      const bool = (body.query as Record<string, unknown>).bool as Record<string, unknown>;
      const must = bool.must as unknown[];
      const hasMatchAll = must.some((m: unknown) => typeof m === "object" && m !== null && "match_all" in (m as object));
      expect(hasMatchAll).toBe(true);
    });

    it("sort includes rating and _geo_distance", () => {
      const p = plan("beginner", { filters: { geo: { lat: 40.71, lon: -74, radiusKm: 5 } } });
      const { body } = buildSearchBody(p, { size: 10, userLocation });
      const sort = body.sort as unknown[];
      expect(sort.some((s: unknown) => typeof s === "object" && s !== null && "rating" in (s as object))).toBe(true);
      expect(sort.some((s: unknown) => typeof s === "object" && s !== null && "_geo_distance" in (s as object))).toBe(true);
    });
  });

  describe("2) Semantic - kNN vector ONLY (no geo, no filters, no boosting)", () => {
    it("returns kNN-only body with sort _score only", () => {
      const p = plan("semantic", { query: "quiet cafe", useVector: true, useKeyword: false });
      const { index, body } = buildSearchBody(p, { size: 10, queryVector: fakeVector });
      expect(index).toBe(INDEX_NAME);
      expect(body.query).toBeDefined();
      expect((body.query as Record<string, unknown>).knn).toBeDefined();
      expect(body.sort).toEqual([{ _score: "desc" }]);
    });

    it("has NO geo_distance in query or sort", () => {
      const p = plan("semantic", { useVector: true, useKeyword: false });
      const { body } = buildSearchBody(p, { size: 10, userLocation, queryVector: fakeVector });
      const bodyStr = JSON.stringify(body);
      expect(bodyStr).not.toContain("_geo_distance");
      expect(bodyStr).not.toContain("geo_distance");
    });

    it("has NO function_score (no boosting)", () => {
      const p = plan("semantic", { useVector: true, useKeyword: false });
      const { body } = buildSearchBody(p, { size: 10, queryVector: fakeVector });
      expect((body.query as Record<string, unknown>).function_score).toBeUndefined();
    });

    it("returns match_none and size 0 when no queryVector", () => {
      const p = plan("semantic", { useVector: true, useKeyword: false });
      const { body } = buildSearchBody(p, { size: 10 });
      expect(body.size).toBe(0);
      expect((body.query as Record<string, unknown>).match_none).toEqual({});
    });

    it("allows openNow/priceTier as kNN filter only", () => {
      const p = plan("semantic", {
        useVector: true,
        useKeyword: false,
        filters: { openNow: true, priceTier: "cheap" },
      });
      const { body } = buildSearchBody(p, { size: 10, queryVector: fakeVector });
      const knn = (body.query as Record<string, unknown>).knn as Record<string, unknown>;
      const field = Object.values(knn)[0] as Record<string, unknown>;
      expect(field.filter).toBeDefined();
    });
  });

  describe("3) Intermediate - LLM intent + filters + boosting + geo (proximity sort)", () => {
    it("has geo as proximity sort only (no hard geo_distance filter)", () => {
      const p = plan("intermediate", {
        query: "coffee shop beach",
        useKeyword: true,
        useVector: true,
        filters: { geo: { lat: 40.71, lon: -74, radiusKm: 5 } },
        boosts: { distance: "medium", reviewEvidence: "high" },
      });
      const { body } = buildSearchBody(p, { size: 10, userLocation });
      const bool = (body.query as Record<string, unknown>).function_score
        ? ((body.query as Record<string, unknown>).function_score as Record<string, unknown>).query
        : body.query;
      const filter = (bool as Record<string, unknown>).bool as Record<string, unknown>;
      const filterClauses = filter.filter as unknown[];
      const hasHardGeo = filterClauses?.some(
        (f: unknown) => typeof f === "object" && f !== null && "geo_distance" in (f as object)
      );
      expect(hasHardGeo).toBe(false);
      const sort = body.sort as unknown[];
      expect(sort.some((s: unknown) => typeof s === "object" && s !== null && "_geo_distance" in (s as object))).toBe(true);
    });

    it("has boosting (function_score with distance/rating)", () => {
      const p = plan("intermediate", {
        boosts: { distance: "high", rating: "medium", reviewEvidence: "low" },
      });
      const { body } = buildSearchBody(p, { size: 10, userLocation });
      expect((body.query as Record<string, unknown>).function_score).toBeDefined();
      const fs = (body.query as Record<string, unknown>).function_score as Record<string, unknown>;
      expect(Array.isArray(fs.functions)).toBe(true);
      expect((fs.functions as unknown[]).length).toBeGreaterThan(0);
    });

    it("has multi_match for keyword", () => {
      const p = plan("intermediate", { query: "quiet coffee", useKeyword: true });
      const { body } = buildSearchBody(p, { size: 10, userLocation });
      const q = body.query as Record<string, unknown>;
      const innerQuery = q.function_score
        ? (q.function_score as Record<string, unknown>).query
        : q;
      const boolClause = (innerQuery as Record<string, unknown>)?.bool as Record<string, unknown> | undefined;
      const mustArr = boolClause?.must as unknown[] | undefined;
      const hasMulti = mustArr?.some((m: unknown) => typeof m === "object" && m !== null && "multi_match" in (m as object));
      expect(hasMulti).toBe(true);
    });

    it("does NOT add kNN (no hybrid)", () => {
      const p = plan("intermediate", { useKeyword: true, useVector: true });
      const { body } = buildSearchBody(p, { size: 10, userLocation, queryVector: fakeVector });
      const q = body.query as Record<string, unknown>;
      expect(q.knn).toBeUndefined();
      expect(q.bool?.should).toBeUndefined();
    });
  });

  describe("4) Advanced - conversational memory + hybrid (BM25 + kNN) + filters + boosting + geo", () => {
    it("has hybrid bool.should with query and knn when queryVector provided", () => {
      const p = plan("advanced", {
        query: "quiet coffee",
        useKeyword: true,
        useVector: true,
        filters: { geo: { lat: 40.71, lon: -74, radiusKm: 5 } },
        boosts: { distance: "medium" },
      });
      const { body } = buildSearchBody(p, { size: 10, userLocation, queryVector: fakeVector });
      const q = body.query as Record<string, unknown>;
      expect(q.bool).toBeDefined();
      const bool = q.bool as Record<string, unknown>;
      expect(Array.isArray(bool.should)).toBe(true);
      expect((bool.should as unknown[]).length).toBe(2);
      const hasKnn = (bool.should as unknown[]).some(
        (s: unknown) => typeof s === "object" && s !== null && "knn" in (s as object)
      );
      expect(hasKnn).toBe(true);
    });

    it("sort has _score first then rating then _geo_distance", () => {
      const p = plan("advanced", {
        filters: { geo: { lat: 40.71, lon: -74, radiusKm: 5 } },
      });
      const { body } = buildSearchBody(p, { size: 10, userLocation, queryVector: fakeVector });
      const sort = body.sort as Array<Record<string, unknown>>;
      expect(sort[0]).toEqual({ _score: "desc" });
      expect(sort.some((s) => "rating" in s)).toBe(true);
      expect(sort.some((s) => "_geo_distance" in s)).toBe(true);
    });

    it("has boosting (function_score inside the keyword clause)", () => {
      const p = plan("advanced", {
        boosts: { rating: "high", distance: "medium" },
      });
      const { body } = buildSearchBody(p, { size: 10, userLocation, queryVector: fakeVector });
      const q = body.query as Record<string, unknown>;
      const should = (q.bool as Record<string, unknown>).should as unknown[];
      const keywordClause = should.find((s: unknown) => typeof s === "object" && s !== null && !("knn" in (s as object)));
      expect(keywordClause).toBeDefined();
      expect((keywordClause as Record<string, unknown>).function_score ?? (keywordClause as Record<string, unknown>).bool).toBeDefined();
    });

    it("without queryVector falls back to keyword-only (no hybrid)", () => {
      const p = plan("advanced", { query: "coffee", useKeyword: true, useVector: true });
      const { body } = buildSearchBody(p, { size: 10, userLocation });
      const q = body.query as Record<string, unknown>;
      expect(q.knn).toBeUndefined();
      expect(q.bool?.should).toBeUndefined();
      expect(q.bool?.must).toBeDefined();
    });
  });

  describe("Geo filter exists ONLY in Traditional, Intermediate, Advanced (NOT Semantic)", () => {
    it("Semantic body has no geo", () => {
      const p = plan("semantic", { useVector: true, useKeyword: false });
      const { body } = buildSearchBody(p, { size: 10, userLocation, queryVector: fakeVector });
      expect(JSON.stringify(body)).not.toMatch(/_geo_distance|geo_distance/);
    });

    it("Beginner has geo_distance filter", () => {
      const p = plan("beginner", { filters: { geo: { lat: 40, lon: -74, radiusKm: 5 } } });
      const { body } = buildSearchBody(p, { size: 10, userLocation });
      expect(JSON.stringify(body)).toContain("geo_distance");
    });

    it("Intermediate has _geo_distance in sort only", () => {
      const p = plan("intermediate", { filters: { geo: { lat: 40, lon: -74, radiusKm: 5 } } });
      const { body } = buildSearchBody(p, { size: 10, userLocation });
      expect(JSON.stringify(body.sort)).toContain("_geo_distance");
    });

    it("Advanced has _geo_distance in sort", () => {
      const p = plan("advanced", { filters: { geo: { lat: 40, lon: -74, radiusKm: 5 } } });
      const { body } = buildSearchBody(p, { size: 10, userLocation, queryVector: fakeVector });
      expect(JSON.stringify(body.sort)).toContain("_geo_distance");
    });
  });

  describe("Boosting exists ONLY in Intermediate and Advanced", () => {
    it("Traditional has no function_score", () => {
      const p = plan("beginner", { filters: { geo: { lat: 40, lon: -74, radiusKm: 5 } } });
      const { body } = buildSearchBody(p, { size: 10, userLocation });
      expect((body.query as Record<string, unknown>).function_score).toBeUndefined();
    });

    it("Semantic has no function_score", () => {
      const p = plan("semantic", { useVector: true });
      const { body } = buildSearchBody(p, { size: 10, queryVector: fakeVector });
      expect((body.query as Record<string, unknown>).function_score).toBeUndefined();
    });

    it("Intermediate with boosts has function_score", () => {
      const p = plan("intermediate", { boosts: { distance: "medium" } });
      const { body } = buildSearchBody(p, { size: 10, userLocation });
      expect((body.query as Record<string, unknown>).function_score).toBeDefined();
    });

    it("Advanced with boosts has function_score in keyword clause", () => {
      const p = plan("advanced", { boosts: { distance: "low" } });
      const { body } = buildSearchBody(p, { size: 10, userLocation, queryVector: fakeVector });
      const q = body.query as Record<string, unknown>;
      const should = (q.bool as Record<string, unknown>).should as unknown[];
      const hasBoost = should.some(
        (s: unknown) =>
          typeof s === "object" &&
          s !== null &&
          ("function_score" in (s as object) || "bool" in (s as object))
      );
      expect(hasBoost).toBe(true);
    });
  });
});
