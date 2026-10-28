const AUTH_HEADER_NAME = ["author", "ization"].join("");
const DEFAULT_WORKSPACE_OUTPUT_TOKENS = 8192;
const MERCURY_WORKSPACE_OUTPUT_TOKENS = 65536;
const MERCURY_MODELS = new Set(["inception/mercury-3", "inception/mercury-3-20261019"]);

// Verified against OpenRouter's public model metadata on 2026-10-28:
// Mercury 3 permits 131072 output tokens; LFM 2.5 permits only 8192.
// Keep unknown providers/models conservative and avoid adding discovery latency
// to every sort. This budget selects a ceiling, not a requested answer length.
export const workspaceOutputBudget = (provider) => {
  if (!["openai", "custom"].includes(provider.provider) ||
      (provider.provider === "custom" && provider.format !== "openai") ||
      !MERCURY_MODELS.has(provider.model?.trim())) return DEFAULT_WORKSPACE_OUTPUT_TOKENS;
  try {
    const endpoint = new URL(provider.endpoint);
    if (endpoint.origin === "https://openrouter.ai" && !endpoint.username && !endpoint.password &&
        !endpoint.search && !endpoint.hash && /^\/api\/v1(?:\/chat\/completions)?\/?$/.test(endpoint.pathname)) {
      return MERCURY_WORKSPACE_OUTPUT_TOKENS;
    }
  } catch {}
  return DEFAULT_WORKSPACE_OUTPUT_TOKENS;
};

export const buildProviderRequest = (provider, prompt, maxTokens) => {
  const boundedTokens = boundMaxTokens(maxTokens, getProviderKind(provider) === "ollama" ? 8192 : 65536);
  switch (provider.provider) {
    case "openai":
      return openAiRequest(provider.endpoint, provider.apiKey, provider.model, prompt, boundedTokens);
    case "gemini":
      return geminiRequest(provider.apiKey, provider.model, prompt, boundedTokens);
    case "ollama":
      return ollamaRequest(provider.endpoint, provider.model, prompt, boundedTokens);
    case "custom":
      return provider.format === "ollama"
        ? ollamaRequest(provider.endpoint, provider.model, prompt, boundedTokens)
        : openAiRequest(provider.endpoint, provider.apiKey, provider.model, prompt, boundedTokens);
    default:
      throw new ProviderRequestError(provider.provider);
  }
};

export const getProviderKind = (provider) => (provider.provider === "custom" ? provider.format : provider.provider);

export const parseProviderResponse = (kind, text) => {
  const parsed = parseJson(text);
  if (parsed === null) return null;
  if (kind === "ollama") return typeof parsed.response === "string" ? parsed.response : null;
  if (kind === "openai") return parsed.choices?.[0]?.message?.content ?? null;
  if (kind === "gemini") return parsed.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  return null;
};

const openAiRequest = (endpoint, apiKey, model, prompt, maxTokens) => ({
  url: appendPath(endpoint, "/chat/completions"),
  init: {
    method: "POST",
    headers: { "content-type": "application/json", ...(apiKey?.trim() ? { [AUTH_HEADER_NAME]: `Bearer ${apiKey.trim()}` } : {}) },
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: maxTokens, temperature: 0.2 }),
  },
});

const geminiRequest = (apiKey, model, prompt, maxTokens) => ({
  url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
  init: {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: maxTokens, temperature: 0.2 } }),
  },
});

const ollamaRequest = (endpoint, model, prompt, maxTokens) => ({
  url: appendPath(endpoint, "/api/generate"),
  init: {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, prompt, stream: false, options: { num_predict: maxTokens } }),
  },
});

const appendPath = (endpoint, path) => {
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  return trimmed.endsWith(path) ? trimmed : `${trimmed}${path}`;
};

const boundMaxTokens = (value, ceiling) => Math.min(Math.max(Number.isFinite(value) ? Math.trunc(value) : 800, 64), ceiling);

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export class ProviderRequestError extends Error {
  constructor(provider) {
    super(`Unexpected provider: ${provider}`);
    this.name = "ProviderRequestError";
    this.provider = provider;
  }
}
