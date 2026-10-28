import { h } from "./config.mjs";
import { showSortProgress } from "./operation-ui.mjs";
import { CATEGORY_LIMIT, parseCategories, readSavedCategories, writeSavedCategories } from "./jev-categories.mjs";

const button = (text, action) => {
  const element = h("button", { text });
  element.type = "button";
  element.addEventListener("click", action);
  return element;
};

export const buildCategoryEditor = (categories, { onSave, saveLabel = "Save categories", allowEmpty = false, initialDirty = false } = {}) => {
  let draft = categories.map((category) => ({ ...category }));
  let dirty = initialDirty;
  const root = h("div", { class: "zao-category-editor" });
  root._zaoIsDirty = () => dirty;
  root._zaoGetDraft = () => draft.map((category) => ({ ...category }));
  const list = h("div", { class: "zao-category-list" });
  const error = h("p", { class: "zao-category-error" });
  error.setAttribute("role", "alert");
  const render = () => {
    list.replaceChildren();
    draft.forEach((category, index) => {
      const row = h("div", { class: "zao-category-row" });
      const name = h("input"); name.type = "text"; name.value = category.name; name.maxLength = 80;
      name.placeholder = "Category name"; name.setAttribute("aria-label", `Category ${index + 1} name`);
      name.addEventListener("input", () => { category.name = name.value; dirty = true; });
      const description = h("textarea"); description.value = category.description; description.maxLength = 600; description.rows = 2;
      description.placeholder = "What belongs here, and what belongs elsewhere?";
      description.setAttribute("aria-label", `Category ${index + 1} description`);
      description.addEventListener("input", () => { category.description = description.value; dirty = true; });
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
        draft.splice(index, 1); dirty = true; render();
      });
      controls.append(merge, button("Remove", () => { draft.splice(index, 1); dirty = true; render(); }));
      row.append(name, description, controls); list.appendChild(row);
    });
    add.disabled = draft.length >= CATEGORY_LIMIT;
  };
  const add = button("Add category", () => {
    draft.push({ name: "", description: "", examples: [] }); dirty = true; render();
    list.lastElementChild?.querySelector("input")?.focus();
  });
  const save = button(saveLabel, () => {
    try { const parsed = !draft.length && allowEmpty ? [] : parseCategories(draft); error.textContent = ""; onSave?.(parsed); dirty = false; }
    catch (e) { error.textContent = e.message; }
  });
  const actions = h("div", { class: "zao-category-controls" }); actions.append(add, save);
  root.append(list, error, actions); render();
  return root;
};

export const buildSavedCategoryEditor = () => {
  const currentWorkspace = () => (window.gZenWorkspaces ? window : Services.wm.getMostRecentWindow("navigator:browser"))?.gZenWorkspaces?.activeWorkspace;
  const root = h("section", { class: "zao-jev-category-settings" });
  root.appendChild(h("h3", { text: "Categories for this workspace" }));
  root.appendChild(h("p", { text: "Save category meanings for fast cleanup. Empty categories are suggested automatically on the next sort unless you choose Define my own." }));
  const feedback = h("p"); feedback.setAttribute("role", "status");
  const editorHost = h("div"); root.appendChild(editorHost);
  const drafts = new Map();
  let renderedWorkspace;
  root._zaoRefresh = () => {
    const workspaceId = currentWorkspace();
    const previous = editorHost.firstElementChild;
    if (previous?._zaoIsDirty()) {
      if (renderedWorkspace === workspaceId) return;
      drafts.set(renderedWorkspace, previous._zaoGetDraft());
    }
    renderedWorkspace = workspaceId;
    feedback.textContent = "";
    const draft = drafts.get(workspaceId);
    const editor = buildCategoryEditor(draft || readSavedCategories(Services.prefs, workspaceId), { allowEmpty: true, initialDirty: Boolean(draft),
      onSave: (categories) => {
        if (!workspaceId || currentWorkspace() !== workspaceId) throw new Error("The workspace changed. Reopen settings to edit its categories.");
        writeSavedCategories(Services.prefs, workspaceId, categories);
        drafts.delete(workspaceId);
        feedback.textContent = "Categories saved.";
      },
    });
    editorHost.replaceChildren(editor);
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
  modal.appendChild(h("p", { text: "Rename, merge, or adjust the descriptions before the decision model assigns tabs." }));
  modal.appendChild(buildCategoryEditor(categories, { saveLabel: "Sort now", onSave: finish }));
  modal.appendChild(button("Cancel", () => finish(null)));
  modal.addEventListener("cancel", (event) => { event.preventDefault(); finish(null); });
  modal.addEventListener("close", () => finish(null));
  document.documentElement.appendChild(modal);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) { finish(null); return; }
  try { modal.showModal(); } catch { finish(null); }
});

export const showJevProgress = (onStop, onUndo) => showSortProgress({
  onStop, onUndo, stage: "Preparing categories…", className: "zao-jev-progress",
});

export const highlightSortedTab = (tab) => {
  if (tab === gBrowser.selectedTab || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  tab.animate?.([{ boxShadow: "inset 0 0 0 2px var(--tab-group-color, #77a1e6)", filter: "brightness(1.18)" },
    { boxShadow: "inset 0 0 0 0px transparent", filter: "brightness(1)" }], { duration: 550, easing: "ease-out" });
};
