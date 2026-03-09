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
 * Beginner / Intermediate / Advanced mode: geo_distance is always a hard filter (strict radius).
 *   Advanced uses userLocation directly with plan radius (or default 5 km) so results are always local.
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
  const keywordFields = ["name^2", "category", "reviews.text"] as const;
  if (useKeywordMatch) {
    if (plan.mode === "advanced") {
      // Advanced: bool with must (OR + fuzziness) + should (phrase with slop for phrase boost)
      must.push({
        bool: {
          must: [
            {
              multi_match: {
                query: plan.query,
                fields: [...keywordFields],
                operator: "OR",
                fuzziness: "AUTO",
              },
            },
          ],
          should: [
            {
              multi_match: {
                query: plan.query,
                fields: [...keywordFields],
                type: "phrase",
                slop: 2,
                boost: 3,
              },
            },
          ],
        },
      });
    } else {
      must.push({
        multi_match: {
          query: plan.query,
          fields: [...keywordFields],
          type: "best_fields",
          fuzziness: "AUTO",
        },
      });
    }
  }

  // ----- Geo: always a hard filter for Beginner, Intermediate, and Advanced -----
  // Advanced uses userLocation directly so it always filters to nearby results even when the user
  // didn't explicitly say "near me". Radius comes from the plan (LLM or memory) or defaults to 5 km.
  if (plan.mode === "advanced" && userLocation) {
    const radiusKm = plan.filters.geo?.radiusKm ?? 5;
    filter.push({
      geo_distance: {
        distance: `${radiusKm}km`,
        location: { lat: userLocation.lat, lon: userLocation.lon },
      },
    });
  } else if (plan.filters.geo && (plan.mode === "beginner" || plan.mode === "intermediate")) {
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
  // When user asks "which one is cheaper" we set priceTier in planner; apply as hard filter so only that tier is returned.
  if (pricePreference) {
    filter.push({ term: { priceTier: pricePreference } });
  }

  const bool: Record<string, unknown> = { must, filter };

  // ----- Review evidence: nested queries against reviews.text -----
  // Advanced mode uses TWO layers so review content drives ranking even when the LLM misses a term:
  //   Layer 1 — explicit mustHaveFromReviews phrases (set by LLM) — highest boost
  //   Layer 2 — auto-extracted meaningful terms from plan.query (advanced only) — secondary boost
  const reviewEvidenceWeight =
    plan.boosts.reviewEvidence != null ? BOOST_WEIGHTS[plan.boosts.reviewEvidence] : 2;
  const reviewBoostMultiplier = plan.mode === "advanced" ? 4 : 2.5;
  const reviewPhraseBoost = reviewEvidenceWeight * reviewBoostMultiplier;

  const reviewShouldClauses: Record<string, unknown>[] = [];

  // Layer 1: explicit phrases the LLM identified
  for (const phrase of (plan.mustHaveFromReviews ?? []).slice(0, 5)) {
    const trimmed = phrase.trim();
    if (!trimmed) continue;
    reviewShouldClauses.push({
      nested: {
        path: "reviews",
        query: { match: { "reviews.text": { query: trimmed } } },
        score_mode: "max",
        boost: reviewPhraseBoost,
      },
    });
  }

  // Layer 2 (advanced only): auto-search each meaningful query term in reviews —
  // ensures review relevance even when mustHaveFromReviews is sparse.
  if (plan.mode === "advanced" && plan.query) {
    const genericTerms = new Set([
      "shop", "place", "cafe", "cafes", "bar", "restaurant", "hotel", "coffee",
      "near", "good", "best", "great", "nice",
    ]);
    const alreadyCovered = new Set(
      (plan.mustHaveFromReviews ?? []).map((t) => t.toLowerCase().trim())
    );
    const autoTerms = plan.query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 3 && !genericTerms.has(t) && !alreadyCovered.has(t));

    for (const term of autoTerms.slice(0, 4)) {
      reviewShouldClauses.push({
        nested: {
          path: "reviews",
          query: { match: { "reviews.text": { query: term } } },
          score_mode: "max",
          boost: reviewPhraseBoost * 0.6,
        },
      });
    }
  }

  if (reviewShouldClauses.length > 0) {
    bool.should = [
      ...(Array.isArray(bool.should) ? bool.should : []),
      ...reviewShouldClauses,
    ];
  }

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
    // Advanced: the hard geo filter already handles proximity — only apply gauss decay when
    // the user explicitly asked for "closest/nearest" (boosts.distance === "high").
    // Non-advanced: apply whenever distance boost is set (existing behaviour).
    const applyDistanceDecay =
      userLocation &&
      plan.boosts.distance &&
      (plan.mode !== "advanced" || plan.boosts.distance === "high");
    if (applyDistanceDecay) {
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
  // Advanced hybrid: relevance (_score) is always the primary sort.
  if (isAdvancedHybrid) {
    sort.push({ _score: "desc" });
  }
  for (const s of plan.sort) {
    if (s.field === "distance") {
      // Handled explicitly below
    } else if (s.field !== "_score") {
      sort.push({ [s.field]: s.order });
    }
  }
  // Proximity sort:
  // - Non-advanced modes: always append geo_distance as a secondary tiebreaker.
  // - Advanced mode: geo is already a hard filter (radius); only add proximity sort when the
  //   plan explicitly includes a "distance" sort field (user asked "which is closest").
  const wantsProximitySort =
    plan.mode !== "advanced" || plan.sort.some((s) => s.field === "distance");
  if (userLocation && wantsProximitySort) {
    sort.push({
      _geo_distance: {
        location: { lat: userLocation.lat, lon: userLocation.lon },
        order: "asc",
        unit: "km",
      },
    });
  }

  // ----- Advanced: hybrid (BM25 + kNN) when query vector is available -----
  // BM25 is REQUIRED (must): every result must keyword-match the query across name, category, or reviews.
  // kNN is OPTIONAL (should): boosts the score of semantically similar docs but doesn't gate results.
  // This ensures "cafe best coffee" always runs BM25 — no result can appear without a keyword match.
  let finalQuery: Record<string, unknown> = query;
  if (plan.mode === "advanced" && queryVector && queryVector.length > 0) {
    const knnClause: Record<string, unknown> = {
      [EMBEDDING_FIELD]: {
        vector: queryVector,
        k: Math.max(size, 15),
      },
    };
    finalQuery = {
      bool: {
        must: [query],
        should: [{ knn: knnClause }],
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
