import type { QueryPlan } from "@nextgen-location-search/types";

const INDEX_NAME = "places";
const BOOST_WEIGHTS = { low: 1.2, medium: 1.5, high: 2 } as const;

export interface SearchOptions {
  size?: number;
  userLocation?: { lat: number; lon: number };
  /** Query embedding for vector-only (e.g. semantic) search. When set with useVector and no useKeyword, builds kNN-only body. */
  queryVector?: number[];
}

/**
 * Build OpenSearch request body from QueryPlan.
 * Beginner mode: geo_distance is a hard filter (strict radius).
 * Intermediate / Advanced mode: geo is a proximity sort only — all places returned, closer ranked higher.
 * Semantic mode: geo is a proximity sort only (kNN path).
 */
const EMBEDDING_FIELD = "embedding";

export function buildSearchBody(
  plan: QueryPlan,
  options: SearchOptions = {}
): { index: string; body: Record<string, unknown> } {
  const { size = 10, userLocation, queryVector } = options;
  const must: Record<string, unknown>[] = [];
  const filter: Record<string, unknown>[] = [];

  // ----- Semantic mode: vector-only (kNN) search; never keyword or boosting -----
  if (plan.mode === "semantic") {
    if (!queryVector || queryVector.length === 0) {
      return {
        index: INDEX_NAME,
        body: { size: 0, query: { match_none: {} } },
      };
    }
    // Geo is NOT a hard filter — only openNow and priceTier are hard filters
    const knnFilter: Record<string, unknown>[] = [];
    if (plan.filters.openNow === true) {
      knnFilter.push({ term: { openNow: true } });
    }
    if (plan.filters.priceTier && plan.filters.priceTier !== "any") {
      knnFilter.push({ term: { priceTier: plan.filters.priceTier } });
    }
    const knnClause: Record<string, unknown> = {
      vector: queryVector,
      k: Math.max(size, 50),
    };
    if (knnFilter.length > 0) {
      knnClause.filter = { bool: { filter: knnFilter } };
    }
    // Semantic: vector-only — sort by kNN _score only, no geo
    return {
      index: INDEX_NAME,
      body: {
        size,
        query: { knn: { [EMBEDDING_FIELD]: knnClause } },
        sort: [{ _score: "desc" }],
      },
    };
  }

  // ----- Bool query -----
  // Traditional with empty keyword uses "place" — treat as match_all so geo filter returns all places in area
  const useKeywordMatch = plan.useKeyword && plan.query && !(plan.mode === "beginner" && plan.query === "place");
  if (useKeywordMatch) {
    must.push({
      multi_match: {
        query: plan.query,
        fields: ["name^2", "category", "reviews.text"],
        type: "best_fields",
        fuzziness: "AUTO",
      },
    });
  }

  // ----- Geo: hard filter for Beginner only; proximity sort-only for Intermediate/Advanced -----
  if (plan.mode === "beginner" && plan.filters.geo) {
    const { lat, lon, radiusKm } = plan.filters.geo;
    filter.push({
      geo_distance: {
        distance: `${radiusKm}km`,
        location: { lat, lon },
      },
    });
  }

  // ----- Advanced: all filters are ranking preferences only (no hard filter). Others: hard filters. -----
  const usePreferencesOnly = plan.mode === "advanced";
  const openNowPreference = plan.filters.openNow === true;
  const pricePreference =
    plan.filters.priceTier && plan.filters.priceTier !== "any" ? plan.filters.priceTier : null;

  if (openNowPreference && !usePreferencesOnly) {
    filter.push({ term: { openNow: true } });
  }
  if (pricePreference && !usePreferencesOnly) {
    filter.push({ term: { priceTier: pricePreference } });
  }

  const bool: Record<string, unknown> = { must, filter };
  if (must.length === 0) {
    bool.must = [{ match_all: {} }];
  }

  let query: Record<string, unknown> = { bool };

  // ----- function_score: rating/distance boosts + in Advanced, openNow/priceTier as preference boosts -----
  const hasRatingOrDistanceBoosts = Object.keys(plan.boosts).length > 0;
  const hasOpenNowPreferenceBoost = usePreferencesOnly && openNowPreference;
  const hasPricePreferenceBoost = usePreferencesOnly && pricePreference != null;
  const hasBoosts =
    hasRatingOrDistanceBoosts || hasOpenNowPreferenceBoost || hasPricePreferenceBoost;

  if (hasBoosts) {
    const fieldFactor: Array<Record<string, unknown>> = [];
    if (plan.boosts.rating) {
      const ratingBoost = plan.boosts.rating as keyof typeof BOOST_WEIGHTS;
      fieldFactor.push({
        field_value_factor: {
          field: "rating",
          factor: BOOST_WEIGHTS[ratingBoost],
          modifier: "sqrt",
          missing: 1,
        },
      });
    }
    if (plan.boosts.distance && userLocation) {
      fieldFactor.push({
        gauss: {
          location: {
            origin: { lat: userLocation.lat, lon: userLocation.lon },
            scale: "2km",
            decay: 0.5,
          },
        },
      });
    }
    if (hasOpenNowPreferenceBoost) {
      fieldFactor.push({
        filter: { term: { openNow: true } },
        weight: 1.5,
      });
    }
    if (hasPricePreferenceBoost && pricePreference) {
      fieldFactor.push({
        filter: { term: { priceTier: pricePreference } },
        weight: 1.5,
      });
    }
    if (fieldFactor.length > 0) {
      query = {
        function_score: {
          query,
          functions: fieldFactor,
          score_mode: "multiply",
          boost_mode: "multiply",
        },
      };
    }
  }

  // ----- Sort -----
  const sort: Array<Record<string, string | Record<string, unknown>>> = [];
  const isAdvancedHybrid = plan.mode === "advanced" && queryVector && queryVector.length > 0;
  // Advanced hybrid: rank by relevance first (keyword + semantic score), then proximity as tiebreaker
  if (isAdvancedHybrid) {
    sort.push({ _score: "desc" });
  }
  for (const s of plan.sort) {
    if (s.field === "distance") {
      // Added explicitly below
    } else if (s.field !== "_score") {
      sort.push({ [s.field]: s.order });
    }
  }
  // Beginner: geo_distance is a hard filter, proximity sort is secondary
  // Intermediate/Advanced: no hard geo filter, so proximity sort is the only way to rank by location
  if (userLocation) {
    sort.push({
      _geo_distance: {
        location: { lat: userLocation.lat, lon: userLocation.lon },
        order: "asc",
        unit: "km",
      },
    });
  }

  // ----- Advanced: hybrid (BM25 + kNN) when query vector is available -----
  // BM25 naturally dominates: kNN scores are 0–1; BM25 for a strong name/keyword match is typically 5–15+.
  // k:5 limits semantic to the top 5 most similar docs so it doesn't flood weak semantic matches into results.
  // Sort by _score first (set above) means relevance drives order, proximity is just a tiebreaker.
  let finalQuery: Record<string, unknown> = query;
  if (plan.mode === "advanced" && queryVector && queryVector.length > 0) {
    const knnClause: Record<string, unknown> = {
      [EMBEDDING_FIELD]: {
        vector: queryVector,
        k: 5,
      },
    };
    finalQuery = {
      bool: {
        should: [query, { knn: knnClause }],
        minimum_should_match: 1,
      },
    };
  }

  const body: Record<string, unknown> = {
    size,
    query: finalQuery,
    ...(sort.length > 0 && { sort }),
  };

  return { index: INDEX_NAME, body };
}

export { INDEX_NAME };
