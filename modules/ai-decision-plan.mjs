// The primary Decision action plans the whole workspace before any native move.
// Fresh categories and assignment batches are buffered so reconciliation, review,
// apply and Undo use the same boundary as the other primary AI engines.
import { readJevSettings, suggestCategories } from "./jev-categories.mjs";
import { classifyJevBatch, decisionEndpoint, sortJevBatches } from "./jev-provider.mjs";
import { readProviderSettings } from "./provider-settings.mjs";
import { getProviderReadiness } from "./provider-readiness.mjs";
import { workspaceOutputBudget } from "./provider-requests.mjs";
import { providerJson } from "./remote-provider.mjs";
import { getActiveSortSignal, throwIfSortCancelled, reportSortProgress } from "./sort-session.mjs";
import { safeProviderErrorMessage } from "./safe-log.mjs";

const emptyPlan = () => ({ assignedToExisting: [], newGroups: [], skipped: [], unresolved: [] });
const normalizedName = (name) => name.normalize("NFKC").trim().toLowerCase();
const cleanText = (value, limit) => String(value || "")
  .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ")
  .replace(/\s+/g, " ").trim().slice(0, limit);
const safeMetadata = (tab) => {
  let url = "";
  try {
    const parsed = new URL(tab.url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      parsed.username = ""; parsed.password = ""; parsed.search = ""; parsed.hash = "";
      url = parsed.toString();
    }
  } catch {}
  return { title: cleanText(tab.title, 180), url, currentGroup: cleanText(tab.currentGroup, 80) };
};

export const planDecisionWorkspace = async (tabs, { signal = getActiveSortSignal() } = {}) => {
  const empty = emptyPlan();
  const checkpoint = () => { throwIfSortCancelled(); signal?.throwIfAborted(); };
  checkpoint();
  if (!tabs.length) return empty;
  let settings, categoryProvider;
  try {
    settings = readJevSettings(Services.prefs);
    const decision = readProviderSettings(Services.prefs, "jev");
    categoryProvider = readProviderSettings(Services.prefs, settings.categoryProvider);
    for (const provider of [decision, categoryProvider]) {
      const readiness = getProviderReadiness(provider);
      if (!readiness.ok) throw new Error(readiness.reason);
    }
    decisionEndpoint(settings.endpoint);
    const metadata = tabs.map(safeMetadata);
    const originals = new Map(metadata.map((entry, index) => [entry, tabs[index]]));
    reportSortProgress(`Finding topics in ${tabs.length} tabs…`);
    const categories = await suggestCategories(metadata, [], async (prompt, requestSignal) => {
      checkpoint();
      const result = await providerJson(categoryProvider, prompt, workspaceOutputBudget(categoryProvider), requestSignal);
      checkpoint();
      return result;
    }, signal);
    checkpoint();
    const names = new Set(categories.map((category) => category.name));
    const assigned = [], skipped = [];
    await sortJevBatches({ tabs: metadata, categories, settings, signal,
      isCurrent: () => { checkpoint(); return true; },
      classify: async (batch, taxonomy, provider, requestSignal) => {
        checkpoint();
        const results = await classifyJevBatch(batch, taxonomy, provider, requestSignal);
        checkpoint();
        // Missing or malformed Decision answers are protocol failures, whereas
        // a complete choice of none (or low confidence) is an explicit skip.
        if (!Array.isArray(results) || results.length !== batch.length || results.some((result, index) =>
          result.tabInfo !== batch[index] || !["assigned", "skipped"].includes(result.status) ||
          (result.status === "assigned" && !names.has(result.groupName)))) {
          throw new Error("Decision provider returned incomplete or invalid tab assignments. No tabs were moved.");
        }
        for (const result of results) if (result.status === "skipped") skipped.push(originals.get(result.tabInfo));
        return results;
      },
      applyBatch: (results) => {
        checkpoint();
        for (const result of results) assigned.push({ tabInfo: originals.get(result.tabInfo), groupName: result.groupName });
        return 0;
      },
      onProgress: ({ processed, total }) => reportSortProgress(`Grouping ${processed} of ${total} tabs…`),
    });
    checkpoint();
    const existing = new Map(tabs.filter((tab) => typeof tab.currentGroup === "string" && tab.currentGroup.trim())
      .map((tab) => [normalizedName(tab.currentGroup), tab.currentGroup]));
    const plan = { ...emptyPlan(), categories, skipped };
    const newGroups = new Map();
    for (const entry of assigned) {
      const name = existing.get(normalizedName(entry.groupName));
      if (name) plan.assignedToExisting.push({ ...entry, groupName: name, similarity: 1 });
      else {
        if (!newGroups.has(entry.groupName)) newGroups.set(entry.groupName, { name: entry.groupName, tabs: [] });
        newGroups.get(entry.groupName).tabs.push(entry.tabInfo);
      }
    }
    plan.newGroups = [...newGroups.values()];
    return plan;
  } catch (error) {
    checkpoint();
    if (error.name === "AbortError") throw error;
    return { ...empty, unresolved: [...tabs],
      failed: safeProviderErrorMessage(error, [settings?.apiKey, categoryProvider?.apiKey]) };
  }
};
