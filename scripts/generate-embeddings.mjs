#!/usr/bin/env node
/**
 * Generate embeddings for places and customer reviews using OpenAI.
 * Reads opensearch/sample-documents.json, writes opensearch/sample-documents-with-embeddings.json.
 * Requires: LLM_API_KEY or OPENAI_API_KEY in .env or environment.
 * Model: text-embedding-3-small (1536 dimensions).
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// Load .env from project root so "npm run embed" works without sourcing
const envPath = join(root, ".env");
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.replace(/#.*$/, "").trim();
    const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) {
      const value = m[2].replace(/^["']|["']$/g, "").trim();
      if (!process.env[m[1]]) process.env[m[1]] = value;
    }
  }
}

const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
const embeddingModel = process.env.EMBEDDING_MODEL || "text-embedding-3-small"; // 1536 dimensions

if (!apiKey) {
  console.error("Set LLM_API_KEY or OPENAI_API_KEY to generate embeddings.");
  process.exit(1);
}

const BATCH_SIZE = 20;

async function embed(texts) {
  if (texts.length === 0) return [];
  const input = texts.map((t) => (t || "").slice(0, 8000));
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: embeddingModel,
      input,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Embedding API error: ${res.status} ${err}`);
  }
  const data = await res.json();
  return data.data.map((d) => d.embedding);
}

async function embedBatched(texts) {
  const out = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const vectors = await embed(batch);
    out.push(...vectors);
  }
  return out;
}

async function main() {
  const path = join(root, "opensearch", "sample-documents.json");
  const docs = JSON.parse(readFileSync(path, "utf8"));

  const allReviewTexts = [];
  const reviewIndex = []; // [docIdx, reviewIdx] for each allReviewTexts entry

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    const reviews = doc.reviews || [];
    for (let r = 0; r < reviews.length; r++) {
      allReviewTexts.push(reviews[r].text || "");
      reviewIndex.push([i, r]);
    }
  }

  console.log("Embedding", allReviewTexts.length, "review texts...");
  const reviewEmbeddings = await embedBatched(allReviewTexts);

  const result = docs.map((d) => ({
    ...d,
    reviews: (d.reviews || []).map((r) => ({ ...r })),
  }));

  for (let k = 0; k < reviewIndex.length; k++) {
    const [i, r] = reviewIndex[k];
    result[i].reviews[r].embedding = reviewEmbeddings[k];
  }

  for (let i = 0; i < docs.length; i++) {
    const placeText = [
      docs[i].name,
      docs[i].category,
      (docs[i].reviews || []).map((r) => r.text).join(" "),
    ].join(" ");
    console.log("Embedding place", i + 1, docs[i].name);
    const [placeVec] = await embed([placeText]);
    result[i].embedding = placeVec;
  }

  const outPath = join(root, "opensearch", "sample-documents-with-embeddings.json");
  writeFileSync(outPath, JSON.stringify(result, null, 2), "utf8");
  console.log("Wrote", outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
