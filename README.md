# Next-Gen Location Search

A full-stack demo that shows how **smarter search** can turn "find me a coffee shop" into a short, natural conversation, and why that matters for real businesses. Use **watsonx.data OpenSearch** as your search engine.

<p align="center">
  <img src="data/coffeeshops.gif" alt="Demo of conversational place search" width="1200"/>
</p>

---

## What This Project Does

This is a **place-finder app** (coffee shops, cafes, and the like) with one important twist: you can talk to it in plain language and refine your search over several messages.

You can say things like *"Somewhere cheap and quiet to work, with good reviews"* or *"Which one has more students?"* The app understands intent, applies filters (open now, distance, price), and mixes **keyword search** with **semantic (meaning) search** so results match what you meant, not just the words you typed. It runs in four modes—**Traditional**, **Semantic**, **Intermediate**, and **Advanced**—so you can see step by step how adding semantics, intent, and conversation improves results.

Think of it as a small-scale version of what a travel app, a local discovery product, or an internal "find a place" tool could do when powered by modern search and a bit of AI.

For a deeper look at how the app works (request flow, what runs in each mode, and package roles), see **[How the application works](docs/architecture.md)** (includes architecture diagrams).

---

## Why This Matters (Business Value)

Customers don't type perfect keywords. They say *"quiet place to work"*, *"where do students go?"*, or *"the one with outdoor seating."* Classic search often fails these queries because it only matches exact words.

When search understands **meaning** and **context**, people find what they want in fewer steps, engagement goes up because conversation-style refinement feels natural, and your data (reviews, descriptions like "good for studying") actually influences ranking instead of being ignored.

This repo shows how to build that with **OpenSearch** (keyword + vector + geo) and optional **LLM** intent planning, in a way you can run locally and adapt to your own use case.

---

## How Search Gets Better: Traditional to Advanced

Each mode adds one more layer. You can try the same question in each to see the difference.

| Mode | What it does | Best for |
|------|----------------|----------|
| **Traditional** | Keyword (e.g. "coffee") plus filters you set yourself (category, open now, distance). Simple and predictable. | When you know exactly what to type and which filters to use. |
| **Semantic** | Your full sentence is turned into a vector; results match **meaning** (e.g. "quiet place to work" finds places described as calm, good for studying). No filters from natural language. | When the right words are hard to guess but the *idea* is clear. |
| **Intermediate** | An LLM reads your message and outputs **structured intent**: query terms, filters (open now, distance, price), and boosts. So "open now near the beach" becomes a real query plus filters. One shot, no memory. | When you want one natural-language request turned into a proper search. |
| **Advanced** | Same as Intermediate, plus **conversation memory** and **hybrid search** (keyword + vector). You can follow up with *"Which one has more students?"* and the app re-ranks by that. Chat-style replies and reordered results. | When the full flow is conversational and you refine over multiple turns. |

In short: **Traditional** is keyword plus filters; **Semantic** adds meaning; **Intermediate** adds intent and structure; **Advanced** adds memory and hybrid so follow-ups and "which one" questions work.

---

## Why We Use OpenSearch

We need **three things in one place**: text search (BM25), vector search (for meaning), and geo (distance, "near me"). OpenSearch gives us all of that in a single engine: **keyword search** (BM25 on name, category, and review text), **vector search** (kNN on embeddings so "quiet place to work" matches by meaning), **geo** (distance filters and distance-based sorting), and **hybrid** (keyword and vector in one query, sorted by relevance then distance).

Alternatives often force you to glue together a text search engine, a vector DB, and a geo layer. OpenSearch keeps the stack simple. This demo works with **watsonx.data OpenSearch** so you can use a managed instance without running the cluster yourself.  

---

## How This Helps a Real Business: A Short Example

Imagine a **campus or neighborhood app** that helps students and staff find places to work or meet.

**Before:** Users type "coffee" and then scroll through a long list, or they don't know what to type for "somewhere quiet with wifi."

**After:** They say *"Somewhere cheap and quiet to work, with good reviews."* The app returns a few relevant spots. They ask *"Which one has more students?"* and the list updates to highlight the place that's known for that (e.g. Campus Brew) instead of staying stuck on the first query.

The business wins because users get to the right place faster, use the app more, and the data (reviews, categories) is actually used to rank. This repo is a working blueprint for that kind of experience.

---

## Step-by-Step Setup

You need **Node.js** 18+ and **watsonx.data OpenSearch** (or another OpenSearch-compatible endpoint). Follow these steps in order.

### 1. Prerequisites

**Node.js** 18 or newer. **watsonx.data OpenSearch**: provision an OpenSearch instance in watsonx.data and note the endpoint URL and credentials. Optionally, an **OpenAI-compatible API key** for Semantic, Intermediate, and Advanced modes and for embeddings.

### 2. Clone and install

```bash
git clone <your-repo-url>
cd nextgen-location-search
npm install
```

### 3. Environment variables

Copy the example env file and edit it:

```bash
cp .env.example .env
```

Edit `.env` and set:

**OpenSearch (required):** `OPENSEARCH_URL` (your watsonx.data OpenSearch endpoint), `OPENSEARCH_USER` and `OPENSEARCH_PASS`. Use the URL and credentials from your watsonx.data OpenSearch instance.

**Optional (for Semantic, Intermediate, and Advanced):** `LLM_API_KEY` or `OPENAI_API_KEY` for the LLM and for generating embeddings. Without a key, you can still run **Traditional** mode and optionally index sample data without embeddings.

### 4. watsonx.data OpenSearch

Use **watsonx.data OpenSearch** as your search backend. In watsonx.data, provision or use an existing OpenSearch instance, then copy the **endpoint URL** and **credentials** into `.env` as `OPENSEARCH_URL`, `OPENSEARCH_USER`, and `OPENSEARCH_PASS`. The app talks to OpenSearch over the REST API, so as long as the endpoint is reachable from where the app runs, you’re set.

**Alternative: run OpenSearch locally with Docker** (for quick dev only):

```bash
docker run -d -p 9200:9200 -p 9600:9600 -e "discovery.type=single-node" -e "OPENSEARCH_INITIAL_ADMIN_PASSWORD=YourPassword123!" opensearchproject/opensearch:2.11.0
```

Then set `OPENSEARCH_URL=http://localhost:9200` and `OPENSEARCH_USER=admin`, `OPENSEARCH_PASS=YourPassword123!` in `.env`.

### 5. Load sample data (ingest)

From the project root:

```bash
npm run ingest
```

This creates the `places` index and loads sample coffee-shop–style documents. If `LLM_API_KEY` or `OPENAI_API_KEY` is set, it will also generate embeddings so Semantic and Advanced modes work. To replace an existing index:

```bash
INGEST_FORCE=1 npm run ingest
```

### 6. Start the app

From the project root:

```bash
npm run dev
```

Then open **http://localhost:3002** in your browser. The backend runs at http://localhost:3001.

### 7. Try the four modes

Switch the mode (Traditional / Semantic / Intermediate / Advanced) in the UI. In **Traditional**, use the filters and keyword box. In **Semantic** and **Intermediate**, type a full sentence and click Search. In **Advanced**, use the chat; you can refine with follow-ups like *"Which one has more students?"*

For suggested demo flows, see [docs/demo-queries.md](./docs/demo-queries.md).

---

## API (Quick Reference)

**POST /api/chat**  
Body: `{ "mode", "messages", "userContext", optional "currentKeyword" }`  
Returns: `results`, `explanation`, `queryPlan`, `warnings`, and optionally `chatResponse` (Advanced) or `clarifyingQuestion` (Intermediate).
