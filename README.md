# Next-Gen Location Search

A full-stack demo that shows how **smarter search** can turn "find me a coffee shop" into a short, natural conversation, and why that matters for real businesses. Use **watsonx.data OpenSearch** as your search engine.

<p align="center">
  <img src="data/coffeeshops.gif" alt="Demo of conversational place search" width="1200"/>
</p>

---

## Getting Started

Clone the repo, then choose **one** of the two setup options below. Both options use the same ingestion and app—you only pick how you run the steps (script vs manual).

### What you need before starting

- A **terminal** (command line). On Windows, use **Git Bash** or **WSL** for the Quick setup script, or use **Step-by-Step Setup** in your terminal.
- **Node.js** 18 or newer (Quick setup can check and suggest installs).
- **OpenSearch** credentials: URL, username, and password from a managed cluster (e.g. **watsonx.data**). Local Docker OpenSearch is not supported for this demo.
- **Optional:** An OpenAI-compatible API key for Semantic, Intermediate, or Advanced modes (Traditional mode works without it).

**How to edit .env:** Open `.env` in any text editor (Notepad, TextEdit, VS Code). Set `OPENSEARCH_URL`, `OPENSEARCH_USER`, and `OPENSEARCH_PASS` to your OpenSearch endpoint and credentials. Save the file.

**Tip:** Frontend config is `apps/frontend/.env.local` (dotfile; enable **Show hidden files** in your file browser to see it).

---

### 1. Clone or download the repository

**With Git:**

```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
cd YOUR_REPO_NAME
```

**Without Git:** On GitHub click **Code** → **Download ZIP**, extract it, then open a terminal and `cd` into the extracted folder.

---

### 2. Choose one setup option

Use **either** Quick setup **or** Step-by-Step Setup—not both. They are alternatives that achieve the same result: `.env` configured, dependencies installed, sample data loaded with the code in this repo (`npm run ingest`), and the app running.

| | Quick setup | Step-by-Step Setup |
|---|-------------|---------------------|
| **Best for** | Fastest: script does env + install | You want to run each command yourself |
| **You run** | `./setup.sh`, then edit `.env`, `npm run ingest`, `npm run dev` | All steps below by hand |

#### Option A: Quick setup

From the **project folder** (where you see `setup.sh` and `package.json`):

```bash
chmod +x setup.sh
./setup.sh
```

Then: edit `.env` with your OpenSearch URL and credentials → run `npm run ingest` → run `npm run dev` → open **http://localhost:3002** in your browser.

*On Windows:* If you don’t have Git Bash or WSL, use **Option B: Step-by-Step Setup** instead.

#### Option B: Step-by-Step Setup

Do the following in order. This is the manual alternative to the Quick setup script.

**Prerequisites:** Node.js 18+, OpenSearch endpoint and credentials (e.g. from watsonx.data). Optionally an OpenAI-compatible API key for Semantic/Intermediate/Advanced modes.

1. **Clone and install** (if you haven’t already):

   ```bash
   git clone <your-repo-url>
   cd nextgen-location-search
   npm install
   ```

2. **Environment variables:** Copy the example env and edit it:

   ```bash
   cp .env.example .env
   ```

   Edit `.env`: set **OpenSearch (required)** — `OPENSEARCH_URL`, `OPENSEARCH_USER`, `OPENSEARCH_PASS`. **Optional:** `LLM_API_KEY` or `OPENAI_API_KEY` for LLM and embeddings.

3. **OpenSearch:** Use watsonx.data OpenSearch (or another OpenSearch-compatible endpoint). Put the endpoint URL and credentials in `.env`.  
   *Alternative for local dev only:* Run OpenSearch in Docker, then set `OPENSEARCH_URL=http://localhost:9200`, `OPENSEARCH_USER=admin`, `OPENSEARCH_PASS=YourPassword123!` in `.env`.

4. **Load sample data (ingest):** From the project folder:

   ```bash
   npm run ingest
   ```

   This creates the `places` index and loads sample documents from this repo. With `LLM_API_KEY` set, embeddings are generated for Semantic/Advanced. To replace an existing index: `INGEST_FORCE=1 npm run ingest`.

5. **Start the app:** From the project folder:

   ```bash
   npm run dev
   ```

   Open **http://localhost:3002** in your browser (backend at http://localhost:3001).

6. **Try the four modes** in the UI: Traditional, Semantic, Intermediate, Advanced. In **Traditional** use the filters and keyword box; in **Semantic** and **Intermediate** type a sentence and click Search; in **Advanced** use the chat and follow-ups like *"Which one has more students?"*

For architecture and how the app works, see [docs/architecture.md](docs/architecture.md).

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
| **Advanced** | The **LLM reads the full conversation** and produces the **OpenSearch query plan directly** (keywords, filters, review terms, sort). No regex extraction or multi-step planner—the model reasons over the whole chat and outputs one plan. Hybrid search (keyword + vector), review-based ranking, and chat-style replies with reordered results. | When the full flow is conversational and you refine over multiple turns (e.g. *"calm cafe within 1 km"* then *"which one has wifi?"*). |

In short: **Traditional** is keyword plus filters; **Semantic** adds meaning; **Intermediate** adds intent and structure (one message); **Advanced** uses the LLM to build the query plan from the entire conversation so follow-ups and "which one" questions work without losing context.

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

## API (Quick Reference)

**POST /api/chat**  
Body: `{ "mode", "messages", "userContext", optional "currentKeyword" }`  
Returns: `results`, `explanation`, `queryPlan`, `warnings`, and optionally `chatResponse` (Advanced) or `clarifyingQuestion` (Intermediate).
