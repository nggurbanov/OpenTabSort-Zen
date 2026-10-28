// Sine loads this entry in browser and preferences documents. Load only that context.
import { LOG } from "./modules/config.mjs";

let disposed = false;
let teardown;
const entryPoint = async () => {
  try {
    const url = window.location.href;
    if (url === "chrome://browser/content/browser.xhtml") {
      const runtime = await import("./modules/browser-runtime.mjs");
      if (disposed) return;
      teardown = runtime.teardownBrowserScript;
      runtime.initializeBrowserScript();
    } else if (url.startsWith("about:preferences") || url.startsWith("chrome://browser/content/preferences/")) {
      const runtime = await import("./modules/prefs-ui.mjs");
      if (disposed) return;
      teardown = runtime.teardownSettingsObserver;
      runtime.setupSettingsObserver();
    }
  } catch (error) { console.error(`${LOG} initialization failed:`, error); }
};
const cleanup = () => {
  if (disposed) return;
  disposed = true;
  window.removeEventListener("load", entryPoint);
  teardown?.();
};
if (document.readyState === "complete") void entryPoint();
else window.addEventListener("load", entryPoint, { once: true });
window.addEventListener("beforeunload", cleanup, { once: true });
window.addEventListener("unload", cleanup, { once: true });
