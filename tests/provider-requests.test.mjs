import test from "node:test";
import assert from "node:assert/strict";

import { buildProviderRequest, getProviderKind, parseProviderResponse } from "../modules/provider-requests.mjs";

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
