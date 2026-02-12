type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type Provider = "anthropic" | "openai";

const DEFAULT_PROVIDER: Provider =
  (process.env.AI_PROVIDER as Provider) || (process.env.ANTHROPIC_API_KEY ? "anthropic" : "openai");

const DEFAULT_MODEL =
  process.env.AI_MODEL ||
  (DEFAULT_PROVIDER === "anthropic" ? "claude-sonnet-4-5-20250929" : "gpt-4o-mini-2024-07-18");

const ANTHROPIC_FALLBACK_MODEL = "claude-3-5-haiku-20241022";

const DEFAULT_MAX_TOKENS = Number(process.env.AI_MAX_TOKENS ?? "2000");

async function callAnthropic(model: string, messages: ChatMessage[], maxTokens?: number): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY missing");

  const system = messages.find((m) => m.role === "system")?.content ?? "";
  const userMessages = messages.filter((m) => m.role !== "system");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      system,
      max_tokens: maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: userMessages
    })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Anthropic error ${res.status}: ${text.slice(0, 500)}`);
  }

  const data = (await res.json()) as { content: Array<{ text: string }> };
  const text = data.content?.map((c) => c.text).join("\n") ?? "";
  return text.trim();
}

async function callOpenAI(model: string, messages: ChatMessage[], maxTokens?: number): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY missing");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: 0.2
    })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenAI error ${res.status}: ${text.slice(0, 500)}`);
  }

  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  const text = data.choices?.[0]?.message?.content ?? "";
  return text.trim();
}

export async function callLLM(options: {
  messages: ChatMessage[];
  provider?: Provider;
  model?: string;
  maxTokens?: number;
}) {
  const provider = options.provider ?? DEFAULT_PROVIDER;
  const model = options.model ?? DEFAULT_MODEL;
  const maxTokens = options.maxTokens;

  if (provider === "anthropic") {
    try {
      return await callAnthropic(model, options.messages, maxTokens);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "";
      if (model !== ANTHROPIC_FALLBACK_MODEL && /model/i.test(message) && /not[-\s]?found/i.test(message)) {
        // Retry with fallback model
        return await callAnthropic(ANTHROPIC_FALLBACK_MODEL, options.messages, maxTokens);
      }
      throw err;
    }
  }
  return callOpenAI(model, options.messages, maxTokens);
}
