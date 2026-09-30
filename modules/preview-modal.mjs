// Zen Tab Wand — AI grouping preview modal.
//
// Interactive modal that lets the user review the AI's proposed groupings
// before they're applied. Used both for Preview Only (identify-only) and as a
// confirmation step in Preview + Save Rule / Move + Save Domain modes (so the user can
// veto rule mutations before they hit the table).
//
// Features:
//   - Toggle each proposed NEW group keep/skip (accent fill = kept).
//   - Toggle each "→ Existing" target keep/skip (same UX, dimmed border).
//   - "Re-assign to planned" — pending tabs get classified into one of the
//     CURRENTLY-KEPT groups in this modal (constrained vocabulary).
//   - "Re-assign to existing" — pending tabs get classified into one of the
//     user's defined RULES (regardless of what's kept in the modal). Useful
//     for pulling a tab into a rule-named group the AI didn't propose.
//   - "Re-assign to new" — open-ended clustering, may invent new categories.
//   - Apply commits ONLY kept items; unkept tabs become skipped.
//   - Cancel returns null; caller does nothing.
//
// State model: `kept` is a Set of prefixed keys —
//   "new:<lowercase-name>"      for newGroups entries
//   "existing:<lowercase-name>" for assignedToExisting target groups
// This avoids collisions when the AI proposes a new group with the same name
// as an existing rule (rare but possible in Preview + Save Rule mode).

import { LOG, h } from "./config.mjs";

const newKey = (name) => `new:${name.toLowerCase()}`;
const existingKey = (name) => `existing:${name.toLowerCase()}`;
const titleKey = (name) => `title:${name.toLowerCase()}`;

// Accept only tabs from the pending pool, using the live tab reference rather
// than a provider-supplied id. Missing/invalid responses remain unresolved;
// explicit model skips and user choices are tracked separately.
export const sanitizePreviewReassignment = (pending, result, {
  newGroups = false, allowedNames, reservedNames = [],
} = {}) => {
  const identity = (tab) => tab?._tab || tab;
  const remaining = new Map(pending.map((tab) => [identity(tab), tab]));
  const invalid = new Set();
  const usedNames = new Set(reservedNames.map((name) => name.toLowerCase()));
  const canonicalNames = allowedNames && new Map(allowedNames.map((name) => [name.toLowerCase(), name]));
  const out = { newGroups: [], assignments: [], skipped: [], unresolved: [], failed: result?.failed };
  const take = (tab) => {
    const key = identity(tab);
    const original = remaining.get(key);
    if (original) remaining.delete(key);
    return original;
  };
  if (newGroups) {
    for (const group of Array.isArray(result?.newGroups) ? result.newGroups : []) {
      const name = typeof group?.name === "string" ? group.name.trim() : "";
      if (!name) {
        for (const tab of Array.isArray(group?.tabs) ? group.tabs : []) invalid.add(identity(tab));
        continue;
      }
      const tabs = (Array.isArray(group.tabs) ? group.tabs : []).map(take).filter(Boolean);
      if (!tabs.length) continue;
      let uniqueName = name;
      for (let n = 2; usedNames.has(uniqueName.toLowerCase()); n++) uniqueName = `${name} (${n})`;
      usedNames.add(uniqueName.toLowerCase());
      out.newGroups.push({ ...group, name: uniqueName, tabs });
    }
  } else {
    for (const assignment of Array.isArray(result?.assignments) ? result.assignments : []) {
      const name = typeof assignment?.groupName === "string" ? assignment.groupName.trim() : "";
      const canonical = canonicalNames ? canonicalNames.get(name.toLowerCase()) : name;
      if (!canonical) { invalid.add(identity(assignment?.tabInfo)); continue; }
      const tabInfo = take(assignment.tabInfo);
      if (tabInfo) out.assignments.push({ ...assignment, tabInfo, groupName: canonical });
    }
  }
  for (const tab of Array.isArray(result?.skipped) ? result.skipped : []) {
    if (invalid.has(identity(tab))) continue;
    const original = take(tab);
    if (original) out.skipped.push(original);
  }
  out.unresolved = [...remaining.values()];
  return out;
};

const clonePlan = (p) => ({
  assignedToExisting: (p.assignedToExisting || []).map((a) => ({ ...a })),
  newGroups: (p.newGroups || []).map((g) => ({ name: g.name, tabs: [...g.tabs] })),
  rulePatches: (p.rulePatches || []).map((patch) => ({
    groupName: patch.groupName,
    titleTerms: (patch.titleTerms || []).map((t) => ({ ...t, skipped: Boolean(t.skipped) })),
  })),
  skipped: [...(p.skipped || [])],
  unresolved: [...(p.unresolved || [])],
  failed: p.failed,
});

// Group the assignedToExisting array by target groupName into the same
// { name, tabs } shape as newGroups, so we can render them uniformly.
const groupExistingByTarget = (assignedToExisting) => {
  const byName = new Map();
  for (const a of assignedToExisting) {
    const k = a.groupName.toLowerCase();
    if (!byName.has(k)) byName.set(k, { name: a.groupName, tabs: [] });
    byName.get(k).tabs.push(a.tabInfo);
  }
  return [...byName.values()];
};

/**
 * Show the AI plan as an interactive modal.
 *
 * @param {object} args
 * @param {Plan} args.plan
 * @param {string[]} [args.existingNames] Known existing targets; also reserved
 *   when reassigning to new groups so their names cannot collide.
 * @param {(pending) => Promise<{newGroups,skipped}>}   [args.onReassignToNew]
 * @param {(pending,buckets) => Promise<{assignments,skipped}>} [args.onAssignToPlanned]
 *   `buckets` is the modal's currently-kept groups (new + existing-target).
 * @param {(pending) => Promise<{assignments,skipped}>} [args.onAssignToExisting]
 *   Classifies pending tabs against the user's full rules table (regardless
 *   of what's kept in the modal). Lets the user route a pending tab into a
 *   rule-defined group that the AI didn't propose this run.
 *
 * @returns {Promise<Plan | null>} The filtered plan to apply, or null on cancel.
 */
export const showPreviewModal = ({ plan, existingNames, onReassignToNew, onAssignToPlanned, onAssignToExisting }) =>
  new Promise((resolve) => {
    let currentPlan = clonePlan(plan);
    let reassigning = false;
    // Default: every entry is kept.
    const kept = new Set();
    for (const g of currentPlan.newGroups) kept.add(newKey(g.name));
    for (const a of currentPlan.assignedToExisting) kept.add(existingKey(a.groupName));
    for (const patch of currentPlan.rulePatches) kept.add(titleKey(patch.groupName));

    const dialog = h("dialog", { class: "zao-preview-dialog" });

    // ─── Header ────────────────────────────────────────────────────────────
    const header = h("div", { class: "zao-preview-header" });
    header.appendChild(h("h2", { class: "zao-preview-title", text: "AI grouping preview" }));
    const closeBtn = h("button", { class: "zao-preview-close" });
    closeBtn.setAttribute("type", "button");
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => cleanup(null));
    header.appendChild(closeBtn);
    dialog.appendChild(header);

    const body = h("div", { class: "zao-preview-body" });
    dialog.appendChild(body);

    // ─── Footer ────────────────────────────────────────────────────────────
    const footer = h("div", { class: "zao-preview-footer" });
    const footerLeft = h("div", { class: "zao-preview-footer-left" });
    const footerRight = h("div", { class: "zao-preview-footer-right" });

    const reassignToPlannedBtn = h("button", { class: "zao-preview-btn zao-preview-btn-reassign" });
    reassignToPlannedBtn.setAttribute("type", "button");
    reassignToPlannedBtn.textContent = "Re-assign to planned";
    reassignToPlannedBtn.addEventListener("click", onReassignToPlannedClick);
    footerLeft.appendChild(reassignToPlannedBtn);

    const reassignToExistingBtn = h("button", { class: "zao-preview-btn zao-preview-btn-reassign" });
    reassignToExistingBtn.setAttribute("type", "button");
    reassignToExistingBtn.textContent = "Re-assign to existing";
    reassignToExistingBtn.addEventListener("click", onReassignToExistingClick);
    footerLeft.appendChild(reassignToExistingBtn);

    const reassignToNewBtn = h("button", { class: "zao-preview-btn zao-preview-btn-reassign" });
    reassignToNewBtn.setAttribute("type", "button");
    reassignToNewBtn.textContent = "Re-assign to new";
    reassignToNewBtn.addEventListener("click", onReassignToNewClick);
    footerLeft.appendChild(reassignToNewBtn);

    const cancelBtn = h("button", { class: "zao-preview-btn zao-preview-btn-cancel" });
    cancelBtn.setAttribute("type", "button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => cleanup(null));
    footerRight.appendChild(cancelBtn);

    const applyBtn = h("button", { class: "zao-preview-btn zao-preview-btn-apply" });
    applyBtn.setAttribute("type", "button");
    applyBtn.textContent = "Apply";
    applyBtn.addEventListener("click", onApplyClick);
    footerRight.appendChild(applyBtn);

    footer.appendChild(footerLeft);
    footer.appendChild(footerRight);
    dialog.appendChild(footer);

    // ─── Rendering ─────────────────────────────────────────────────────────
    function render() {
      while (body.firstChild) body.firstChild.remove();

      const existingTargets = groupExistingByTarget(currentPlan.assignedToExisting);
      const totalKept = countKept(existingTargets);
      const totalGroups = currentPlan.newGroups.length + existingTargets.length + currentPlan.rulePatches.length;
      const skippedCount = currentPlan.skipped.length + currentPlan.unresolved.length;
      const pendingForReassign = pendingTabs(existingTargets).length;
      const proposalLabel = currentPlan.rulePatches.length > 0 ? "proposal(s)" : "group(s)";

      const summaryText =
        totalGroups === 0 && skippedCount === 0
          ? "The AI found nothing to group."
          : `${totalKept}/${totalGroups} ${proposalLabel} kept · ${skippedCount} tab(s) unchanged`;
      body.appendChild(h("p", { class: "zao-preview-summary", text: summaryText }));

      if (currentPlan.newGroups.length > 0) {
        const sec = h("section", { class: "zao-preview-section" });
        sec.appendChild(h("h3", { class: "zao-preview-section-title", text: "Proposed new groups — click to keep / skip" }));
        for (const g of currentPlan.newGroups) {
          sec.appendChild(renderGroupBlock(g, "new"));
        }
        body.appendChild(sec);
      }

      if (existingTargets.length > 0) {
        const sec = h("section", { class: "zao-preview-section" });
        sec.appendChild(h("h3", {
          class: "zao-preview-section-title",
          text: "Into existing groups — click to keep / skip",
        }));
        for (const t of existingTargets) {
          sec.appendChild(renderGroupBlock(t, "existing"));
        }
        body.appendChild(sec);
      }

      if (currentPlan.rulePatches.length > 0) {
        const sec = h("section", { class: "zao-preview-section" });
        sec.appendChild(h("h3", {
          class: "zao-preview-section-title",
          text: "Proposed title rules — click to keep / skip",
        }));
        for (const patch of currentPlan.rulePatches) {
          sec.appendChild(renderTitleRuleBlock(patch));
        }
        body.appendChild(sec);
      }

      if (skippedCount > 0) {
        const sec = h("section", { class: "zao-preview-section zao-preview-skipped" });
        sec.appendChild(h("h3", {
          class: "zao-preview-section-title",
          text: `Skipped (${skippedCount}) — will remain in place`,
        }));
        const ul = h("ul", { class: "zao-preview-tab-list" });
        for (const t of [...currentPlan.skipped, ...currentPlan.unresolved]) ul.appendChild(renderTabRow(t));
        sec.appendChild(ul);
        body.appendChild(sec);
      }

      // Re-assign-to-planned: needs pending tabs AND at least one kept group
      //   in this modal to assign INTO.
      // Re-assign-to-existing: needs pending tabs AND the caller's callback
      //   (which classifies against the user's full rules table, regardless
      //   of what's kept in the modal).
      // Re-assign-to-new: just needs pending tabs.
      const keptGroupCount = keptBuckets().length;
      reassignToPlannedBtn.disabled =
        pendingForReassign === 0 || keptGroupCount === 0 || typeof onAssignToPlanned !== "function";
      reassignToPlannedBtn.title =
        pendingForReassign === 0 ? "Nothing to re-assign — every tab is in a kept group"
        : keptGroupCount === 0 ? "No kept groups to assign into — keep at least one first"
        : `Try fitting ${pendingForReassign} unkept tab(s) into your ${keptGroupCount} kept group(s)`;
      reassignToExistingBtn.disabled =
        pendingForReassign === 0 || typeof onAssignToExisting !== "function";
      reassignToExistingBtn.title =
        pendingForReassign === 0 ? "Nothing to re-assign — every tab is in a kept group"
        : typeof onAssignToExisting !== "function" ? "No existing rule groups to assign into"
        : `Try fitting ${pendingForReassign} unkept tab(s) into one of your existing rule groups`;
      reassignToNewBtn.disabled = pendingForReassign === 0 || typeof onReassignToNew !== "function";
      reassignToNewBtn.title = pendingForReassign === 0
        ? "Nothing to re-assign — every tab is in a kept group"
        : `Cluster ${pendingForReassign} unkept tab(s) into fresh new categories`;
    }

    function renderGroupBlock(g, kind) {
      const key = kind === "new" ? newKey(g.name) : existingKey(g.name);
      const isKept = kept.has(key);
      const classes = ["zao-preview-group"];
      if (isKept) classes.push("zao-kept");
      if (kind === "existing") classes.push("zao-preview-group-existing");
      const block = h("div", { class: classes.join(" ") });
      block.setAttribute("role", "button");
      block.setAttribute("aria-pressed", isKept ? "true" : "false");
      block.tabIndex = 0;
      block.addEventListener("click", () => {
        if (reassigning) return;
        if (isKept) kept.delete(key);
        else kept.add(key);
        render();
      });
      block.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          block.click();
        }
      });

      const head = h("div", { class: "zao-preview-group-head" });
      const prefix = kind === "existing" ? "→ " : "";
      head.appendChild(h("span", {
        class: "zao-preview-group-name",
        text: `${prefix}${g.name} (${g.tabs.length})`,
      }));
      head.appendChild(h("span", {
        class: "zao-preview-group-state",
        text: isKept ? "✓ keep" : "skip",
      }));
      block.appendChild(head);

      const ul = h("ul", { class: "zao-preview-tab-list" });
      for (const t of g.tabs) ul.appendChild(renderTabRow(t));
      block.appendChild(ul);
      return block;
    }

    function renderTitleRuleBlock(patch) {
      const key = titleKey(patch.groupName);
      const isKept = kept.has(key);
      const classes = ["zao-preview-group", "zao-preview-title-rule"];
      if (isKept) classes.push("zao-kept");
      const block = h("div", { class: classes.join(" ") });
      block.setAttribute("role", "button");
      block.setAttribute("aria-pressed", isKept ? "true" : "false");
      block.tabIndex = 0;
      block.addEventListener("click", () => {
        if (reassigning) return;
        if (isKept) kept.delete(key);
        else kept.add(key);
        render();
      });
      block.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          block.click();
        }
      });

      const head = h("div", { class: "zao-preview-group-head" });
      head.appendChild(h("span", {
        class: "zao-preview-group-name",
        text: `${patch.groupName} (${activeTitleTerms(patch).length}/${patch.titleTerms.length} title ${patch.titleTerms.length === 1 ? "term" : "terms"})`,
      }));
      head.appendChild(h("span", {
        class: "zao-preview-group-state",
        text: isKept ? "✓ keep" : "skip",
      }));
      block.appendChild(head);
      block.appendChild(renderRulePatch(patch));
      return block;
    }

    function renderRulePatch(patch) {
      const wrap = h("div", { class: "zao-preview-rule-patches" });
      for (const item of patch.titleTerms || []) {
        const pill = h("button", { class: `zao-pill zao-title-pill zao-preview-title-chip${item.warning ? " zao-preview-title-chip-warning" : ""}${item.skipped ? " zao-preview-title-chip-skipped" : ""}` });
        pill.type = "button";
        pill.setAttribute("aria-pressed", item.skipped ? "false" : "true");
        pill.addEventListener("click", (e) => {
          e.stopPropagation();
          if (reassigning) return;
          item.skipped = !item.skipped;
          render();
        });
        pill.addEventListener("keydown", (e) => {
          e.stopPropagation();
        });
        if (item.warning) pill.title = item.warning;
        pill.appendChild(h("span", { class: "zao-pill-kind", text: "T" }));
        pill.appendChild(h("span", { text: item.term }));
        wrap.appendChild(pill);
      }
      return wrap;
    }

    function activeTitleTerms(patch) {
      return (patch.titleTerms || []).filter((item) => !item.skipped);
    }

    function renderTabRow(tabInfo) {
      const li = h("li", { class: "zao-preview-tab" });
      li.appendChild(h("span", { class: "zao-preview-tab-host", text: tabInfo.hostname || "(no host)" }));
      const title = (tabInfo.title || "").replace(/\s+/g, " ").trim();
      if (title) li.appendChild(h("span", { class: "zao-preview-tab-title", text: ` — ${title}` }));
      return li;
    }

    // ─── State helpers ─────────────────────────────────────────────────────
    function countKept(existingTargets) {
      let n = 0;
      for (const g of currentPlan.newGroups) if (kept.has(newKey(g.name))) n++;
      for (const t of existingTargets) if (kept.has(existingKey(t.name))) n++;
      for (const patch of currentPlan.rulePatches) if (kept.has(titleKey(patch.groupName))) n++;
      return n;
    }

    // Tabs eligible for re-assign: from un-kept new groups + un-kept existing
    // targets + currently-skipped tabs.
    function pendingTabs(existingTargets = groupExistingByTarget(currentPlan.assignedToExisting)) {
      const fromUnkeptNew = currentPlan.newGroups
        .filter((g) => !kept.has(newKey(g.name)))
        .flatMap((g) => g.tabs);
      const fromUnkeptExisting = existingTargets
        .filter((t) => !kept.has(existingKey(t.name)))
        .flatMap((t) => t.tabs);
      return [...new Map([...fromUnkeptNew, ...fromUnkeptExisting, ...currentPlan.skipped, ...currentPlan.unresolved]
        .map((tab) => [tab?._tab || tab, tab])).values()];
    }

    // All currently-kept "buckets" the AI can sort INTO, in unified { name, tabs }
    // shape. Includes both proposed new groups and existing-target groupings.
    function keptBuckets() {
      const existingTargets = groupExistingByTarget(currentPlan.assignedToExisting);
      const out = [];
      for (const g of currentPlan.newGroups) if (kept.has(newKey(g.name))) out.push(g);
      for (const t of existingTargets) if (kept.has(existingKey(t.name))) out.push(t);
      return out;
    }

    // ─── Spinner-wrapped action runner ─────────────────────────────────────
    async function runWithSpinner(fn) {
      reassigning = true;
      const reassignButtons = [reassignToPlannedBtn, reassignToExistingBtn, reassignToNewBtn];
      const allBtns = [...reassignButtons, cancelBtn, applyBtn];
      const wasDisabled = allBtns.map((b) => b.disabled);
      for (const b of allBtns) b.disabled = true;
      const originalTexts = reassignButtons.map((b) => b.textContent);
      const spinners = [];
      for (const b of reassignButtons) {
        b.textContent = "";
        const s = h("span", { class: "zao-spinner" });
        s.setAttribute("aria-label", "Working");
        b.appendChild(s);
        spinners.push(s);
      }
      try {
        await fn();
      } catch (e) {
        console.error(`${LOG} preview modal: action failed:`, e);
      } finally {
        reassigning = false;
        for (const s of spinners) s.remove();
        for (let i = 0; i < reassignButtons.length; i++) reassignButtons[i].textContent = originalTexts[i];
        for (let i = 0; i < allBtns.length; i++) allBtns[i].disabled = wasDisabled[i];
        render();
      }
    }

    // ─── Re-assign handlers ────────────────────────────────────────────────
    async function onReassignToNewClick() {
      if (reassignToNewBtn.disabled) return;
      const pending = pendingTabs();
      if (pending.length === 0) return;
      if (typeof onReassignToNew !== "function") return;
      await runWithSpinner(async () => {
        const result = sanitizePreviewReassignment(pending, await onReassignToNew(pending), {
          newGroups: true,
          reservedNames: [
            ...(existingNames || []),
            ...keptBuckets().map((group) => group.name),
            ...currentPlan.assignedToExisting.map((assignment) => assignment.groupName),
            ...currentPlan.rulePatches.map((patch) => patch.groupName),
          ],
        });
        if (done) return;
        const incomingGroups = result.newGroups;
        const newSkipped = result.skipped;

        // Drop un-kept new groups + un-kept existing-target assignments —
        // their tabs were the "pending" set, now redistributed.
        currentPlan.newGroups = currentPlan.newGroups.filter((g) => kept.has(newKey(g.name)));
        currentPlan.assignedToExisting = currentPlan.assignedToExisting.filter((a) =>
          kept.has(existingKey(a.groupName))
        );
        currentPlan.newGroups.push(...incomingGroups);
        currentPlan.skipped = newSkipped;
        currentPlan.unresolved = result.unresolved;
        currentPlan.failed = result.failed || currentPlan.failed;
        // Auto-keep the newly proposed groups.
        for (const g of incomingGroups) kept.add(newKey(g.name));
        console.log(`${LOG} preview modal: re-assigned ${pending.length} tab(s) to new → ${incomingGroups.length} new group(s), ${newSkipped.length} skipped`);
      });
    }

    async function onReassignToPlannedClick() {
      if (reassignToPlannedBtn.disabled) return;
      const pending = pendingTabs();
      if (pending.length === 0) return;
      const buckets = keptBuckets();
      if (buckets.length === 0) return;
      if (typeof onAssignToPlanned !== "function") return;

      await runWithSpinner(async () => {
        const result = sanitizePreviewReassignment(pending, await onAssignToPlanned(pending, buckets), {
          allowedNames: buckets.map((bucket) => bucket.name),
        });
        if (done) return;
        const assignments = result.assignments;
        const newSkipped = result.skipped;

        // Index the kept buckets so we can route assignments back into
        // either newGroups (if matched to a kept new bucket) or
        // assignedToExisting (if matched to a kept existing-target bucket).
        const newByLower = new Map();
        const existingByLower = new Set();
        for (const g of currentPlan.newGroups) {
          if (kept.has(newKey(g.name))) newByLower.set(g.name.toLowerCase(), g);
        }
        for (const a of currentPlan.assignedToExisting) {
          if (kept.has(existingKey(a.groupName))) existingByLower.add(a.groupName.toLowerCase());
        }

        // First, drop un-kept newGroups + un-kept existing-target assignments —
        // their tabs were in the pending pool and are about to be redistributed.
        currentPlan.newGroups = currentPlan.newGroups.filter((g) => kept.has(newKey(g.name)));
        currentPlan.assignedToExisting = currentPlan.assignedToExisting.filter((a) =>
          kept.has(existingKey(a.groupName))
        );

        let placed = 0;
        for (const { tabInfo, groupName } of assignments) {
          const lower = String(groupName || "").toLowerCase();
          // Prefer matching a kept new bucket first, then a kept existing one.
          if (newByLower.has(lower)) {
            newByLower.get(lower).tabs.push(tabInfo);
            placed++;
          } else if (existingByLower.has(lower)) {
            // Find the canonical-case group name to reuse.
            const canonical = [...currentPlan.assignedToExisting].find(
              (a) => a.groupName.toLowerCase() === lower
            )?.groupName || groupName;
            currentPlan.assignedToExisting.push({ tabInfo, groupName: canonical, similarity: 1.0 });
            placed++;
          } else {
            newSkipped.push(tabInfo);
          }
        }
        currentPlan.skipped = newSkipped;
        currentPlan.unresolved = result.unresolved;
        currentPlan.failed = result.failed || currentPlan.failed;
        console.log(`${LOG} preview modal: re-assigned ${pending.length} tab(s) to planned → ${placed} placed, ${newSkipped.length} skipped`);
      });
    }

    async function onReassignToExistingClick() {
      if (reassignToExistingBtn.disabled) return;
      const pending = pendingTabs();
      if (pending.length === 0) return;
      if (typeof onAssignToExisting !== "function") return;

      await runWithSpinner(async () => {
        const result = sanitizePreviewReassignment(pending, await onAssignToExisting(pending), {
          allowedNames: existingNames,
        });
        if (done) return;
        const assignments = result.assignments;
        const newSkipped = result.skipped;

        // Drop un-kept newGroups + un-kept existing-target assignments —
        // their tabs were in the pending pool and are about to be redistributed.
        currentPlan.newGroups = currentPlan.newGroups.filter((g) => kept.has(newKey(g.name)));
        currentPlan.assignedToExisting = currentPlan.assignedToExisting.filter((a) =>
          kept.has(existingKey(a.groupName))
        );

        // Each assignment becomes an entry in assignedToExisting and gets
        // its target marked kept, so the new row renders in the "Into existing
        // groups" section with the right keep state.
        let placed = 0;
        for (const { tabInfo, groupName } of assignments) {
          const name = String(groupName || "").trim();
          if (!name) {
            newSkipped.push(tabInfo);
            continue;
          }
          currentPlan.assignedToExisting.push({ tabInfo, groupName: name, similarity: 1.0 });
          kept.add(existingKey(name));
          placed++;
        }
        currentPlan.skipped = newSkipped;
        currentPlan.unresolved = result.unresolved;
        currentPlan.failed = result.failed || currentPlan.failed;
        console.log(`${LOG} preview modal: re-assigned ${pending.length} tab(s) to existing rules → ${placed} placed, ${newSkipped.length} skipped`);
      });
    }

    // ─── Apply ─────────────────────────────────────────────────────────────
    function onApplyClick() {
      // Keep only the entries the user kept; tabs from unkept entries go to skipped.
      const droppedTabs = [];
      const finalNewGroups = currentPlan.newGroups.filter((g) => {
        if (kept.has(newKey(g.name))) return true;
        droppedTabs.push(...g.tabs);
        return false;
      });
      const finalExisting = currentPlan.assignedToExisting.filter((a) => {
        if (kept.has(existingKey(a.groupName))) return true;
        droppedTabs.push(a.tabInfo);
        return false;
      });
      const finalRulePatches = (currentPlan.rulePatches || [])
        .filter((patch) => kept.has(titleKey(patch.groupName)))
        .map((patch) => ({
          ...patch,
          titleTerms: activeTitleTerms(patch).map((item) => ({ ...item })),
        }))
        .filter((patch) => patch.titleTerms.length > 0);
      cleanup({
        assignedToExisting: finalExisting,
        newGroups: finalNewGroups,
        rulePatches: finalRulePatches,
        skipped: [...currentPlan.skipped, ...droppedTabs],
        unresolved: [...currentPlan.unresolved],
        failed: currentPlan.failed,
      });
    }

    // ─── Cancel paths ──────────────────────────────────────────────────────
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      cleanup(null);
    });
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) cleanup(null);
    });

    // ─── Lifecycle ─────────────────────────────────────────────────────────
    let done = false;
    function cleanup(result) {
      if (done) return;
      done = true;
      try { dialog.close(); } catch {}
      dialog.remove();
      console.log(`${LOG} preview modal closed (apply=${result !== null})`);
      resolve(result);
    }

    render();
    document.body.appendChild(dialog);
    dialog.showModal();
    applyBtn.focus();
    console.log(`${LOG} preview modal opened`);
  });
