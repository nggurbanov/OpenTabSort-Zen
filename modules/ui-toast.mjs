// Reliable browser-local feedback; no OS notification permissions are required.
import { LOG } from "./config.mjs";
import { showNotice } from "./operation-ui.mjs";
export const showToast = (message) => {
  try { showNotice(message); }
  catch { console.warn(`${LOG} ${message}`); }
};
