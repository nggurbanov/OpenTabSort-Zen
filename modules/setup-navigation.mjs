import { CONFIG } from "./config.mjs";
import { showToast } from "./ui-toast.mjs";
export const openAISetup = () => {
  Services.prefs.setStringPref(CONFIG.SETUP_REQUEST_PREF, String(Date.now()));
  if (typeof window.openPreferences === "function") window.openPreferences("paneSineMods");
  else if (typeof window.switchToTabHavingURI === "function") window.switchToTabHavingURI("about:preferences#sineMods", true);
  else if (window.gBrowser?.addTrustedTab) window.gBrowser.selectedTab = window.gBrowser.addTrustedTab("about:preferences#sineMods");
  else showToast("Open Zen Settings → OpenTabSort Zen to connect an AI engine.");
};
