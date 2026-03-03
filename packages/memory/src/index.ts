import type { ChatMessage, MemoryResult, UserContext } from "@nextgen-location-search/types";

/**
 * In-memory conversation store: extracts entity, attributes, and filters
 * from multi-turn conversation and merges cumulative constraints.
 */
export function extractMemory(
  messages: ChatMessage[],
  userContext: UserContext
): MemoryResult {
  const userText = messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join(" ")
    .toLowerCase();

  const entity = extractEntity(userText);
  const attributes = extractAttributes(userText);
  const filters = extractFilters(userText, userContext);
  const reviewPreferences = extractReviewPreferences(userText);
  const rawQuery = extractRawQuery(userText);

  return {
    entity: entity || "place",
    attributes,
    filters,
    reviewPreferences: reviewPreferences.length ? reviewPreferences : undefined,
    rawQuery,
  };
}

/**
 * Strip structural/filter words and return the meaningful remainder.
 * This preserves free-text keywords the user typed (e.g. "harbour", "wifi")
 * that aren't captured by the entity/attribute extractors.
 */
function extractRawQuery(text: string): string {
  const cleaned = text
    .replace(/\bnear\s+me\b/g, "")
    .replace(/\bnearby\b/g, "")
    .replace(/\baround\s+here\b/g, "")
    .replace(/\bwithin\s+\d+\s*km\b/g, "")
    .replace(/\b\d+\s*km\b/g, "")
    .replace(/\bopen\s*now\b/g, "")
    .replace(/\bcurrently\s*open\b/g, "")
    .replace(/\bopen\s*today\b/g, "")
    .replace(/\bcheap\b|\binexpensive\b|\baffordable\b|\bbudget\b/g, "")
    .replace(/\bmoderate\b|\bmid-range\b|\breasonable\b/g, "")
    .replace(/\bexpensive\b|\bupscale\b|\bfine\s*dining\b/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned || text.trim();
}

const ENTITY_PATTERNS: Array<{ pattern: RegExp; entity: string }> = [
  { pattern: /\b(coffee\s*shop|cafe|coffeehouse)\b/, entity: "coffee shop" },
  // Coffee drink terms imply a coffee shop even if "cafe" is not mentioned
  { pattern: /\b(espresso|latte|cappuccino|pour.?over|flat\s*white|cold\s*brew|matcha|americano|macchiato)\b/, entity: "coffee shop" },
  { pattern: /\b(restaurant|dining|eat)\b/, entity: "restaurant" },
  { pattern: /\b(hotel|stay|accommodation)\b/, entity: "hotel" },
  { pattern: /\b(bar|pub)\b/, entity: "bar" },
  { pattern: /\b(park)\b/, entity: "park" },
  { pattern: /\b(gym|fitness)\b/, entity: "gym" },
  { pattern: /\b(place|spot|venue|location)\b/, entity: "place" },
];

function extractEntity(text: string): string | null {
  for (const { pattern, entity } of ENTITY_PATTERNS) {
    if (pattern.test(text)) return entity;
  }
  return null;
}

function extractAttributes(text: string): string[] {
  const attrs: string[] = [];
  if (/\b(quiet|peaceful|calm)\b/.test(text)) attrs.push("quiet");
  if (/\b(busy|lively|vibrant)\b/.test(text)) attrs.push("lively");
  if (/\b(wifi|wifi|internet)\b/.test(text)) attrs.push("wifi");
  if (/\b(outdoor|terrace|patio)\b/.test(text)) attrs.push("outdoor");
  if (/\b(kid|family|children)\b/.test(text)) attrs.push("family-friendly");
  if (/\b(work|laptop|remote)\b/.test(text)) attrs.push("good for work");
  return attrs;
}

function extractFilters(text: string, userContext: UserContext): MemoryResult["filters"] {
  const filters: MemoryResult["filters"] = {};

  if (/\b(near me|nearby|close|around here)\b/.test(text) || /\b(\d+)\s*(km|mi|miles?)\b/.test(text)) {
    filters.location = { lat: userContext.lat, lon: userContext.lon };
    const radiusMatch = text.match(/(\d+)\s*(km|kilometers?)/i);
    filters.geoRadiusKm = radiusMatch ? parseInt(radiusMatch[1], 10) : 5;
  }

  if (/\b(open\s*now|currently\s*open|open\s*today)\b/.test(text)) {
    filters.openNow = true;
  }

  if (/\b(cheap|inexpensive|budget|not\s*expensive|affordable)\b/.test(text)) {
    filters.priceTier = "cheap";
  } else if (/\b(moderate|mid-range|reasonable)\b/.test(text)) {
    filters.priceTier = "moderate";
  } else if (/\b(expensive|upscale|fine\s*dining)\b/.test(text)) {
    filters.priceTier = "expensive";
  }

  return filters;
}

function extractReviewPreferences(text: string): string[] {
  const prefs: string[] = [];
  if (/\b(good\s*reviews?|highly\s*rated|well\s*reviewed|great\s*reviews?)\b/.test(text)) {
    prefs.push("good reviews");
  }
  if (/\b(quiet)\b/.test(text)) prefs.push("quiet");
  if (/\b(friendly\s*staff|nice\s*staff)\b/.test(text)) prefs.push("friendly staff");
  // Specific coffee drink terms → search in reviews
  if (/\b(espresso)\b/.test(text)) prefs.push("espresso");
  if (/\b(pour.?over)\b/.test(text)) prefs.push("pour-over");
  if (/\b(latte)\b/.test(text)) prefs.push("latte");
  if (/\b(cappuccino)\b/.test(text)) prefs.push("cappuccino");
  if (/\b(flat\s*white)\b/.test(text)) prefs.push("flat white");
  if (/\b(cold\s*brew)\b/.test(text)) prefs.push("cold brew");
  return prefs;
}

export type { MemoryResult };
