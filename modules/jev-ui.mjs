import { h } from "./config.mjs";
import { CATEGORY_LIMIT, parseCategories, readSavedCategories, writeSavedCategories } from "./jev-categories.mjs";

const button = (text, action) => {
  const element = h("button", { text });
  element.type = "button";
  element.addEventListener("click", action);
  return element;
};

export const buildCategoryEditor = (categories, { onSave, saveLabel = "Save categories", allowEmpty = false } = {}) => {
  let draft = categories.map((category) => ({ ...category }));
  const root = h("div", { class: "zao-category-editor" });
  const list = h("div", { class: "zao-category-list" });
  const error = h("p", { class: "zao-category-error" });
  error.setAttribute("role", "alert");
  const render = () => {
    list.replaceChildren();
    draft.forEach((category, index) => {
      const row = h("div", { class: "zao-category-row" });
      const name = h("input"); name.type = "text"; name.value = category.name; name.maxLength = 80;
      name.placeholder = "Category name"; name.setAttribute("aria-label", `Category ${index + 1} name`);
      name.addEventListener("input", () => { category.name = name.value; });
      const description = h("textarea"); description.value = category.description; description.maxLength = 600; description.rows = 2;
      description.placeholder = "What belongs here, and what belongs elsewhere?";
      description.setAttribute("aria-label", `Category ${index + 1} description`);
      description.addEventListener("input", () => { category.description = description.value; });
      const controls = h("div", { class: "zao-category-controls" });
      const merge = h("select"); merge.setAttribute("aria-label", `Merge category ${index + 1} into another category`);
      const placeholder = h("option", { text: "Merge into…" }); placeholder.value = ""; merge.appendChild(placeholder);
      draft.forEach((target, targetIndex) => {
        if (targetIndex === index) return;
        const option = h("option", { text: target.name || `Category ${targetIndex + 1}` }); option.value = String(targetIndex); merge.appendChild(option);
      });
      merge.addEventListener("change", () => {
        if (merge.value === "") return;
        const target = draft[Number(merge.value)];
        target.description = `${target.description} ${category.description}`.trim().slice(0, 600);
        target.examples = [...(target.examples || []), ...(category.examples || [])].slice(0, 3);
        draft.splice(index, 1); render();
      });
      controls.append(merge, button("Remove", () => { draft.splice(index, 1); render(); }));
      row.append(name, description, controls); list.appendChild(row);
    });
    add.disabled = draft.length >= CATEGORY_LIMIT;
  };
  const add = button("Add category", () => { draft.push({ name: "", description: "", examples: [] }); render(); });
  const save = button(saveLabel, () => {
    try { const parsed = !draft.length && allowEmpty ? [] : parseCategories(draft); error.textContent = ""; onSave?.(parsed); }
    catch (e) { error.textContent = e.message; }
  });
  const actions = h("div", { class: "zao-category-controls" }); actions.append(add, save);
  root.append(list, error, actions); render();
  return root;
};

export const buildSavedCategoryEditor = () => {
  const currentWorkspace = () => (window.gZenWorkspaces ? window : Services.wm.getMostRecentWindow("navigator:browser"))?.gZenWorkspaces?.activeWorkspace;
  const root = h("section", { class: "zao-jev-category-settings" });
  root.appendChild(h("h3", { text: "Jev categories for this workspace" }));
  root.appendChild(h("p", { text: "Save category meanings for fast cleanup. Empty categories are suggested automatically on the next sort unless you choose Define my own." }));
  const feedback = h("p"); feedback.setAttribute("role", "status");
  const editorHost = h("div"); root.appendChild(editorHost);
  root._zaoRefresh = () => {
    const workspaceId = currentWorkspace(); feedback.textContent = "";
    editorHost.replaceChildren(buildCategoryEditor(readSavedCategories(Services.prefs, workspaceId), { allowEmpty: true,
      onSave: (categories) => {
        if (!workspaceId || currentWorkspace() !== workspaceId) throw new Error("The workspace changed. Reopen settings to edit its categories.");
        writeSavedCategories(Services.prefs, workspaceId, categories); feedback.textContent = "Categories saved.";
      },
    }));
  };
  root._zaoRefresh();
  root.appendChild(feedback);
  return root;
};

export const previewCategories = (categories, signal) => new Promise((resolve) => {
  const previousFocus = document.activeElement;
  const modal = h("dialog", { class: "zao-jev-preview" });
  let settled = false;
  const finish = (result) => {
    if (settled) return;
    settled = true; signal?.removeEventListener("abort", abort);
    if (modal.open) modal.close(); modal.remove(); previousFocus?.focus(); resolve(result);
  };
  const abort = () => finish(null);
  modal.appendChild(h("h3", { text: "Categories for this sort" }));
  modal.appendChild(h("p", { text: "Rename, merge, or adjust the descriptions before Jev assigns tabs." }));
  modal.appendChild(buildCategoryEditor(categories, { saveLabel: "Sort now", onSave: finish }));
  modal.appendChild(button("Cancel", () => finish(null)));
  modal.addEventListener("cancel", (event) => { event.preventDefault(); finish(null); });
  modal.addEventListener("close", () => finish(null));
  document.documentElement.appendChild(modal);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) { finish(null); return; }
  try { modal.showModal(); } catch { finish(null); }
});

export const showJevProgress = (onStop, onUndo) => {
  document.querySelector(".zao-jev-progress")?.remove();
  const root = h("div", { class: "zao-jev-progress" });
  const status = h("span", { text: "Preparing categories…" }); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const meter = h("progress"); meter.max = 1; meter.removeAttribute("value"); meter.setAttribute("aria-label", "Tab sorting progress");
  const stop = button("Stop", onStop);
  const undo = button("Undo sort", () => { onUndo(); }); undo.hidden = true;
  const dismiss = button("Dismiss", () => root.remove()); dismiss.hidden = true;
  root.append(status, meter, stop, undo, dismiss);
  const sidebarWidth = window.gZenWorkspaces?.activeWorkspaceElement?.getBoundingClientRect().width ||
    document.getElementById("zen-sidebar")?.getBoundingClientRect().width || 320;
  root.style.width = `${Math.max(160, Math.min(290, sidebarWidth - 32))}px`;
  // Toolbar ancestors clip descendants, including position:fixed panels.
  document.documentElement.appendChild(root);
  return {
    update: ({ processed, total, moved, skipped, unresolved }) => {
      status.textContent = `Organizing · ${processed} / ${total} · ${moved} moved${skipped + unresolved ? ` · ${skipped + unresolved} kept` : ""}`;
      meter.max = total; meter.value = processed;
    },
    stage: (text) => { status.textContent = text; },
    finish: (message, canUndo) => { status.textContent = message; meter.hidden = true; stop.hidden = true; undo.hidden = !canUndo; dismiss.hidden = false; },
    remove: () => root.remove(),
  };
};

export const highlightSortedTab = (tab) => {
  if (tab === gBrowser.selectedTab || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  tab.animate?.([{ boxShadow: "inset 0 0 0 2px var(--tab-group-color, #77a1e6)", filter: "brightness(1.18)" },
    { boxShadow: "inset 0 0 0 0px transparent", filter: "brightness(1)" }], { duration: 550, easing: "ease-out" });
};
