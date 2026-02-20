import type {
  ExplanationBlock,
  QueryPlan,
  SearchResultHit,
} from "@nextgen-location-search/types";

/**
 * Generate explanation block from top results and query plan.
 * Includes: why it matched, filters applied, review snippets supporting claims, warnings.
 */
export function buildExplanation(
  topHits: SearchResultHit[],
  plan: QueryPlan
): ExplanationBlock {
  const filtersApplied: string[] = [];
  if (plan.filters.geo) {
    if (plan.mode === "beginner") {
      filtersApplied.push(`Within ${plan.filters.geo.radiusKm} km of your location`);
    } else if (plan.mode === "advanced") {
      filtersApplied.push("Sorted by relevance, then proximity to your location");
    } else if (plan.mode !== "semantic") {
      filtersApplied.push("Sorted by proximity to your location");
    }
  }
  if (plan.filters.openNow === true) {
    filtersApplied.push(
      plan.mode === "advanced" ? "Open now (preference ranking)" : "Open now"
    );
  }
  if (plan.filters.priceTier && plan.filters.priceTier !== "any") {
    filtersApplied.push(
      plan.mode === "advanced"
        ? `Price: ${plan.filters.priceTier} (preference ranking)`
        : `Price: ${plan.filters.priceTier}`
    );
  }
  if (filtersApplied.length === 0) {
    filtersApplied.push("No hard filters");
  }

  const reviewSnippetsSupport: ExplanationBlock["reviewSnippetsSupport"] = [];
  const claims = [
    ...plan.mustHaveFromReviews,
    ...plan.niceToHaveFromReviews,
  ].slice(0, 5);
  for (const claim of claims) {
    const snippets: string[] = [];
    let count = 0;
    for (const hit of topHits) {
      for (const r of hit.reviews ?? []) {
        const text = (r as { text?: string }).text ?? "";
        if (text.toLowerCase().includes(claim.toLowerCase())) {
          snippets.push(text.slice(0, 120) + (text.length > 120 ? "…" : ""));
          count++;
        }
      }
    }
    if (count > 0) {
      reviewSnippetsSupport.push({ claim, snippets: snippets.slice(0, 3), count });
    }
  }

  const warnings: string[] = [];
  for (const warn of plan.warningsToCheck) {
    let found = false;
    for (const hit of topHits) {
      const reviewText = (hit.reviews ?? []).map((r) => (r as { text?: string }).text ?? "").join(" ");
      if (reviewText.toLowerCase().includes(warn.toLowerCase())) {
        found = true;
        break;
      }
    }
    if (found) {
      warnings.push(`Warning: some reviews mention "${warn}"`);
    }
  }

  const top = topHits[0];
  let topResultSummary: string | undefined;
  if (top) {
    const parts: string[] = [];
    if (top.distanceKm !== undefined) {
      parts.push(`Top result is ${top.distanceKm.toFixed(1)} km away.`);
    }
    const reviewCount = reviewSnippetsSupport.reduce(
      (acc: number, r: { count: number }) => acc + r.count,
      0
    );
    if (reviewCount > 0) {
      parts.push(`${reviewCount} review snippet(s) support your criteria.`);
    }
    if (top.rating) {
      parts.push(`Rating ${top.rating} ${plan.boosts.rating ? "boosted ranking." : ""}`);
    }
    topResultSummary = parts.join(" ");
  }

  const boostParts: string[] = [];
  if (plan.boosts.rating) boostParts.push(`rating (×${plan.boosts.rating === "high" ? 2 : plan.boosts.rating === "medium" ? 1.5 : 1.2})`);
  if (plan.boosts.distance) boostParts.push("proximity decay");
  if (plan.boosts.reviewEvidence) boostParts.push("review evidence");

  const whyMatched =
    plan.mode === "beginner"
      ? `BM25 full-text search for "${plan.query}" with geo and field filters applied by OpenSearch.`
      : plan.mode === "semantic"
        ? `Vector similarity search — your query was embedded (1536 dims) and compared against stored place embeddings using OpenSearch kNN. No keywords used.`
        : plan.mode === "advanced"
          ? `Hybrid search (BM25 + kNN similarity): LLM intent drives both keyword match and vector similarity so places with matching vibe/reviews (e.g. from conversation) rank higher.${boostParts.length ? ` Boosting: ${boostParts.join(", ")}.` : ""}`
          : boostParts.length
            ? `LLM extracted intent and built a structured OpenSearch query with filters and boosting: ${boostParts.join(", ")}.`
            : `LLM-planned OpenSearch query for "${plan.query}" with extracted filters.`;

  return {
    whyMatched,
    filtersApplied,
    reviewSnippetsSupport,
    warnings,
    topResultSummary,
  };
}
