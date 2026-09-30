const RETRY_BATCH_SIZES = [12, 4, 1];

export const normalizeProviderLabel = (value) => {
  if (typeof value !== "string") return null;
  const label = value.trim().replace(/^\s*(?:new\s+)?(?:category|label|topic|bucket|group)\s*[:\-–]\s*/i, "").trim();
  return label && label.length <= 120 && !/[\u0000-\u001f\u007f]/u.test(label) ? label : null;
};

export const clusterAssignments = (parsed, count) => {
  const assignments = new Map();
  const conflicts = new Set();
  const accept = (index, label) => {
    if (!Number.isInteger(index) || index < 0 || index >= count) return;
    if (assignments.has(index) && assignments.get(index) !== label) conflicts.add(index);
    else assignments.set(index, label);
  };
  for (const group of Array.isArray(parsed?.groups) ? parsed.groups : []) {
    const label = normalizeProviderLabel(group?.name);
    if (!label || !Array.isArray(group?.tabs)) continue;
    for (const index of group.tabs) accept(index, label);
  }
  for (const index of Array.isArray(parsed?.skipped) ? parsed.skipped : []) accept(index, "skipped");
  for (const index of conflicts) assignments.delete(index);
  return Object.fromEntries(assignments);
};

export const collectProviderTabMap = async ({ tabs, snippets = [], initialBatchSize, label, buildPrompt, fetchJson, validateLabel = normalizeProviderLabel }) => {
  const parsedByIndex = new Map();
  const failures = [];
  let pending = tabs.map((_, index) => index);
  let terminal = false;
  for (const batchSize of retryBatchSizes(initialBatchSize)) {
    if (!pending.length || terminal) break;
    const nextPending = [];
    for (const indices of chunkIndices(pending, batchSize)) {
      try {
        const parsed = await fetchJson(buildPrompt(indices.map((index) => tabs[index]), indices.map((index) => snippets[index])), indices.length);
        const assignedLocals = new Set();
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          for (const [key, value] of Object.entries(parsed)) {
            if (!/^(0|[1-9]\d*)$/.test(key)) continue;
            const localIndex = Number(key);
            const normalized = validateLabel(value);
            if (!Number.isSafeInteger(localIndex) || localIndex >= indices.length || normalized === null) continue;
            parsedByIndex.set(indices[localIndex], normalized);
            assignedLocals.add(localIndex);
          }
        }
        for (let index = 0; index < indices.length; index++) if (!assignedLocals.has(index)) nextPending.push(indices[index]);
      } catch (error) {
        if (error.terminal || error.retryable === false || error.name === "AbortError") {
          failures.push(`${label}: ${error.message || "request failed"}`);
          terminal = true;
          break;
        }
        if (error.retryable === false || batchSize === 1) failures.push(`${label}: ${error.message || "request failed"}`);
        else nextPending.push(...indices);
      }
    }
    pending = nextPending;
  }
  const missing = tabs.map((_, index) => index).filter((index) => !parsedByIndex.has(index));
  if (missing.length && !failures.length) failures.push(`${label} missing assignments for ${missing.length} tab(s)`);
  return { parsedByIndex, failures, missing, terminal };
};

const retryBatchSizes = (initialBatchSize) => {
  const width = Number.isFinite(initialBatchSize) && initialBatchSize >= 1 ? Math.floor(initialBatchSize) : RETRY_BATCH_SIZES[0];
  return [...new Set([width, ...RETRY_BATCH_SIZES].filter((size) => size <= width))];
};
const chunkIndices = (indices, size) => {
  const chunks = [];
  for (let start = 0; start < indices.length; start += size) chunks.push(indices.slice(start, start + size));
  return chunks;
};
