// ============ Chat & Context ============

export type Role = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  timestamp: string; // ISO 8601
}

export interface UserContext {
  lat: number;
  lon: number;
  timestamp: string; // ISO 8601
}

// ============ Search Modes ============

/** beginner = BM25+geo filter, semantic = kNN, intermediate = LLM intent+boosting, advanced = conversational memory+chatbot */
export type SearchMode = "beginner" | "semantic" | "intermediate" | "advanced";

// ============ LLM Intent (Advanced Mode) ============

export type BoostLevel = "low" | "medium" | "high";

export interface IntentPlanFilters {
  geoRadiusKm?: number;
  openNow?: boolean;
  priceTier?: "cheap" | "moderate" | "expensive" | "any";
}

export interface IntentPlanBoosts {
  distance: BoostLevel;
  /** Only set when user explicitly asks to prioritize/sort by rating */
  rating?: BoostLevel;
  reviewEvidence: BoostLevel;
}

export interface IntentPlan {
  query: string;
  filters: IntentPlanFilters;
  mustHaveFromReviews: string[];
  niceToHaveFromReviews: string[];
  boosts: IntentPlanBoosts;
  sort: string[];
  warningsToCheck: string[];
  clarifyingQuestion?: string | null;
  /** false when the user is just chatting and not asking to find a place */
  isSearchQuery?: boolean;
}

// ============ Memory (extracted from conversation) ============

export interface MemoryFilters {
  openNow?: boolean;
  priceTier?: "cheap" | "moderate" | "expensive" | "any";
  location?: { lat: number; lon: number };
  geoRadiusKm?: number;
}

export interface MemoryResult {
  entity: string; // e.g. "coffee shop"
  attributes: string[]; // e.g. ["quiet"]
  filters: MemoryFilters;
  reviewPreferences?: string[]; // e.g. "good reviews"
  /** Raw user keywords after stripping structural filter words — used for BM25 query text */
  rawQuery?: string;
}

// ============ Query Plan (planner output) ============

export type AllowedSortField = "distance" | "rating" | "reviewScore" | "priceTier" | "_score";
export type AllowedBoostField = "distance" | "rating" | "reviewEvidence";

export interface QueryPlanBoosts {
  distance?: BoostLevel;
  rating?: BoostLevel;
  reviewEvidence?: BoostLevel;
}

export interface QueryPlan {
  mode: SearchMode;
  query: string;
  filters: {
    geo?: { lat: number; lon: number; radiusKm: number };
    openNow?: boolean;
    priceTier?: string;
  };
  mustHaveFromReviews: string[];
  niceToHaveFromReviews: string[];
  boosts: QueryPlanBoosts;
  sort: Array<{ field: AllowedSortField; order: "asc" | "desc" }>;
  warningsToCheck: string[];
  useVector: boolean;
  useKeyword: boolean;
}

// ============ Search Results ============

export interface ReviewSnippet {
  text: string;
  score?: number;
  supportsClaim?: string;
}

export interface SearchResultHit {
  id: string;
  name: string;
  category: string;
  location: { lat: number; lon: number };
  priceTier: string;
  rating: number;
  distanceKm?: number;
  openNow?: boolean;
  reviews?: ReviewSnippet[];
  _score?: number;
  imageUrl?: string;
}

export interface SearchResult {
  hits: SearchResultHit[];
  total: number;
  queryPlan: QueryPlan;
  maxScore?: number;
}

// ============ Explanation ============

export interface ExplanationBlock {
  whyMatched: string;
  filtersApplied: string[];
  reviewSnippetsSupport: Array<{ claim: string; snippets: string[]; count: number }>;
  warnings: string[];
  topResultSummary?: string;
}

// ============ API Payloads ============

export interface ChatRequestPayload {
  mode: SearchMode;
  messages: ChatMessage[];
  userContext: UserContext;
  /** When set (e.g. from left-panel KEYWORD), used for keyword/similarity search so OpenSearch matches the UI filters. */
  currentKeyword?: string;
}

export interface ChatResponsePayload {
  results: SearchResultHit[];
  explanation: ExplanationBlock;
  queryPlan: QueryPlan;
  warnings: string[];
  clarifyingQuestion?: string | null;
  /** Natural language chatbot reply (Advanced mode only) */
  chatResponse?: string;
  /** Request sent to OpenSearch (index + body) for debug display */
  opensearchRequest?: { index: string; body: Record<string, unknown> };
  /** True when the user sent a conversational (non-search) message — no search was run */
  isConversational?: boolean;
}
