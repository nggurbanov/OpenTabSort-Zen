import test from "node:test";
import assert from "node:assert/strict";

import { buildProviderRequest, getProviderKind, parseProviderResponse, workspaceOutputBudget } from "../modules/provider-requests.mjs";

test("Given OpenAI-compatible provider When building request Then chat completions payload and auth header are used", () => {
  const request = buildProviderRequest({
    provider: "openai",
    endpoint: "https://api.example.test/v1/",
    apiKey: "sk-test",
    model: "gpt-tabs",
    consentToSendData: true,
  }, "sort tabs", 800);

  assert.equal(request.url, "https://api.example.test/v1/chat/completions");
  assert.equal(request.init.headers.authorization, "Bearer sk-test");
  assert.match(request.init.body, /"messages"/);
});

test("Given Gemini provider When building request Then generateContent URL is used", () => {
  const request = buildProviderRequest({
    provider: "gemini",
    apiKey: "AIza-test",
    model: "gemini-2.0-flash",
    consentToSendData: true,
  }, "sort tabs", 800);

  assert.match(request.url, /generativelanguage\.googleapis\.com/);
  assert.match(request.url, /gemini-2\.0-flash:generateContent/);
  assert.equal(request.init.headers["content-type"], "application/json");
});

test("Given custom Ollama provider When building request Then Ollama format is used", () => {
  const provider = {
    provider: "custom",
    endpoint: "http://localhost:11434",
    apiKey: "",
    model: "llama3.2",
    format: "ollama",
    consentToSendData: true,
  };
  const request = buildProviderRequest(provider, "sort tabs", 800);

  assert.equal(getProviderKind(provider), "ollama");
  assert.equal(request.url, "http://localhost:11434/api/generate");
  assert.match(request.init.body, /"stream":false/);
});

test("Given malformed provider response When parsing Then parser fails closed", () => {
  assert.equal(parseProviderResponse("openai", "{ nope"), null);
  assert.equal(parseProviderResponse("openai", JSON.stringify({ choices: [] })), null);
  assert.equal(parseProviderResponse("ollama", JSON.stringify({ response: "Tabs" })), "Tabs");
});

test("chat transport preserves larger requested output budgets up to 64K", () => {
  const provider = { provider: "custom", format: "openai", endpoint: "https://api.example.test/v1", model: "reasoning" };
  assert.equal(JSON.parse(buildProviderRequest(provider, "fixture", 8192).init.body).max_tokens, 8192);
  assert.equal(JSON.parse(buildProviderRequest(provider, "fixture", 999999).init.body).max_tokens, 65536);
  assert.equal(JSON.parse(buildProviderRequest(provider, "fixture", 4096).init.body).max_tokens, 4096);
});


test("Mercury's verified 64K workspace budget survives the actual OpenRouter request builder", () => {
  for (const model of ["inception/mercury-3", "inception/mercury-3-20261019"]) {
    for (const endpoint of ["https://openrouter.ai/api/v1", "https://openrouter.ai/api/v1/", "https://openrouter.ai/api/v1/chat/completions"]) {
      for (const provider of ["openai", "custom"]) {
        const settings = { provider, format: "openai", endpoint, model };
        assert.equal(workspaceOutputBudget(settings), 65536);
        assert.equal(JSON.parse(buildProviderRequest(settings, "fixture", workspaceOutputBudget(settings)).init.body).max_tokens, 65536);
      }
    }
  }
});

test("unknown models, lower-limit models, local formats and other gateways retain the compatible 8K budget", () => {
  const mercury = { provider: "custom", format: "openai", endpoint: "https://openrouter.ai/api/v1", model: "inception/mercury-3" };
  for (const settings of [
    { ...mercury, model: "liquid/lfm-2.5-24b-a2b" },
    { ...mercury, model: "new/unknown-model" },
    { ...mercury, model: "inception/mercury-3:unknown-variant" },
    { ...mercury, endpoint: "https://api.example.test/v1" },
    { ...mercury, endpoint: "https://openrouter.ai.example.test/api/v1" },
    { ...mercury, endpoint: "http://openrouter.ai/api/v1" },
    { ...mercury, endpoint: "https://openrouter.ai/another/api" },
    { ...mercury, endpoint: "https://user:secret@openrouter.ai/api/v1" },
    { ...mercury, endpoint: "https://openrouter.ai/api/v1?proxy=other" },
    { ...mercury, endpoint: "not a URL" },
    { ...mercury, format: "ollama" },
    { ...mercury, provider: "ollama" },
    { ...mercury, provider: "gemini" },
  ]) assert.equal(workspaceOutputBudget(settings), 8192);
});

test("larger chat ceilings leave default requests and Ollama generation bounds intact", () => {
  const chat = { provider: "custom", format: "openai", endpoint: "https://api.example.test/v1", model: "fixture" };
  assert.equal(JSON.parse(buildProviderRequest(chat, "fixture").init.body).max_tokens, 800);
  assert.equal(JSON.parse(buildProviderRequest(chat, "fixture", 4096).init.body).max_tokens, 4096);
  assert.equal(JSON.parse(buildProviderRequest(chat, "fixture", NaN).init.body).max_tokens, 800);
  assert.equal(JSON.parse(buildProviderRequest(chat, "fixture", -1).init.body).max_tokens, 64);
  for (const provider of [{ ...chat, provider: "ollama" }, { ...chat, format: "ollama" }]) {
    assert.equal(JSON.parse(buildProviderRequest(provider, "fixture", 65536).init.body).options.num_predict, 8192);
  }
});
