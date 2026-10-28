// Synthetic, dependency-free runtime budgets. Never opens a real browser/profile.
// Run: node scripts/benchmark-runtime.mjs [baseline-ref]
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { setImmediate as nextTurn } from "node:timers/promises";
import { fetchPageSnippets } from "../modules/tabs.mjs";
import { PAGE_CONTEXT_CONCURRENCY, PAGE_CONTEXT_MAX_BYTES, PAGE_CONTEXT_BUDGET_MS } from "../modules/page-context.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baseline = process.argv[2] || "4a511d4";
const readSource = (ref, path) => ref
  ? execFileSync("git", ["show", `${ref}:${path}`], { cwd: root, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 })
  : readFileSync(resolve(root, path), "utf8");
const staticGraph = (ref, roots) => {
  const seen = new Map();
  const visit = (path) => {
    if (seen.has(path)) return;
    const source = readSource(ref, path);
    seen.set(path, source);
    for (const match of source.matchAll(/\b(?:import|export)\s+(?:[^;]*?\s+from\s+)?["'](\.[^"']+)["']/g)) {
      visit(relative(root, resolve(root, dirname(path), match[1])));
    }
  };
  roots.forEach(visit);
  return {
    modules: seen.size,
    sourceBytes: [...seen.values()].reduce((sum, source) => sum + Buffer.byteLength(source), 0),
    paths: [...seen.keys()].sort(),
  };
};

const baselineTabsSource = readSource(baseline, "modules/tabs.mjs");
const { fetchPageSnippet: baselineFetchPageSnippet } = await import(
  `data:text/javascript;base64,${Buffer.from(baselineTabsSource).toString("base64")}`
);
const pageCount = 48;
const pageBytes = 1024 * 1024;
const chunkBytes = 64 * 1024;
const input = Array.from({ length: pageCount }, (_, index) => ({
  title: `Page ${index}`, hostname: "pages.test", url: `https://pages.test/${index}`,
}));

const measure = async (run) => {
  const originalFetch = globalThis.fetch;
  const stats = { peakConcurrent: 0, transferredBodyBytes: 0, cancelledBodies: 0, completedBodies: 0 };
  let active = 0;
  globalThis.fetch = async (url) => {
    active++;
    stats.peakConcurrent = Math.max(stats.peakConcurrent, active);
    let offset = 0, finished = false;
    const finish = () => { if (!finished) { finished = true; active--; } };
    const body = new ReadableStream({
      async pull(controller) {
        // A real asynchronous source makes overlapping transfers observable.
        await nextTurn();
        const length = Math.min(chunkBytes, pageBytes - offset);
        const chunk = new Uint8Array(length).fill(32);
        if (offset === 0) chunk.set(new TextEncoder().encode(
          `<meta name="description" content="Context for ${url}">`));
        offset += length;
        stats.transferredBodyBytes += length;
        controller.enqueue(chunk);
        if (offset === pageBytes) {
          stats.completedBodies++;
          finish();
          controller.close();
        }
      },
      cancel() { stats.cancelledBodies++; finish(); },
    }, { highWaterMark: 0 });
    return new Response(body, { headers: { "content-type": "text/html" } });
  };
  try {
    const start = performance.now();
    const snippets = await run();
    stats.elapsedMs = Math.round((performance.now() - start) * 100) / 100;
    stats.usableSnippets = snippets.filter(Boolean).length;
    return stats;
  } finally {
    globalThis.fetch = originalFetch;
  }
};

const before = await measure(() => Promise.all(input.map((tab) => baselineFetchPageSnippet(tab.url))));
const after = await measure(() => fetchPageSnippets(input));
const entry = "auto-organize.uc.mjs";
const report = {
  measuredAt: new Date().toISOString(),
  baseline,
  notes: [
    "Static source closure measures files reachable through static imports, not measured startup time or heap/RSS.",
    "Current context closures include the chosen context runtime; lazy AI engines and user-opened dialogs are excluded.",
    "Page transfer fixture uses controlled backpressure. Timings are synthetic and depend on the machine.",
    "Transferred body bytes and concurrent requests are measured; neither value is an RSS/memory-savings claim.",
  ],
  startup: {
    before: staticGraph(baseline, [entry]),
    afterEntry: staticGraph(null, [entry]),
    ...(existsSync(resolve(root, "modules/browser-runtime.mjs")) ? {
      afterBrowserContext: staticGraph(null, [entry, "modules/browser-runtime.mjs"]),
    } : {}),
    afterPreferencesContext: staticGraph(null, [entry, "modules/prefs-ui.mjs"]),
  },
  pageContext: {
    fixture: { uniquePages: pageCount, bodyBytesPerPage: pageBytes, chunkBytes },
    limits: { concurrentRequests: PAGE_CONTEXT_CONCURRENCY, htmlBytesPerPage: PAGE_CONTEXT_MAX_BYTES, phaseBudgetMs: PAGE_CONTEXT_BUDGET_MS },
    before, after,
  },
};
console.log(JSON.stringify(report, null, 2));
