// Bounded page-context work shared by every classifier. Page HTML is only a
// signal source; downloading an entire application bundle is unnecessary.
export const PAGE_CONTEXT_CONCURRENCY = 6;
export const PAGE_CONTEXT_MAX_BYTES = 256 * 1024;
export const PAGE_CONTEXT_BUDGET_MS = 6000;

export const mapPageContext = async (items, operation, { signal } = {}) => {
  signal?.throwIfAborted();
  const results = new Array(items.length);
  let nextIndex = 0;
  const work = async () => {
    while (nextIndex < items.length) {
      signal?.throwIfAborted();
      const index = nextIndex++;
      results[index] = await operation(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(items.length, PAGE_CONTEXT_CONCURRENCY) }, work));
  return results;
};

export const readPageContextHtml = async (response) => {
  const reader = response.body?.getReader?.();
  if (!reader) {
    // Non-streaming fetch adapters (including small test fixtures) have no
    // reader to cancel. Native Response bodies always use the bounded path.
    if (typeof response.text !== "function") return "";
    const text = await response.text();
    const prefix = new TextEncoder().encode(text.slice(0, PAGE_CONTEXT_MAX_BYTES));
    return new TextDecoder().decode(prefix.subarray(0, PAGE_CONTEXT_MAX_BYTES));
  }

  const decoder = new TextDecoder();
  const parts = [];
  let remaining = PAGE_CONTEXT_MAX_BYTES;
  let finished = false;
  try {
    while (remaining > 0) {
      const { done, value } = await reader.read();
      if (done) { finished = true; break; }
      const chunk = value.subarray(0, remaining);
      parts.push(decoder.decode(chunk, { stream: true }));
      remaining -= chunk.byteLength;
    }
    parts.push(decoder.decode());
    return parts.join("");
  } finally {
    // Stop network transfer as soon as the prefix is full, and also clean up
    // when a body read fails or the caller's fetch signal is aborted.
    if (!finished) {
      try { await reader.cancel(); } catch {}
    }
    try { reader.releaseLock(); } catch {}
  }
};
