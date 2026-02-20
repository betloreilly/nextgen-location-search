import { Client } from "@opensearch-project/opensearch";

const url = process.env.OPENSEARCH_URL ?? "http://localhost:9200";
const user = process.env.OPENSEARCH_USER;
const pass = process.env.OPENSEARCH_PASS;

export const openSearchClient = new Client({
  node: url,
  ...(user && pass ? { auth: { username: user, password: pass } } : {}),
});
