// OpenTabSort Zen — remote provider Pass 2 drivers.
//
// This mirrors the Ollama orchestration shape, but the transport is any
// OpenAI/Gemini/custom provider explicitly enabled in preferences.

import { LOG } from "./config.mjs";
import { getProviderReadiness } from "./provider-readiness.mjs";
import { buildProviderRequest, getProviderKind, parseProviderResponse } from "./provider-requests.mjs";
import { readProviderSettings } from "./provider-settings.mjs";
import { buildClassifyPrompt, buildClusterPrompt, buildUnifiedPrompt, buildFreshPrompt } from "./ollama-prompts.mjs";
import { fetchPageSnippet } from "./tabs.mjs";
import { showToast } from "./ui-toast.mjs";

const GENERATE_TIMEOUT_MS = 120000;

const stripMetaPrefix = (s) => s
  .replace(/^\s*(?:new\s+)?(?:category|label|topic|bucket|group)\s*[:\-–]\s*/i, "")
  .trim();

export const classifyExistingGroupsRemoteBatch = async (pendingTabs, rules, settings = readProviderSettings(Services.prefs)) => {
  if (!pendingTabs?.length || !rules?.length) return new Map();
  const readiness = getProviderReadiness(settings);
  if (!readiness.ok) {
    showToast(readiness.reason === "consent_required"
      ? "Remote provider needs data-sending consent before sorting."
      : `Remote provider is not ready: ${readiness.reason}`);
    return skippedMap(pendingTabs);
  }

  const parsed = await providerJson(readiness.value, buildClassifyPrompt(rules, pendingTabs));
  const namesByLower = new Map(rules.map((r) => r?.name).filter(Boolean).map((name) => [name.toLowerCase(), name]));
  const out = new Map();

  for (const [key, value] of Object.entries(parsed)) {
    const idx = Number.parseInt(key, 10);
    if (!Number.isFinite(idx) || idx < 0 || idx >= pendingTabs.length) continue;
    const raw = String(value || "").trim();
    const canonical = namesByLower.get(raw.toLowerCase());
    out.set(idx, canonical || null);
  }
  for (let i = 0; i < pendingTabs.length; i++) if (!out.has(i)) out.set(i, null);
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
      return { assignedToExisting: [], newGroups: grouped.groups, skipped: grouped.skipped };
    }

    const { deduped, origToDeduped } = dedupeTabs(unmatched);
    const snippets = await fetchSnippets(deduped, "remote");
    const parsed = await providerJson(readiness.value, buildUnifiedPrompt(rules, deduped, snippets));
    const ruleNameByLower = new Map(rules.filter((r) => r?.name).map((r) => [r.name.toLowerCase(), r.name]));
    const assignedToExisting = [];
    const newGroupsByKey = new Map();
    const skipped = [];

    for (let i = 0; i < unmatched.length; i++) {
      const value = parsed[origToDeduped[i]] ?? parsed[String(origToDeduped[i])];
      const raw = stripMetaPrefix(value == null ? "" : String(value).trim());
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

    return { assignedToExisting, newGroups: [...newGroupsByKey.values()], skipped };
  } catch (e) {
    console.error(`${LOG} remote provider classification failed:`, e);
    showToast(`Remote provider classification failed: ${e.message || e}`);
    return { ...empty, skipped: unmatched, failed: e.message || String(e) };
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
    const parsed = await providerJson(readiness.value, buildFreshPrompt(deduped, snippets));
    const newGroupsByKey = new Map();
    const skipped = [];

    for (let i = 0; i < allTabs.length; i++) {
      const value = parsed[origToDeduped[i]] ?? parsed[String(origToDeduped[i])];
      const raw = stripMetaPrefix(value == null ? "" : String(value).trim());
      const lower = raw.toLowerCase();
      if (!raw || lower === "skipped" || lower === "none") {
        skipped.push(allTabs[i]);
        continue;
      }
      if (!newGroupsByKey.has(lower)) newGroupsByKey.set(lower, { name: raw, tabs: [] });
      newGroupsByKey.get(lower).tabs.push(allTabs[i]);
    }

    return { assignedToExisting: [], newGroups: [...newGroupsByKey.values()], skipped };
  } catch (e) {
    console.error(`${LOG} remote provider fresh classification failed:`, e);
    showToast(`Remote provider fresh classification failed: ${e.message || e}`);
    return { ...empty, skipped: allTabs, failed: e.message || String(e) };
  }
};

const clusterUnmatchedNewGroups = async (leftover, settings) => {
  const parsed = await providerJson(settings, buildClusterPrompt(leftover));
  const validIdx = (i) => Number.isFinite(i) && i >= 0 && i < leftover.length;
  const seen = new Set();
  const groups = [];

  for (const group of Array.isArray(parsed?.groups) ? parsed.groups : []) {
    const name = String(group?.name || "").trim();
    if (!name) continue;
    const tabs = [];
    for (const idx of Array.isArray(group?.tabs) ? group.tabs.filter(validIdx) : []) {
      if (seen.has(idx)) continue;
      seen.add(idx);
      tabs.push(leftover[idx]);
    }
    if (tabs.length > 0) groups.push({ name, tabs });
  }

  return { groups, skipped: leftover.filter((_, idx) => !seen.has(idx)) };
};

const providerJson = async (settings, prompt) => {
  const responseText = await providerText(settings, prompt);
  let parsed;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new Error(`Provider returned non-JSON content: ${String(responseText).slice(0, 120)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Provider returned non-object JSON");
  }
  return parsed;
};

const providerText = async (settings, prompt) => {
  const request = buildProviderRequest(settings, prompt, 1400);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(request.url, { ...request.init, signal: controller.signal });
  } catch (e) {
    throw new Error(e.name === "AbortError" ? `timeout after ${GENERATE_TIMEOUT_MS}ms` : (e.message || String(e)));
  } finally {
    clearTimeout(timer);
  }

  const body = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 200)}`);
  const text = parseProviderResponse(getProviderKind(settings), body);
  if (typeof text !== "string" || !text.trim()) throw new Error("Provider response did not contain text");
  return text.trim();
};

const dedupeTabs = (tabs) => {
  const indexByKey = new Map();
  const deduped = [];
  const origToDeduped = tabs.map((tab) => {
    const key = `${tab.hostname || ""}\x00${tab.title || ""}`;
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
