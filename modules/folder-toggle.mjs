// Native collapse state is authoritative, including manual changes and workspace switches.
export const FOLDER_TOGGLE_ID = "zao-toggle-folders";
export const FOLDER_TOGGLE_COMMAND = "cmd_zaoToggleFolders";
export const workspaceFolders = () => Array.from(window.gZenWorkspaces?.activeWorkspaceElement?.querySelectorAll(
  'tab-group:not([split-view-group]), zen-folder:not([split-view-group])'
) || []).filter(group => group.isConnected);
const isCollapsed = group => group.hasAttribute("collapsed") || group.collapsed === true;
export const refreshFolderToggle = () => {
  const groups = workspaceFolders();
  const expand = groups.length > 0 && groups.every(isCollapsed);
  const label = expand ? "Expand all folders" : "Collapse all folders";
  const set = (button, name, value) => { if (button.getAttribute(name) !== value) button.setAttribute(name, value); };
  for (const button of document.querySelectorAll(`#${FOLDER_TOGGLE_ID}`)) {
    set(button, "label", label);
    set(button, "aria-label", label);
    set(button, "tooltiptext", label + " in this workspace");
    set(button, "data-zao-expand", String(expand));
    if (groups.length) button.removeAttribute("disabled");
    else set(button, "disabled", "true");
  }
};
export const toggleWorkspaceFolders = () => {
  const groups = workspaceFolders();
  const collapse = !groups.every(isCollapsed);
  for (const group of groups) group.collapsed = collapse;
  refreshFolderToggle();
};
export const setupFolderToggle = () => {
  if (window._zaoFolderToggleObserver) return;
  const root = document.querySelector("#tabbrowser-tabs");
  if (!root) return;
  const hasFolder = node => node.nodeType === 1 && (node.matches?.("tab-group, zen-folder") || node.querySelector?.("tab-group, zen-folder"));
  const observer = new MutationObserver(records => {
    if (records.some(record => record.type === "attributes" || [...record.addedNodes, ...record.removedNodes].some(hasFolder))) refreshFolderToggle();
  });
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["collapsed"] });
  window._zaoFolderToggleObserver = observer;
  refreshFolderToggle();
};
export const teardownFolderToggle = () => {
  window._zaoFolderToggleObserver?.disconnect();
  delete window._zaoFolderToggleObserver;
};
