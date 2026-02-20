import type {
  QueryPlan,
  SearchResult,
  SearchResultHit,
  ReviewSnippet,
} from "@nextgen-location-search/types";
import { buildSearchBody } from "./build-query.js";

export interface OpenSearchClientLike {
  search<T = unknown>(params: {
    index: string;
    body: Record<string, unknown>;
  }): Promise<{ body: { hits: { hits: Array<{ _source: T; _id: string; _score?: number; sort?: unknown[] }>; total: { value: number }; max_score?: number } } }>;
}

export interface ExecuteSearchOptions {
  size?: number;
  userLocation?: { lat: number; lon: number };
  /** Query embedding for vector-only (semantic) search. */
  queryVector?: number[];
}

/**
 * Execute search against OpenSearch using the given client and plan.
 * If vector search is requested but no embedding provided, falls back to keyword-only.
 */
export async function executeSearch(
  client: OpenSearchClientLike,
  plan: QueryPlan,
  options: ExecuteSearchOptions = {}
): Promise<SearchResult> {
  const geo = plan.filters.geo;
  const userLocation =
    options.userLocation ?? (geo ? { lat: geo.lat, lon: geo.lon } : undefined);

  const { index, body } = buildSearchBody(plan, {
    size: options.size ?? 10,
    userLocation,
    queryVector: options.queryVector,
  });

  let response: { body: { hits: { hits: Array<{
    _source: Record<string, unknown>;
    _id: string;
    _score?: number;
    sort?: unknown[];
  }>; total: { value: number }; max_score?: number } } };
  try {
    response = await client.search({ index, body }) as typeof response;
  } catch (err) {
    console.error("OpenSearch query that failed:\n", JSON.stringify(body, null, 2));
    throw new Error(`OpenSearch search failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const hits = response.body.hits.hits;
  const total = typeof response.body.hits.total === "object"
    ? response.body.hits.total.value
    : (response.body.hits.total as number);
  const maxScore = response.body.hits.max_score;

  const searchHits: SearchResultHit[] = hits.map((hit) => {
    const s = hit._source as Record<string, unknown>;
    const loc = s.location as { lat: number; lon: number } | undefined;
    let distanceKm: number | undefined;
    if (userLocation && loc) {
      distanceKm = haversineKm(userLocation.lat, userLocation.lon, loc.lat, loc.lon);
    }
    const reviews = (s.reviews as Array<{ text?: string; embedding?: number[] }> | undefined)?.map(
      (r) => ({ text: r.text ?? "" } as ReviewSnippet)
    );
    return {
      id: hit._id,
      name: (s.name as string) ?? "",
      category: (s.category as string) ?? "",
      location: loc ?? { lat: 0, lon: 0 },
      priceTier: (s.priceTier as string) ?? "moderate",
      rating: (s.rating as number) ?? 0,
      distanceKm,
      openNow: s.openNow as boolean | undefined,
      reviews: reviews?.slice(0, 5),
      _score: hit._score,
      imageUrl: s.imageUrl as string | undefined,
    };
  });

  return {
    hits: searchHits,
    total,
    queryPlan: plan,
    maxScore: maxScore ?? undefined,
  };
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
