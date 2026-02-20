#!/usr/bin/env node
/**
 * Seed OpenSearch "places" index with mapping and sample documents.
 * Usage: node scripts/seed-opensearch.mjs
 * Loads .env from project root. Requires: OPENSEARCH_URL, optionally OPENSEARCH_USER, OPENSEARCH_PASS
 */
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { Client } from "@opensearch-project/opensearch";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

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

const url = process.env.OPENSEARCH_URL || "http://localhost:9200";
const user = process.env.OPENSEARCH_USER;
const pass = process.env.OPENSEARCH_PASS;

const client = new Client({
  node: url,
  ...(user && pass ? { auth: { username: user, password: pass } } : {}),
});

const mapping = JSON.parse(
  readFileSync(join(root, "opensearch", "places-mapping.json"), "utf8")
);

const withEmbeddingsPath = join(root, "opensearch", "sample-documents-with-embeddings.json");
const fallbackPath = join(root, "opensearch", "sample-documents.json");
let docs;
try {
  docs = JSON.parse(readFileSync(withEmbeddingsPath, "utf8"));
  console.log("Using documents with embeddings from sample-documents-with-embeddings.json");
} catch {
  docs = JSON.parse(readFileSync(fallbackPath, "utf8"));
  console.log("Using sample-documents.json (no embeddings). Run 'npm run embed' first for kNN.");
}

async function main() {
  const index = "places";
  const exists = await client.indices.exists({ index }).then((r) => r.body);
  if (exists) {
    console.log("Index", index, "already exists. Delete it first to re-seed.");
    process.exit(1);
  }
  await client.indices.create({ index, body: mapping });
  console.log("Created index", index);
  for (let i = 0; i < docs.length; i++) {
    await client.index({ index, id: String(i + 1), body: docs[i] });
  }
  await client.indices.refresh({ index });
  console.log("Indexed", docs.length, "documents.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
