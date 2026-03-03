import type { ChatMessage, SearchResultHit } from "@nextgen-location-search/types";
import type { LLMClientLike } from "./generate-intent.js";

const CHAT_SYSTEM_PROMPT = `You are a helpful, friendly local search assistant. 
Given a user's conversation and a list of place results (with their customer reviews), write a concise conversational reply (2-4 sentences) that:
- Highlights the best match and why it fits the user's request — use review evidence when it directly supports the answer (e.g. "reviews mention great espresso")
- Mentions 1-2 standout details (rating, vibe, distance, price, or a specific review quote)
- Suggests a natural next step or follow-up ("You might also want to try...", "If you need something cheaper...", "Let me know if you'd like open-now places only")
- Uses a warm, opinionated tone — act like a knowledgeable local friend
Keep the reply short and conversational. Do not list all results.

When ordering results, PRIORITISE places whose reviews directly mention what the user asked for (e.g. if the user asked about espresso, rank places that mention espresso in reviews highest).

IMPORTANT: At the very end of your reply, on a new line, add exactly:
ORDER: <name1>, <name2>, <name3>
Use the exact place names from the results list, in the order you recommend (best match first, based on review evidence and user intent). Include every result you were given. This line is used to reorder the listing for the user.`;

const CONVERSATIONAL_SYSTEM_PROMPT = `You are a warm, friendly local search assistant called "Find Places". 
The user is just chatting — they are NOT asking you to find a place right now.
Reply naturally and helpfully in 1-3 sentences. Be friendly and personable.
You can mention that you help people find local coffee shops, cafes, restaurants, and more nearby.
If relevant, gently invite them to ask for a place recommendation.
Do NOT output any ORDER: line. Do NOT pretend to search for anything.`;

export interface ChatResponseWithOrder {
  text: string;
  recommendedOrder: string[];
}

function parseOrderLine(raw: string): string[] {
  const match = raw.match(/\nORDER:\s*(.+?)(?:\n|$)/is);
  if (!match) return [];
  return match[1]
    .replace(/\s+/g, " ")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function generateChatResponse(
  messages: ChatMessage[],
  results: SearchResultHit[],
  llm: LLMClientLike
): Promise<ChatResponseWithOrder> {
  const lastUserMessage = messages.filter((m) => m.role === "user").slice(-1)[0]?.content ?? "";

  const resultSummary = results
    .slice(0, 5)
    .map((r, i) => {
      const reviewText = r.reviews
        ?.slice(0, 2)
        .map((rv) => rv.text)
        .join(" | ");
      const meta = `${r.category}, ${r.priceTier ?? "?"}, rating ${r.rating}${r.distanceKm != null ? `, ${r.distanceKm.toFixed(1)} km away` : ""}${r.openNow !== undefined ? `, ${r.openNow ? "open now" : "currently closed"}` : ""}`;
      return `${i + 1}. ${r.name} (${meta})${reviewText ? `\n   Reviews: "${reviewText}"` : ""}`;
    })
    .join("\n");

  const conversationContext = messages
    .slice(-6)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");

  const userPrompt = `Conversation so far:\n${conversationContext}\n\nSearch results for "${lastUserMessage}":\n${resultSummary || "No results found."}\n\nWrite your reply now. Remember to end with ORDER: name1, name2, name3 (exact names, best first).`;

  try {
    const raw = await llm.chat([
      { role: "system", content: CHAT_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ]);
    const recommendedOrder = parseOrderLine(raw);
    const text = raw.replace(/\nORDER:[\s\S]*$/i, "").trim();
    return { text, recommendedOrder };
  } catch {
    if (results.length === 0) {
      return { text: "I couldn't find anything matching that. Try adjusting your search.", recommendedOrder: [] };
    }
    const top = results[0];
    const fallbackText = `I found ${results.length} place${results.length !== 1 ? "s" : ""}. ${top.name} looks like a great match — rated ${top.rating}${top.distanceKm != null ? ` and just ${top.distanceKm.toFixed(1)} km away` : ""}. Let me know if you'd like to refine the search!`;
    return { text: fallbackText, recommendedOrder: results.map((r) => r.name) };
  }
}

/**
 * Generate a purely conversational reply when the user is not asking to find a place.
 */
export async function generateConversationalResponse(
  messages: ChatMessage[],
  llm: LLMClientLike
): Promise<string> {
  const conversationContext = messages
    .slice(-6)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");

  const userPrompt = `Conversation:\n${conversationContext}\n\nReply naturally to the user's latest message.`;

  try {
    const raw = await llm.chat([
      { role: "system", content: CONVERSATIONAL_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ]);
    return raw.trim();
  } catch {
    return "I'm here to help you find great local spots! What kind of place are you looking for?";
  }
}
