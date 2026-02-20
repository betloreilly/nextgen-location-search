import "./load-env.js";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import express from "express";
import cors from "cors";
import { openSearchClient } from "./opensearch.js";
import { createLLMClient } from "./llm-client.js";
import { handleChat } from "./chat-handler.js";
import type { ChatRequestPayload } from "@nextgen-location-search/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Repo root: from apps/backend/src or apps/backend/dist -> up three levels
const repoRoot = join(__dirname, "..", "..", "..");
const dataDir = join(repoRoot, "data");

const app = express();
app.use(cors());
app.use(express.json());

// Serve place images from repo root data/ so /data/quiet.jpg, /data/chain.png etc. load in the UI
if (existsSync(dataDir)) {
  app.use("/data", express.static(dataDir, { maxAge: "1d" }));
} else {
  console.warn("Place images: data/ folder not found at", dataDir, "- /data/* image URLs will 404.");
}

const llmClient = createLLMClient();

app.post("/api/chat", async (req, res) => {
  try {
    const payload = req.body as ChatRequestPayload;
    if (!payload.mode || !Array.isArray(payload.messages) || !payload.userContext) {
      return res.status(400).json({
        error: "Missing mode, messages, or userContext",
      });
    }
    const result = await handleChat(payload, openSearchClient, llmClient);
    return res.json(result);
  } catch (err) {
    console.error("Chat error:", err);
    const message = err instanceof Error ? err.message : String(err);
    const isIndexMissing =
      message.includes("index_not_found_exception") || message.includes("no such index");
    if (isIndexMissing) {
      return res.status(503).json({
        error:
          "OpenSearch index 'places' not found. Create it and load data by running from the project root: npm run seed (or npm run embed && npm run seed for embeddings).",
      });
    }
    res.status(500).json({
      error: message || "Internal server error",
    });
    return;
  }
});

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
