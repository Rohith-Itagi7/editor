// The Layers panel: the document as a tree, kept in step with the canvas both ways. Rows
// select (Shift for a range, Mod to toggle), drag to reorder or into another frame, rename on
// double-click, and hide or lock from the icons that show on hover. A chevron collapses a
// frame; Alt on it collapses or expands every frame. Selecting on the canvas opens the rows
// above the selection and scrolls to it, without changing what the user collapsed.
import { icon } from "../ui/icons/toolbar.js";
import { PANEL_ICONS } from "../ui/icons/panel.js";
import { ICON, sized } from "../ui/controls.js";

const ICON_OF = { Frame: "frame", Text: "text", Rectangle: "rectangle" };

/** Row icons for frames: corner marks for a free frame, bars for a flex one. */
function iconFor(node) {
  if (node.component !== "Frame") return icon(ICON_OF[node.component] ?? "frame", "lyr-svg");
  if (node.style.display !== "flex") return PANEL_ICONS.frameRow;
  return node.style.flexDirection === "column" ? PANEL_ICONS.stackRow : `<span class="lyr-turn">${PANEL_ICONS.stackRow}</span>`;
}
const SVG = { chevron: sized(PANEL_ICONS.chevronDown, 10), eye: ICON.eye, eyeOff: ICON.eyeOff, lock: ICON.lock, unlock: ICON.unlock };
// The tree indents 16px a level, with a 20px chevron column and the icon after it.
const INDENT = 16;
const DRAG_START = 4;

export function mountLayers(root, store) {
  root.classList.add("lyr");
  root.tabIndex = 0;
  root.setAttribute("role", "tree");
  root.setAttribute("aria-label", "Layers");
  const indicator = document.createElement("div");
  indicator.className = "lyr-drop";
  // Rows opened only to show the selection; the user's own collapse state stays in the node.
  const revealed = new Set();
  let anchor = null;
  let renaming = null;
  let drag = null;

  const isOpen = (node) => !node.collapsed || revealed.has(node.id);
  const visibleRows = () => [...root.querySelectorAll(".lyr-row")].map((row) => row.dataset.id);

  function setCollapsed(ids, collapsed) {
    const targets = ids.filter((id) => store.children(id).length && !!store.get(id).collapsed !== collapsed);
    ids.forEach((id) => revealed.delete(id));
    if (!targets.length) return render();
    // How the tree is folded is a view of the document, not an edit to undo.
    store.transact(collapsed ? "Collapse layers" : "Expand layers", () => store.update(targets, { collapsed: collapsed || undefined }), { history: false });
  }

  function render() {
    root.innerHTML = "";
    const walk = (node, depth) => {
      const kids = store.children(node.id);
      const open = isOpen(node);
      const li = document.createElement("li");
      li.className = "lyr-row";
      li.dataset.id = node.id;
      li.setAttribute("role", "treeitem");
      li.setAttribute("aria-level", String(depth + 1));
      li.setAttribute("aria-selected", String(store.isSelected(node.id)));
      if (kids.length) li.setAttribute("aria-expanded", String(open));
      if (node.hidden) li.dataset.hidden = "";
      if (node.locked) li.dataset.locked = "";
      if (node.parent == null) li.dataset.root = "";
      if (store.ui.hovered === node.id) li.dataset.hovered = "";
      // A selected row whose parent is selected too reads as part of one block.
      if (store.isSelected(node.id) && node.parent != null && store.ancestors(node.id).some((a) => store.isSelected(a))) li.dataset.inSelection = "";
      // Everything inside a selected frame a step lighter than the frame itself.
      if (!store.isSelected(node.id) && store.ancestors(node.id).some((a) => store.isSelected(a))) li.dataset.parentSelected = "";
      li.style.setProperty("--depth", depth);
      li.innerHTML =
        `<span class="lyr-indent" style="width:${depth * INDENT}px"></span>` +
        `<button type="button" class="lyr-chevron" tabindex="-1" aria-label="${open ? "Collapse" : "Expand"}" ${kids.length ? "" : "hidden"}>${SVG.chevron}</button>` +
        `<span class="lyr-icon">${iconFor(node)}</span>` +
        `<span class="lyr-name"></span>` +
        `<span class="lyr-actions">` +
        `<button type="button" class="lyr-lock" tabindex="-1" aria-label="${node.locked ? "Unlock" : "Lock"}" title="${node.locked ? "Unlock" : "Lock"} (Mod Shift L)" aria-pressed="${!!node.locked}">${node.locked ? SVG.lock : SVG.unlock}</button>` +
        `<button type="button" class="lyr-eye" tabindex="-1" aria-label="${node.hidden ? "Show" : "Hide"}" title="${node.hidden ? "Show" : "Hide"} (Mod Shift H)" aria-pressed="${!!node.hidden}">${node.hidden ? SVG.eyeOff : SVG.eye}</button>` +
        `</span>`;
      li.querySelector(".lyr-name").textContent = node.name;
      root.append(li);
      if (open) kids.forEach((child) => walk(child, depth + 1));
    };
    store.roots().forEach((node) => walk(node, 0));
    root.append(indicator);
    if (renaming) startRename(renaming, { focus: false });
  }

  // ---------- Selecting ----------

  function selectFromRow(id, event) {
    if (event.shiftKey && anchor) {
      const rows = visibleRows();
      const [a, b] = [rows.indexOf(anchor), rows.indexOf(id)].sort((x, y) => x - y);
      if (a >= 0 && b >= 0) return store.select(rows.slice(a, b + 1), { add: event.metaKey || event.ctrlKey });
    }
    anchor = id;
    if (event.metaKey || event.ctrlKey) store.select(id, { toggle: true });
    else store.select(id);
  }

  // ---------- Renaming ----------

  function startRename(id, { focus = true } = {}) {
    const row = root.querySelector(`.lyr-row[data-id="${CSS.escape(id)}"]`);
    const node = store.get(id);
    if (!row || !node) return (renaming = null);
    renaming = id;
    const name = row.querySelector(".lyr-name");
    const input = document.createElement("input");
    input.className = "lyr-rename";
    input.value = node.name;
    input.setAttribute("aria-label", "Layer name");
    name.replaceWith(input);
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      renaming = null;
      const value = input.value.trim();
      if (commit && value && value !== node.name) store.transact("Rename", () => store.update(id, { name: value }));
      else render();
      root.focus();
    };
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") finish(true);
      if (event.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
    input.addEventListener("pointerdown", (event) => event.stopPropagation());
    if (focus) {
      input.focus();
      input.select();
    }
  }

  // ---------- Pointer: select, toggle, drag ----------

  root.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest(".lyr-rename")) return;
    const row = event.target.closest(".lyr-row");
    if (!row) {
      store.select([]);
      return;
    }
    const id = row.dataset.id;
    const node = store.get(id);
    if (event.target.closest(".lyr-chevron")) {
      event.preventDefault();
      if (event.altKey) {
        const parents = store.all().filter((n) => store.children(n.id).length);
        const collapse = isOpen(node);
        revealed.clear();
        setCollapsed(parents.map((n) => n.id), collapse);
      } else setCollapsed([id], isOpen(node));
      return;
    }
    if (event.target.closest(".lyr-eye")) {
      event.preventDefault();
      const ids = store.isSelected(id) ? store.selection() : [id];
      store.transact(node.hidden ? "Show" : "Hide", () => store.update(ids, { hidden: node.hidden ? undefined : true }));
      return;
    }
    if (event.target.closest(".lyr-lock")) {
      event.preventDefault();
      const ids = store.isSelected(id) ? store.selection() : [id];
      store.transact(node.locked ? "Unlock" : "Lock", () => store.update(ids, { locked: node.locked ? undefined : true }));
      return;
    }
    root.focus();
    // A press on a selected row waits: it may start a drag of the whole selection.
    if (!store.isSelected(id) || event.shiftKey || event.metaKey || event.ctrlKey) selectFromRow(id, event);
    drag = { id, startY: event.clientY, started: false, pointerId: event.pointerId, pressedSelected: store.isSelected(id) };
  });

  root.addEventListener("pointermove", (event) => {
    if (!drag) {
      const row = event.target.closest(".lyr-row");
      const id = row?.dataset.id ?? null;
      if (store.ui.hovered !== id) store.setUI({ hovered: id });
      return;
    }
    if (!drag.started) {
      if (Math.abs(event.clientY - drag.startY) < DRAG_START) return;
      drag.started = true;
      root.setPointerCapture(drag.pointerId);
      root.classList.add("lyr-dragging");
      // Dragged as a block: only the topmost selected nodes, in tree order.
      const selected = store.isSelected(drag.id) ? store.selection() : [drag.id];
      drag.ids = store.all().map((n) => n.id).filter((id) => selected.includes(id) && !store.ancestors(id).some((a) => selected.includes(a)));
      root.querySelectorAll(".lyr-row").forEach((row) => drag.ids.includes(row.dataset.id) && row.classList.add("lyr-ghost"));
    }
    drag.target = dropTarget(event);
    showIndicator(drag.target);
  });

  root.addEventListener("pointerleave", () => !drag && store.setUI({ hovered: null }));

  const endDrag = (event) => {
    if (!drag) return;
    const { started, target, ids, id } = drag;
    drag = null;
    root.classList.remove("lyr-dragging");
    indicator.style.display = "none";
    if (!started) {
      // A plain click on an already selected row selects only it.
      if (event?.type === "pointerup" && !event.shiftKey && !event.metaKey && !event.ctrlKey) selectFromRow(id, event);
      return;
    }
    if (!target) return render();
    store.transact(ids.length > 1 ? "Move layers" : "Move layer", () => {
      const rootsBefore = store.roots();
      let index = target.index;
      for (const moving of ids) {
        const wasRoot = store.get(moving).parent == null;
        store.move(moving, { parent: target.parent, index: index == null ? undefined : index++ });
        // A node taken out to the canvas needs a place there.
        if (target.parent == null && !wasRoot) {
          const right = Math.max(0, ...rootsBefore.map((r) => (r.x ?? 0) + (parseFloat(r.style.width) || 300)));
          store.update(moving, { x: right + 60, y: 0 });
        }
      }
    });
    store.select(ids);
  };
  root.addEventListener("pointerup", endDrag);
  root.addEventListener("pointercancel", () => {
    drag = null;
    root.classList.remove("lyr-dragging");
    indicator.style.display = "none";
    render();
  });

  /** Where a drop at the pointer lands: { parent, index, row, mode } or null. */
  function dropTarget(event) {
    const rows = [...root.querySelectorAll(".lyr-row")];
    let row = event.target.closest?.(".lyr-row") ?? document.elementFromPoint(event.clientX, event.clientY)?.closest(".lyr-row");
    if (!row) {
      const last = rows.at(-1);
      if (!last || event.clientY < last.getBoundingClientRect().bottom) return null;
      return { parent: null, index: undefined, row: last, mode: "end" };
    }
    const node = store.get(row.dataset.id);
    if (!node || drag.ids.includes(node.id) || drag.ids.some((id) => store.ancestors(node.id).includes(id))) return null;
    const rect = row.getBoundingClientRect();
    const y = (event.clientY - rect.top) / rect.height;
    const canHold = node.component === "Frame";
    const mode = canHold ? (y < 0.28 ? "before" : y > 0.72 ? "after" : "inside") : y < 0.5 ? "before" : "after";
    if (mode === "inside") return { parent: node.id, index: 0, row, mode };
    // After an open frame with children, the drop goes in as its first child.
    if (mode === "after" && canHold && isOpen(node) && store.children(node.id).length) return { parent: node.id, index: 0, row, mode };
    const siblings = store.children(node.parent).filter((n) => !drag.ids.includes(n.id));
    const at = siblings.findIndex((n) => n.id === node.id);
    return { parent: node.parent, index: mode === "before" ? at : at + 1, row, mode };
  }

  function showIndicator(target) {
    root.querySelectorAll(".lyr-into").forEach((el) => el.classList.remove("lyr-into"));
    if (!target) return (indicator.style.display = "none");
    if (target.mode === "inside") {
      indicator.style.display = "none";
      return target.row.classList.add("lyr-into");
    }
    const rect = target.row.getBoundingClientRect();
    const box = root.getBoundingClientRect();
    const depth = target.parent == null ? 0 : store.ancestors(target.parent).length + 1;
    const top = (target.mode === "before" ? rect.top : rect.bottom) - box.top + root.scrollTop;
    Object.assign(indicator.style, { display: "block", top: `${top - 1}px`, left: `${depth * INDENT + 40}px` });
  }

  root.addEventListener("dblclick", (event) => {
    const row = event.target.closest(".lyr-row");
    if (row && !event.target.closest("button")) startRename(row.dataset.id);
  });

  // ---------- Keyboard, while the list has focus ----------

  root.addEventListener("keydown", (event) => {
    if (renaming) return;
    const rows = visibleRows();
    const current = store.selection().at(-1);
    const at = rows.indexOf(current);
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      handled();
      const next = rows[Math.min(rows.length - 1, Math.max(0, at + (event.key === "ArrowDown" ? 1 : -1)))];
      if (next) selectFromRow(next, event);
    } else if (event.key === "ArrowLeft" && current) {
      handled();
      const node = store.get(current);
      if (store.children(current).length && isOpen(node)) setCollapsed([current], true);
      else if (node.parent != null) store.select(node.parent);
    } else if (event.key === "ArrowRight" && current) {
      handled();
      const node = store.get(current);
      if (store.children(current).length && !isOpen(node)) setCollapsed([current], false);
      else if (store.children(current).length) store.select(store.children(current)[0].id);
    } else if ((event.key === "Enter" || event.key === "F2") && current) {
      handled();
      startRename(current);
    }
  });

  // ---------- In step with the store ----------

  store.subscribe((reason, change) => {
    if (reason === "ui") {
      root.querySelectorAll(".lyr-row").forEach((row) => row.toggleAttribute("data-hovered", row.dataset.id === store.ui.hovered));
      return;
    }
    // Rows show names, icons, hidden and locked; only the flex kind (display, direction) is a style.
    if (reason === "document" && change?.style && !change.keys.has("display") && !change.keys.has("flexDirection")) return;
    if (drag?.started) return;
    if (reason === "selection") {
      const before = revealed.size;
      for (const id of store.selection()) store.ancestors(id).forEach((a) => store.get(a)?.collapsed && revealed.add(a));
      // Rows stay in place when nothing opened, so a double-click still lands on its row.
      if (revealed.size === before && store.selection().every((id) => root.querySelector(`.lyr-row[data-id="${CSS.escape(id)}"]`))) {
        root.querySelectorAll(".lyr-row").forEach((row) => {
          const id = row.dataset.id;
          row.setAttribute("aria-selected", String(store.isSelected(id)));
          const insideSelected = store.ancestors(id).some((a) => store.isSelected(a));
          row.toggleAttribute("data-in-selection", store.isSelected(id) && insideSelected);
          row.toggleAttribute("data-parent-selected", !store.isSelected(id) && insideSelected);
        });
      } else render();
    } else render();
    if (reason === "selection" && root !== document.activeElement) {
      root.querySelector('.lyr-row[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
    }
  });
  render();
}
