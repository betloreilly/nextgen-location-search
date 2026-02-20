/**
 * Load .env from monorepo root so backend uses same OPENSEARCH_* and LLM_* as ingest/scripts.
 * Must be imported first (before opensearch or other modules that read process.env).
 */
import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// From apps/backend/src -> repo root is ../../..
const root = join(__dirname, "..", "..", "..");
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
