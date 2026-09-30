// OpenTabSort Zen — remote provider Pass 2 drivers.
//
// This mirrors the Ollama orchestration shape, but the transport is any
// OpenAI/Gemini/custom provider explicitly enabled in preferences.

import { LOG } from "./config.mjs";
import { getProviderReadiness } from "./provider-readiness.mjs";
import { buildProviderRequest, getProviderKind, parseProviderResponse } from "./provider-requests.mjs";
import { readProviderSettings } from "./provider-settings.mjs";
import { buildClassifyPrompt, buildClusterPrompt, buildUnifiedPrompt, buildFreshPrompt } from "./ollama-prompts.mjs";
import { consolidateNewGroups } from "./new-group-consolidation.mjs";
import { PROVIDER_TAB_BATCH_SIZE } from "./provider-batching.mjs";
import { collectProviderTabMap, clusterAssignments, normalizeProviderLabel } from "./remote-assignment-retry.mjs";
import { fetchPageSnippet } from "./tabs.mjs";
import { showToast } from "./ui-toast.mjs";
import { safeProviderErrorMessage } from "./safe-log.mjs";

const GENERATE_TIMEOUT_MS = 120000;
const PROVIDER_JSON_MAX_TOKENS = 4096;
const PROVIDER_FRESH_JSON_MAX_TOKENS = 4096;
const PROVIDER_FRESH_TAB_BATCH_SIZE = 35;

export const classifyExistingGroupsRemoteBatch = async (pendingTabs, rules, settings = readProviderSettings(Services.prefs)) => {
  if (!pendingTabs?.length || !rules?.length) return new Map();
  const readiness = getProviderReadiness(settings);
  if (!readiness.ok) {
    showToast(readiness.reason === "consent_required"
      ? "Remote provider needs data-sending consent before sorting."
      : `Remote provider is not ready: ${readiness.reason}`);
    return skippedMap(pendingTabs);
  }

  const namesByLower = new Map(rules.map((r) => r?.name).filter(Boolean).map((name) => [name.toLowerCase(), name]));
  const { parsedByIndex, missing, failures } = await collectProviderTabMap({
    tabs: pendingTabs,
    initialBatchSize: PROVIDER_TAB_BATCH_SIZE,
    label: "remote provider classification",
    buildPrompt: (tabs) => buildClassifyPrompt(rules, tabs),
    fetchJson: (prompt) => providerJson(readiness.value, prompt),
    validateLabel: (value) => {
      const name = normalizeProviderLabel(value);
      return name && (namesByLower.has(name.toLowerCase()) || /^(none|skipped)$/i.test(name)) ? name : null;
    },
  });
  const out = new Map(pendingTabs.map((_, index) => [index, namesByLower.get(parsedByIndex.get(index)?.toLowerCase()) || null]));
  out.unresolved = new Set(missing);
  if (failures.length) out.failed = failures.join("; ");
  return out;
};

export const runPass2Remote = async (unmatched, rules, settings = readProviderSettings(Services.prefs)) => {
  const empty = { assignedToExisting: [], newGroups: [], skipped: [] };
  if (!unmatched?.length) return empty;

  try {
    const readiness = getProviderReadiness(settings);
    if (!readiness.ok) {
      const message = readiness.reason === "consent_required"
        ? "Remote provider needs data-sending consent before sorting."
        : `Remote provider is not ready: ${readiness.reason}`;
      showToast(message);
      return { ...empty, skipped: unmatched, failed: readiness.reason };
    }

    if (!rules.some((r) => r?.name)) {
      const grouped = await clusterUnmatchedNewGroups(unmatched, readiness.value);
      return { assignedToExisting: [], newGroups: grouped.groups, skipped: grouped.skipped, unresolved: grouped.unresolved, ...(grouped.failed ? { failed: grouped.failed } : {}) };
    }

    const { deduped, origToDeduped } = dedupeTabs(unmatched);
    const snippets = await fetchSnippets(deduped, "remote");
    const ruleNameByLower = new Map(rules.filter((r) => r?.name).map((r) => [r.name.toLowerCase(), r.name]));
    const { parsedByIndex: parsedByDedupedIndex, failures } = await collectProviderTabMap({
      tabs: deduped,
      snippets,
      initialBatchSize: PROVIDER_TAB_BATCH_SIZE,
      label: "remote provider",
      buildPrompt: (tabs, chunkSnippets) => buildUnifiedPrompt(rules, tabs, chunkSnippets),
      fetchJson: (prompt) => providerJson(readiness.value, prompt, PROVIDER_JSON_MAX_TOKENS),
    });
    const assignedToExisting = [];
    const newGroupsByKey = new Map();
    const skipped = [];
    const unresolved = [];

    for (let i = 0; i < unmatched.length; i++) {
      const value = parsedByDedupedIndex.get(origToDeduped[i]);
      if (!parsedByDedupedIndex.has(origToDeduped[i])) {
        unresolved.push(unmatched[i]);
        continue;
      }
      const raw = normalizeProviderLabel(value);
      const lower = raw.toLowerCase();
      if (!raw || lower === "skipped" || lower === "none") {
        skipped.push(unmatched[i]);
        continue;
      }
      const canonical = ruleNameByLower.get(lower);
      if (canonical) {
        assignedToExisting.push({ tabInfo: unmatched[i], groupName: canonical, similarity: 1.0 });
        continue;
      }
      if (!newGroupsByKey.has(lower)) newGroupsByKey.set(lower, { name: raw, tabs: [] });
      newGroupsByKey.get(lower).tabs.push(unmatched[i]);
    }

    const newGroups = failures.length ? [...newGroupsByKey.values()] : await consolidateNewGroups([...newGroupsByKey.values()], (prompt) =>
      providerJson(readiness.value, prompt), "Remote provider");
    if (failures.length > 0) {
      showToast(`Remote provider could not classify ${unresolved.length} tab(s); their current grouping was kept.`);
    }
    return { assignedToExisting, newGroups, skipped, unresolved, ...(failures.length ? { failed: failures.join("; ") } : {}) };
  } catch (e) {
    const message = safeProviderErrorMessage(e, [settings.apiKey]);
    console.error(`${LOG} remote provider classification failed: ${message}`);
    showToast(`Remote provider classification failed: ${message}`);
    return { ...empty, unresolved: unmatched, failed: message };
  }
};

export const runPass2RemoteFresh = async (allTabs, settings = readProviderSettings(Services.prefs)) => {
  const empty = { assignedToExisting: [], newGroups: [], skipped: [] };
  if (!allTabs?.length) return empty;

  try {
    const readiness = getProviderReadiness(settings);
    if (!readiness.ok) {
      showToast(`Remote provider is not ready: ${readiness.reason}`);
      return { ...empty, skipped: allTabs, failed: readiness.reason };
    }

    const { deduped, origToDeduped } = dedupeTabs(allTabs);
    const snippets = await fetchSnippets(deduped, "remote fresh");
    const { parsedByIndex: parsedByDedupedIndex, failures } = await collectProviderTabMap({
      tabs: deduped,
      snippets,
      initialBatchSize: PROVIDER_FRESH_TAB_BATCH_SIZE,
      label: "remote provider fresh",
      buildPrompt: (tabs, chunkSnippets) => buildFreshPrompt(tabs, chunkSnippets),
      fetchJson: (prompt) => providerJson(readiness.value, prompt, PROVIDER_FRESH_JSON_MAX_TOKENS),
    });
    const newGroupsByKey = new Map();
    const skipped = [];
    const unresolved = [];

    for (let i = 0; i < allTabs.length; i++) {
      const value = parsedByDedupedIndex.get(origToDeduped[i]);
      if (!parsedByDedupedIndex.has(origToDeduped[i])) {
        unresolved.push(allTabs[i]);
        continue;
      }
      const raw = normalizeProviderLabel(value);
      const lower = raw.toLowerCase();
      if (!raw || lower === "skipped" || lower === "none") {
        skipped.push(allTabs[i]);
        continue;
      }
      if (!newGroupsByKey.has(lower)) newGroupsByKey.set(lower, { name: raw, tabs: [] });
      newGroupsByKey.get(lower).tabs.push(allTabs[i]);
    }

    if (failures.length > 0) {
      showToast(`Remote provider could not classify ${unresolved.length} tab(s); their current grouping was kept.`);
    }

    const newGroups = failures.length ? [...newGroupsByKey.values()] : await consolidateNewGroups([...newGroupsByKey.values()], (prompt) =>
      providerJson(readiness.value, prompt, PROVIDER_FRESH_JSON_MAX_TOKENS), "Remote provider");

    return {
      assignedToExisting: [],
      newGroups,
      skipped,
      unresolved,
      ...(failures.length > 0 ? { failed: failures.join("; ") } : {}),
    };
  } catch (e) {
    const message = safeProviderErrorMessage(e, [settings.apiKey]);
    console.error(`${LOG} remote provider fresh classification failed: ${message}`);
    showToast(`Remote provider fresh classification failed: ${message}`);
    return { ...empty, unresolved: allTabs, failed: message };
  }
};

const clusterUnmatchedNewGroups = async (leftover, settings) => {
  const { parsedByIndex, missing, failures } = await collectProviderTabMap({
    tabs: leftover,
    initialBatchSize: PROVIDER_TAB_BATCH_SIZE,
    label: "remote provider clustering",
    buildPrompt: (tabs) => buildClusterPrompt(tabs),
    fetchJson: async (prompt, count) => clusterAssignments(await providerJson(settings, prompt), count),
  });
  const groupsByLower = new Map();
  const skipped = [];
  for (const [index, name] of parsedByIndex) {
    const key = name.toLowerCase();
    if (key === "none" || key === "skipped") { skipped.push(leftover[index]); continue; }
    if (!groupsByLower.has(key)) groupsByLower.set(key, { name, tabs: [] });
    groupsByLower.get(key).tabs.push(leftover[index]);
  }
  return { groups: [...groupsByLower.values()], skipped, unresolved: missing.map((index) => leftover[index]), failed: failures.join("; ") };
};

export const providerJson = async (settings, prompt, maxTokens = PROVIDER_JSON_MAX_TOKENS, signal) => {
  const responseText = await providerText(settings, prompt, maxTokens, signal);
  let parsed;
  try {
    parsed = JSON.parse(extractJsonObjectText(responseText));
  } catch {
    throw new Error("Provider returned non-JSON content");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Provider returned non-object JSON");
  }
  return parsed;
};

const extractJsonObjectText = (text) => {
  const raw = String(text || "").trim();
  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return fenced[1].trim();
  return raw;
};

const providerText = async (settings, prompt, maxTokens, signal) => {
  const request = buildProviderRequest(settings, prompt, maxTokens);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS);
  try {
    const response = await fetch(request.url, { ...request.init, signal: controller.signal });
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      error.terminal = response.status >= 400 && response.status < 500;
      error.retryable = false;
      // Cancel an unused error body; never include provider bodies in diagnostics.
      try { await response.body?.cancel(); } catch {}
      throw error;
    }
    const body = await response.text();
    const text = parseProviderResponse(getProviderKind(settings), body);
    if (typeof text !== "string" || !text.trim()) throw new Error("Provider response did not contain text");
    return text.trim();
  } catch (error) {
    if (signal?.aborted) throw new DOMException("Sorting stopped", "AbortError");
    if (error.status || /^Provider response/.test(error.message)) throw error;
    const safe = new Error(error.name === "AbortError" ? `Provider timeout after ${GENERATE_TIMEOUT_MS}ms` : "Provider network request failed");
    safe.retryable = false;
    throw safe;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
};

const dedupeTabs = (tabs) => {
  const indexByKey = new Map();
  const deduped = [];
  const origToDeduped = tabs.map((tab) => {
    const key = JSON.stringify([tab.url || "", tab.hostname || "", tab.title || ""]);
    if (indexByKey.has(key)) return indexByKey.get(key);
    const idx = deduped.length;
    indexByKey.set(key, idx);
    deduped.push(tab);
    return idx;
  });
  return { deduped, origToDeduped };
};

const fetchSnippets = async (tabs, label) => {
  const t0 = performance.now();
  const snippets = await Promise.all(tabs.map((tab) => {
    const url = tab.url || "";
    if (!url.startsWith("http://") && !url.startsWith("https://")) return "";
    return fetchPageSnippet(url);
  }));
  const hit = snippets.filter(Boolean).length;
  console.log(`${LOG} ${label}: fetched snippets for ${hit}/${tabs.length} tab(s) in ${Math.round(performance.now() - t0)}ms`);
  return snippets;
};

const skippedMap = (tabs) => new Map(tabs.map((_, idx) => [idx, null]));
