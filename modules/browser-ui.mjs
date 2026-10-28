// OpenTabSort Zen — browser-context UI: tidy button, command, workspace hooks.

import { CONFIG, LOG } from "./config.mjs";
import { domCache } from "./tabs.mjs";
const handleOrganizeClick = async () => (await import("./click-handler.mjs")).handleOrganizeClick();

// Lucide "wand-sparkles" — the magic wand with a sparkle around the tip.
// Inline SVG (not an icon-font / external file) so it inherits currentColor from
// the toolbar theme and animates cleanly with the .zao-wiggling class.
const WAND_ICON_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
       fill="none" stroke="currentColor" stroke-width="2"
       stroke-linecap="round" stroke-linejoin="round">
    <path d="M15 4V2"/>
    <path d="M15 16v-2"/>
    <path d="M8 9h2"/>
    <path d="M20 9h2"/>
    <path d="M17.8 11.8 19 13"/>
    <path d="M15 9h.01"/>
    <path d="M17.8 6.2 19 5"/>
    <path d="m3 21 9-9"/>
    <path d="M12.2 6.2 11 5"/>
  </svg>
`;

const buttonXul = () => `
  <toolbarbutton
    id="${CONFIG.BUTTON_ID}"
    command="${CONFIG.COMMAND_ID}"
    label="Organize tabs"
    tooltiptext="Organize tabs in this workspace">
    <hbox class="toolbarbutton-box" align="center">
      ${WAND_ICON_SVG}
    </hbox>
  </toolbarbutton>
`;

const ensureOrganizeButton = (separator) => {
  if (!separator || separator.querySelector(`#${CONFIG.BUTTON_ID}`)) return;

  try {
    // Position before the native clear button if it exists (matches Tidy Tabs).
    const nativeClearButton = separator.querySelector(
      ".zen-workspace-close-unpinned-tabs-button"
    );

    const buttonFragment = window.MozXULElement.parseXULToFragment(buttonXul());
    const button = buttonFragment.firstChild;
    if (nativeClearButton) {
      separator.insertBefore(button, nativeClearButton);
    } else {
      separator.appendChild(button);
    }
  } catch (e) {
    console.error(`${LOG} ensureOrganizeButton error:`, e);
  }
};

export const addButtonToAllSeparators = () => {
  const separators = domCache.getSeparators();
  if (separators.length > 0) {
    separators.forEach(ensureOrganizeButton);
  } else {
    const periphery = document.querySelector("#tabbrowser-arrowscrollbox-periphery");
    if (periphery && !periphery.querySelector(`#${CONFIG.BUTTON_ID}`)) {
      ensureOrganizeButton(periphery);
    }
  }
};

export const setupCommand = () => {
  const zenCommands = domCache.getCommandSet();
  if (!zenCommands) return;
  if (window._zaoCommandState && window._zaoCommandState.target !== zenCommands) teardownCommand();

  if (!zenCommands.querySelector(`#${CONFIG.COMMAND_ID}`)) {
    try {
      const cmd = window.MozXULElement.parseXULToFragment(
        `<command id="${CONFIG.COMMAND_ID}"/>`
      ).firstChild;
      zenCommands.appendChild(cmd);
    } catch (e) {
      console.error(`${LOG} command create error:`, e);
    }
  }

  // DOM-expando guard rather than a module-level flag — a module re-import
  // (during dev) would reset a module variable, accumulating listeners. The
  // expando survives module reloads because it's pinned to the DOM element.
  if (!zenCommands._zaoCommandListener) {
    const listener = (event) => {
      if (event.target.id === CONFIG.COMMAND_ID) handleOrganizeClick();
    };
    zenCommands.addEventListener("command", listener);
    zenCommands._zaoCommandListener = listener;
  }
  window._zaoCommandState = { target: zenCommands, listener: zenCommands._zaoCommandListener };
};

export const teardownCommand = () => {
  const state = window._zaoCommandState;
  const target = state?.target || domCache.getCommandSet();
  const listener = state?.listener || target?._zaoCommandListener;
  if (target && listener) {
    target.removeEventListener("command", listener);
    if (target._zaoCommandListener === listener) delete target._zaoCommandListener;
  }
  document.querySelectorAll(`#${CONFIG.BUTTON_ID}, #${CONFIG.COMMAND_ID}`).forEach((element) => element.remove());
  delete window._zaoCommandState;
  domCache.invalidate();
};

// Re-inject the tidy button on workspace changes (the separator element changes per workspace).
export const setupWorkspaceHooks = () => {
  const owner = window.gZenWorkspaces;
  if (!owner || owner._zaoHooksInstalled) return;
  if (window._zaoWorkspaceHooks) teardownWorkspaceHooks();
  const state = { owner, active: true, hooks: new Map() };
  window._zaoWorkspaceHooks = state;
  owner._zaoHooksInstalled = state;
  try {
    for (const name of ["onTabBrowserInserted", "updateTabsContainers"]) {
      const descriptor = Object.getOwnPropertyDescriptor(owner, name);
      const original = owner[name];
      const wrapper = function (...args) {
        const result = typeof original === "function" ? original.apply(this, args) : undefined;
        if (state.active) {
          domCache.invalidate();
          addButtonToAllSeparators();
        }
        return result;
      };
      owner[name] = wrapper;
      state.hooks.set(name, { descriptor, wrapper });
    }
  } catch (error) {
    teardownWorkspaceHooks();
    throw error;
  }
};

export const teardownWorkspaceHooks = () => {
  const state = window._zaoWorkspaceHooks;
  if (!state) return;
  state.active = false;
  for (const [name, { descriptor, wrapper }] of state.hooks) {
    // A later mod may have wrapped/replaced our hook. Leave its method intact;
    // our inactive wrapper remains a transparent call-through in that chain.
    if (state.owner[name] !== wrapper) continue;
    if (descriptor) Object.defineProperty(state.owner, name, descriptor);
    else delete state.owner[name];
  }
  if (state.owner._zaoHooksInstalled === state) delete state.owner._zaoHooksInstalled;
  delete window._zaoWorkspaceHooks;
  domCache.invalidate();
};
