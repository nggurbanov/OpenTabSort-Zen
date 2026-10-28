export const workspaceId = "workspace-1";

// Model native membership, including removal of a group after its last tab
// leaves. Assertions inspect tab identities and layout, not only call counts.
export const makeBrowser = ({ createFailure, moveFailure } = {}) => {
  const groups = [], tabs = [], calls = [], writes = [];
  const prefs = new Map();
  const makeGroup = (label, { collapsed = false, color = "blue", style = null } = {}) => {
    const attrs = new Map([["label", label], ["zen-workspace-id", workspaceId]]);
    if (collapsed) attrs.set("collapsed", "");
    if (style !== null) attrs.set("style", style);
    const classes = new Set(["original-group"]), styles = new Map();
    const group = {
      isConnected: true, members: [], color,
      getAttribute: (key) => attrs.has(key) ? attrs.get(key) : null,
      setAttribute: (key, value) => attrs.set(key, value),
      hasAttribute: (key) => attrs.has(key),
      removeAttribute: (key) => attrs.delete(key),
      querySelector: (selector) => selector.startsWith("tab") ? group.members[0] || null : null,
      querySelectorAll: (selector) => selector === "tab[aria-hidden]" ? [] : [...group.members],
      remove: () => { group.isConnected = false; },
      style: { setProperty: (key, value) => styles.set(key, value), removeProperty: (key) => styles.delete(key), getPropertyValue: (key) => styles.get(key) || "" },
      classList: { add: (key) => classes.add(key), remove: (key) => classes.delete(key), contains: (key) => classes.has(key) },
      get className() { return [...classes].join(" "); },
      set className(value) { classes.clear(); for (const name of value.split(" ")) if (name) classes.add(name); },
      get collapsed() { return attrs.has("collapsed"); },
      set collapsed(value) { if (value) attrs.set("collapsed", ""); else attrs.delete("collapsed"); },
    };
    groups.push(group);
    return group;
  };
  const detach = (tab) => {
    if (tab.group) {
      tab.group.members.splice(tab.group.members.indexOf(tab), 1);
      if (!tab.group.members.length) tab.group.isConnected = false;
    }
    tab.group = null;
  };
  const attach = (tab, group) => { detach(tab); tab.group = group; group.members.push(tab); };
  const makeTab = (hostname, group = null) => {
    const tab = { isConnected: true, group: null, workspaceId, pinned: false,
      getAttribute: (name) => name === "zen-workspace-id" ? tab.workspaceId : null,
      hasAttribute: () => false,
      closest: (selector) => selector === "tab-group" ? tab.group : null,
    };
    tabs.push(tab);
    if (group) attach(tab, group);
    return { hostname, _tab: tab };
  };
  globalThis.Services = { prefs: {
    getStringPref: (name, fallback = "") => prefs.get(name) ?? fallback,
    setStringPref: (name, value) => { prefs.set(name, value); writes.push({ name, value }); },
  } };
  globalThis.window = { gZenWorkspaces: { activeWorkspace: workspaceId, activeWorkspaceElement: { tabsContainer: { firstChild: null } } } };
  globalThis.document = {
    querySelector: (selector) => {
      const label = selector.match(/\[label="([^"]*)"\]/)?.[1];
      return groups.find((group) => group.isConnected && group.getAttribute("label") === label) || null;
    },
    querySelectorAll: (selector) => {
      const label = selector.match(/\[label="([^"]*)"\]/)?.[1];
      return groups.filter((group) => group.isConnected && (!label || group.getAttribute("label") === label));
    },
  };
  globalThis.gBrowser = {
    tabs,
    ungroupTab: (tab) => { calls.push({ type: "ungroup", tab }); detach(tab); },
    addTabGroup: (members, options) => {
      calls.push({ type: "create", members, options });
      const failure = createFailure?.(options.label);
      if (failure === "throw") throw new Error("Injected group creation failure");
      if (failure === "null") return null;
      const group = makeGroup(options.label, { color: options.color });
      for (const tab of members) attach(tab, group);
      return group;
    },
    moveTabToExistingGroup: (tab, group) => {
      calls.push({ type: "move", tab, group });
      const failure = moveFailure?.(group.getAttribute("label"));
      if (failure === "throw-before") throw new Error("Injected move failure");
      if (failure === "noop") return;
      attach(tab, group);
      if (failure === "throw-after") throw new Error("Injected partial move failure");
    },
    moveTabTo: (node, { tabIndex }) => {
      calls.push({ type: "position", node, tabIndex });
      const members = node.members ? [...node.members] : [node];
      for (const tab of members) {
        const index = tabs.indexOf(tab);
        if (index >= 0) tabs.splice(index, 1);
      }
      tabs.splice(tabIndex, 0, ...members);
    },
  };
  const cleanup = () => {
    delete globalThis.Services; delete globalThis.window; delete globalThis.document; delete globalThis.gBrowser;
  };
  return { groups, tabs, makeGroup, makeTab, calls, writes, prefs, cleanup };
};

export const withBrowser = (options, callback) => {
  const browser = makeBrowser(options);
  try { return callback(browser); } finally { browser.cleanup(); }
};
