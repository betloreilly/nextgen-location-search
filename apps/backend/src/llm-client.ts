const apiKey = process.env.LLM_API_KEY;
const model = process.env.LLM_MODEL ?? "gpt-4o-mini";

export interface LLMClientLike {
  chat(messages: Array<{ role: string; content: string }>): Promise<string>;
}

/**
 * Simple OpenAI-compatible chat client. Set LLM_API_KEY and optionally LLM_MODEL.
 * Returns raw response content; caller parses JSON.
 */
export function createLLMClient(): LLMClientLike | null {
  if (!apiKey) return null;
  return {
    async chat(messages: Array<{ role: string; content: string }>): Promise<string> {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          temperature: 0.2,
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`LLM API error: ${res.status} ${err}`);
      }
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = data.choices?.[0]?.message?.content ?? "";
      return content;
    },
  };
}
