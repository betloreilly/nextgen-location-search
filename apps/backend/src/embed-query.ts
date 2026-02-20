/**
 * Embed a search query using the same model as ingest (text-embedding-3-small, 1536 dims).
 * Used for semantic mode to run kNN similarity search.
 * Requires LLM_API_KEY or OPENAI_API_KEY in env.
 */
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";

export async function embedQuery(text: string): Promise<number[]> {
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("LLM_API_KEY or OPENAI_API_KEY required for semantic search.");
  }
  const input = (text || "place").slice(0, 8000);
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Embedding API error: ${res.status} ${err}`);
  }
  const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return data.data[0].embedding;
}
