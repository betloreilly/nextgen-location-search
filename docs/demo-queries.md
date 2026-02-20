# Demo Queries: Traditional → Semantic → Intermediate → Advanced

Use these three demo flows to show how each search mode improves on the previous one. Run **each query in the corresponding mode** to see the difference.

---

## Demo 1: "Quiet coffee shop open now near the beach"

**Goal:** Show that Traditional is limited (keyword + geo only), Semantic adds meaning but no filters, Intermediate adds intent and boosting, and Advanced uses memory + hybrid.

| Mode | What happens | Limitation / Win |
|------|----------------|------------------|
| **Traditional** | User must type a keyword (e.g. "coffee") and set filters manually: category, "Open now", "Within 2 km". Query is BM25 on that keyword + hard geo filter. | **Limited:** No notion of "quiet" or "beach" unless user types them; no understanding of "open now" from natural language. |
| **Semantic** | User types the full sentence. It's embedded; kNN finds places similar in meaning. No geo filter, no "open now" filter. | **Not enough:** Results can be far away or closed; "open now" and "near the beach" are not applied as filters. |
| **Intermediate** | LLM extracts: query "coffee shop beach", filters openNow + geo 2 km. BM25 + optional boosting; geo as proximity sort. | **Improves:** Open now and distance are real filters; "beach" and "coffee" are in the query. |
| **Advanced** | Same as Intermediate, plus: full conversation memory, hybrid (BM25 + kNN), and conversational reply with reordered results. | **Wins:** Refining in chat ("actually within 1 km" or "the quieter one") is remembered; hybrid balances keyword ("beach") and meaning ("quiet"); one coherent chat flow. |

Try this exact query: *"I want a quiet coffee shop that's open now near the beach, within 2 km."*

---

## Demo 2: "Which one had good wifi and outdoor seating?"

**Goal:** Show that this only makes sense with **memory** (Advanced). Traditional and Semantic are stateless; Intermediate has no memory across turns.

| Mode | What happens | Limitation / Win |
|------|----------------|------------------|
| **Traditional** | User types a keyword. No conversation. "Which one" has no referent. | **Limited:** No prior context; "which one" is meaningless. |
| **Semantic** | Query is embedded; kNN finds "wifi"/"outdoor" similarity. No memory of previous results. | **Not enough:** No link to "the one we were just talking about". |
| **Intermediate** | LLM sees only the latest message (or single turn). No multi-turn memory. | **Improves:** Can still parse "wifi" and "outdoor" into intent, but doesn't know "which one" from before. |
| **Advanced** | Full conversation is in context. LLM knows the user is refining from the last results; memory holds entity (e.g. coffee) and prior filters. | **Wins:** "Which one had good wifi and outdoor seating?" is interpreted in context; hybrid can boost by review evidence and reorder by AI recommendation. |

In Advanced mode, first say *"Find me a coffee shop near the water."* Then ask *"Which one had good wifi and outdoor seating?"*

---

## Demo 3: "Somewhere cheap and quiet to work, with good reviews"

**Goal:** Show keyword vs meaning, and that filters + boosting need LLM (Intermediate/Advanced).

| Mode | What happens | Limitation / Win |
|------|----------------|------------------|
| **Traditional** | User must pick "Budget-friendly" (or type "cheap"), type "quiet" or "coffee", set radius. Pure BM25 + geo. | **Limited:** "Good reviews" and "quiet to work" are not structurally used (no reviewEvidence boost, no semantic "quiet/work"). |
| **Semantic** | Sentence is embedded; kNN finds semantically similar places. No price filter, no "quiet" or "good reviews" as structured signals. | **Not enough:** May return expensive or loud places; no price tier or reviewEvidence boosting. |
| **Intermediate** | LLM extracts: query "quiet coffee" (or similar), priceTier "cheap", reviewEvidence boost, maybe openNow. BM25 + boosting + geo sort. | **Improves:** Cheap and "good reviews" become real filters/boosts; "quiet to work" gets into query and review preferences. |
| **Advanced** | Same as Intermediate plus: memory (e.g. "quiet" and "work" carried across turns), hybrid BM25 + kNN, and conversational answer that picks the best match. | **Wins:** User can say "and open now" in a follow-up; memory + hybrid + AI reordering give one clear "best" suggestion. |

Try this exact query: *"I need somewhere cheap and quiet to work, with good reviews."*

---

## Summary

**Traditional** is BM25 plus geo only; the user does all the filter and keyword work. It's a good baseline. **Semantic** adds meaning (kNN) but no geo, no filters, and no memory, so it shows the value of vectors without being enough on its own. **Intermediate** uses LLM intent to get structured filters, boosting, and geo in a single turn; it's the best "one-shot" upgrade. **Advanced** adds full conversational memory, hybrid (BM25 + kNN), filters, boosting, geo, and an AI reply, so it's best for multi-turn use, "which one" questions, and natural refinement.
