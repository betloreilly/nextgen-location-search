#!/usr/bin/env node
/**
 * Single ingestion: load sample docs, optionally add embeddings, create index and index.
 * Usage: node scripts/ingest.mjs
 * Env: .env from project root. OPENSEARCH_* required. LLM_API_KEY or OPENAI_API_KEY optional (adds embeddings).
 * To replace existing index: INGEST_FORCE=1 node scripts/ingest.mjs
 */
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { Client } from "@opensearch-project/opensearch";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// ----- Load .env -----
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
const embeddingModel = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
const force = process.env.INGEST_FORCE === "1" || process.env.INGEST_FORCE === "true";
const BATCH_SIZE = 20;

// ----- Embedding (OpenAI) -----
async function embed(texts) {
  if (texts.length === 0) return [];
  const input = texts.map((t) => (t || "").slice(0, 8000));
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: embeddingModel, input }),
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
    out.push(...(await embed(batch)));
  }
  return out;
}

/** Add place + review embeddings to docs (mutates and returns same array). */
async function addEmbeddings(docs) {
  const allReviewTexts = [];
  const reviewIndex = [];
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

  return result;
}

async function main() {
  const samplesPath = join(root, "opensearch", "sample-documents.json");
  let docs = JSON.parse(readFileSync(samplesPath, "utf8"));
  console.log("Loaded", docs.length, "documents from sample-documents.json");

  if (apiKey) {
    console.log("Adding embeddings (OpenAI)...");
    docs = await addEmbeddings(docs);
    console.log("Embeddings done.");
  } else {
    console.log("No LLM_API_KEY/OPENAI_API_KEY — ingesting without embeddings (keyword-only).");
  }

  const url = (process.env.OPENSEARCH_URL || "http://localhost:9200").replace(/\/$/, "");
  const user = process.env.OPENSEARCH_USER || process.env.OPENSEARCH_USERNAME;
  const pass = process.env.OPENSEARCH_PASS || process.env.OPENSEARCH_PASSWORD;
  const client = new Client({
    node: url,
    ...(user && pass ? { auth: { username: user, password: pass } } : {}),
  });

  const mapping = JSON.parse(
    readFileSync(join(root, "opensearch", "places-mapping.json"), "utf8")
  );

  const index = "places";
  const indexExists = await client.indices.exists({ index }).then((r) => r.body);
  if (indexExists) {
    if (!force) {
      console.log("Index", index, "already exists. Set INGEST_FORCE=1 to replace.");
      process.exit(1);
    }
    await client.indices.delete({ index });
    console.log("Deleted existing index", index);
  }

  await client.indices.create({ index, body: mapping });
  console.log("Created index", index);

  for (let i = 0; i < docs.length; i++) {
    await client.index({ index, id: String(i + 1), body: docs[i] });
  }
  await client.indices.refresh({ index });
  console.log("Indexed", docs.length, "documents.");
  console.log("Ingestion complete.");
}

async function log400Body(url, user, pass, index, mapping) {
  const createUrl = url.replace(/\/$/, "") + "/" + index;
  const opts = {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(mapping),
  };
  if (user && pass) {
    opts.headers.Authorization = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
  }
  const res = await fetch(createUrl, opts);
  const text = await res.text();
  console.error("Raw server response (" + res.status + "):", text || "(empty)");
}

main().catch(async (e) => {
  if (e.meta?.body !== undefined) console.error("Server response body:", e.meta.body);
  if (e.meta?.statusCode) console.error("HTTP status:", e.meta.statusCode);
  if (e.meta?.statusCode === 400) {
    const url = (process.env.OPENSEARCH_URL || "http://localhost:9200").replace(/\/$/, "");
    const mapping = JSON.parse(
      readFileSync(join(root, "opensearch", "places-mapping.json"), "utf8")
    );
    console.error("Repeating create-index request to capture server message:");
    const u = process.env.OPENSEARCH_USER || process.env.OPENSEARCH_USERNAME;
    const p = process.env.OPENSEARCH_PASS || process.env.OPENSEARCH_PASSWORD;
    await log400Body(url, u, p, "places", mapping);
  }
  console.error(e);
  process.exit(1);
});
