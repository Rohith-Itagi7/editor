// Tools, keyboard shortcuts and the canvas menu. The toolbar lists the tools in order; `commands` is everything the
// editor can be told to do (by a key, a menu item, or the app's own menu, through window.editor.run); and the
// shortcut table says which key does which command. Every edit goes through the store, so each is one undo step.
import { icon } from "../ui/icons/toolbar.js";
import { mountClipboard } from "../features/clipboard.js";
import { mountImages } from "../features/images.js";
import { mountImportUrl } from "../features/import-url.js";
import { mountPlay } from "../features/play.js";
import { mountPen } from "./pen.js";
import { toast } from "../ui/toast.js";

// The toolbar, in its order and groups. `keys` pick the tool (one key press, no modifiers).
export const TOOLS = [
  { name: "Move", keys: ["v"], icon: "move" },
  { name: "Pan", keys: ["h"], icon: "pan" },
  { divider: true },
  { name: "Frame", keys: ["f", "a"], icon: "frame" },
  { name: "Rectangle", keys: ["r"], icon: "rectangle" },
  { name: "Pen", keys: ["p"], icon: "pen" },
  { name: "Text", keys: ["t"], icon: "text" },
  { name: "Comment", keys: ["c", "y"], icon: "comment" },
];

const TYPING_FIELDS = "input, select, textarea, [contenteditable]";
const CANVAS_MENU_ALWAYS_ON = ["zoomToSelection", "importUrl", "placeImage"]; // work with nothing selected
const ARROW_OFFSETS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

// The items of the menu on the canvas: label, the shortcut shown, the command; null is a separator.
const CANVAS_MENU = [
  ["Select parent", "Esc", "selectParent"], ["Select children", "↵", "selectChildren"], null,
  ["Duplicate", "⌘D", "duplicate"], ["Paste on top", "⇧⌘V", "pasteOnTop"], ["Paste to replace", "⇧⌘R", "pasteToReplace"], null,
  ["Copy styles", "⌥⌘C", "copyStyles"], ["Paste styles", "⌥⌘V", "pasteStyles"], null,
  ["Frame selection", "⌥⌘G", "frameSelection"], ["Ungroup", "⇧⌘G", "ungroup"], ["Add flex layout", "⇧A", "addFlex"], ["Remove flex", "⌥⇧A", "removeFlex"], null,
  ["Bring to front", "⌥⌘]", "bringToFront"], ["Move forward", "⌘]", "moveForward"], ["Move backward", "⌘[", "moveBackward"], ["Send to back", "⌥⌘[", "sendToBack"], null,
  ["Show / hide", "⇧⌘H", "toggleHidden"], ["Lock / unlock", "⇧⌘L", "toggleLocked"], null,
  ["Import URL…", "", "importUrl"], ["Play", "", "play"], ["Place image…", "⇧⌘K", "placeImage"], null,
  ["Zoom to selection", "⇧2", "zoomToSelection"], ["Delete", "⌫", "delete"],
];

/**
 * The shortcuts, tried in this order: the first that fits runs. `at` is { mod (⌘ or Ctrl), shift, alt, key (lower
 * case), code, event }. A rule answers with the command and its arguments, or nothing when it does not fit.
 */
const SHORTCUTS = [
  (at) => at.mod && at.shift && at.key === "z" && ["redo"],
  (at) => at.mod && at.key === "z" && ["undo"],
  (at) => at.mod && at.shift && !at.alt && at.key === "k" && ["placeImage"],
  (at) => at.mod && at.shift && !at.alt && at.key === "v" && ["pasteOnTop"],
  (at) => at.mod && at.shift && !at.alt && at.key === "r" && ["pasteToReplace"],
  (at) => at.mod && at.key === "d" && ["duplicate"],
  (at) => at.mod && at.key === "a" && ["selectAll"],
  (at) => at.mod && at.shift && at.key === "h" && ["toggleHidden"],
  (at) => at.mod && at.shift && at.key === "l" && ["toggleLocked"],
  (at) => at.mod && at.shift && at.key === "g" && ["ungroup"],
  (at) => at.mod && at.alt && at.key === "g" && ["frameSelection"],
  (at) => at.mod && at.alt && at.key === "c" && ["copyStyles"],
  (at) => at.mod && at.alt && at.key === "v" && ["pasteStyles"],
  (at) => at.mod && at.event.key === "]" && [at.alt ? "bringToFront" : "moveForward"],
  (at) => at.mod && at.event.key === "[" && [at.alt ? "sendToBack" : "moveBackward"],
  (at) => at.mod && at.key === "i" && ["toggleItalic"],
  (at) => at.mod && (at.event.key === "=" || at.event.key === "+") && ["zoomIn"],
  (at) => at.mod && at.event.key === "-" && ["zoomOut"],
  (at) => (at.event.key === "Backspace" || at.event.key === "Delete") && ["delete"],
  (at) => at.event.key === "PageDown" && ["nextPage"],
  (at) => at.event.key === "PageUp" && ["previousPage"],
  (at) => at.event.key === "Escape" && ["selectParent"],
  (at) => at.event.key === "Enter" && ["selectChildren"],
  (at) => {
    if (!at.event.key.startsWith("Arrow")) return false;
    const distance = at.shift ? 10 : 1;
    return ["nudge", ...ARROW_OFFSETS[at.event.key].map((d) => d * distance)];
  },
  (at) => at.shift && at.event.key === "!" && ["zoomToFit"],
  (at) => at.shift && at.code === "Digit1" && ["zoomToFit"],
  (at) => at.shift && !at.mod && !at.alt && at.key === "c" && ["toggleComments"],
  (at) => at.shift && at.code === "Digit2" && ["zoomToSelection"],
  (at) => at.code === "Digit0" && ["zoomTo100"],
  (at) => at.alt && at.shift && at.code === "KeyA" && ["removeFlex"],
  (at) => at.shift && at.key === "a" && ["addFlex"],
];

export function mountCommands({ toolbar, menu, canvas, store, view, upload }) {
  // ---------- Toolbar ----------
  const toolButton = (tool) => {
    const hint = tool.keys[0] ? ` (${tool.keys[0]})` : "";
    const unavailable = tool.disabled ? `, unavailable: ${tool.why ?? "not available"}` : "";
    return `<button class="tool" data-tool="${tool.name}" title="${tool.name}${hint}${unavailable}" aria-label="${tool.name}" aria-pressed="${store.ui.tool === tool.name}" ${tool.disabled ? "disabled" : ""}>${icon(tool.icon)}</button>`;
  };
  const historyButtons = () => {
    const { undo, redo } = store.history();
    return `<span class="toolbar-divider"></span><button class="tool" data-cmd="undo" title="Undo (⌘Z)" aria-label="Undo" ${undo.length ? "" : "disabled"}>${icon("undo")}</button><button class="tool" data-cmd="redo" title="Redo (⇧⌘Z)" aria-label="Redo" ${redo.length ? "" : "disabled"}>${icon("redo")}</button>`;
  };
  function renderToolbar() {
    toolbar.innerHTML = TOOLS.map((tool) => (tool.divider ? `<span class="toolbar-divider"></span>` : toolButton(tool))).join("") + historyButtons();
    canvas.dataset.tool = store.ui.tool;
  }
  toolbar.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.tool) store.setUI({ tool: button.dataset.tool });
    if (button.dataset.cmd) run(button.dataset.cmd);
  });
  // The tool shows on "ui"; whether undo and redo are possible changes on "document".
  store.subscribe((reason) => reason !== "selection" && renderToolbar());
  renderToolbar();

  // ---------- Commands ----------
  const selected = () => store.selection();
  const first = () => store.get(selected()[0]);
  const parentOf = (id) => store.get(id)?.parent;
  /** Runs `change` as one undo step, when something is selected. */
  const edit = (label, change) => selected().length && store.transact(label, change);
  let copiedStyles = null;

  const siblingIndex = (id) => store.children(parentOf(id)).findIndex((n) => n.id === id);
  const moveEach = (label, indexFor) => edit(label, () => selected().forEach((id) => store.move(id, { parent: parentOf(id), ...indexFor(id) })));

  const commands = {
    // History and selection
    undo: () => store.undo(),
    redo: () => store.redo(),
    selectParent: () => first()?.parent && store.select(first().parent),
    selectChildren: () => first() && store.select(store.children(first().id).map((n) => n.id)),
    selectAll: () => {
      const parent = first() ? parentOf(first().id) : null;
      store.select((parent == null ? store.roots() : store.children(parent)).map((n) => n.id));
    },

    // Changing elements
    delete: () => edit("Delete", () => store.remove(selected())),
    duplicate: () => edit("Duplicate", () => store.select(store.duplicate(selected()))),
    toggleHidden: () => edit("Show / hide", () => store.update(selected(), (n) => ({ hidden: !n.hidden }))),
    toggleLocked: () => edit("Lock / unlock", () => store.update(selected(), (n) => ({ locked: !n.locked }))),
    toggleItalic: () => edit("Toggle italic", () => store.update(selected(), (n) => ({ style: { fontStyle: n.style.fontStyle === "italic" ? undefined : "italic" } }))),
    nudge: (dx, dy) => edit("Nudge", () => selected().forEach((id) => {
      const n = store.get(id);
      if (n.parent == null) store.update(id, { x: (n.x ?? 0) + dx, y: (n.y ?? 0) + dy });
      else store.updateStyle(id, { position: "relative", left: `${(parseFloat(n.style.left) || 0) + dx}px`, top: `${(parseFloat(n.style.top) || 0) + dy}px` });
    })),

    // Order
    bringToFront: () => moveEach("Bring to front", () => ({})),
    sendToBack: () => moveEach("Send to back", () => ({ index: 0 })),
    moveForward: () => moveEach("Move forward", (id) => ({ index: siblingIndex(id) + 2 })),
    moveBackward: () => moveEach("Move backward", (id) => ({ index: Math.max(0, siblingIndex(id) - 1) })),

    // Structure and layout
    frameSelection: () => edit("Frame selection", () => {
      const top = first();
      const index = store.children(top.parent).findIndex((n) => n.id === top.id);
      const frame = store.insert({ component: "Frame", name: "Frame", style: { display: "flex", flexDirection: "column", gap: "8px" }, ...(top.parent == null ? { x: top.x, y: top.y } : {}) }, { parent: top.parent, index });
      selected().forEach((id) => store.move(id, { parent: frame }));
      store.select(frame);
    }),
    ungroup: () => edit("Ungroup", () => {
      const frame = first();
      if (frame?.component !== "Frame" || frame.parent == null) return;
      const index = store.children(frame.parent).findIndex((n) => n.id === frame.id);
      const kids = store.children(frame.id).map((n) => n.id);
      kids.forEach((id, i) => store.move(id, { parent: frame.parent, index: index + i }));
      store.remove(frame.id);
      store.select(kids);
    }),
    addFlex: () => edit("Add flex layout", () => store.updateStyle(selected(), { display: "flex", flexDirection: "row", gap: "8px" })),
    removeFlex: () => edit("Remove flex", () => store.updateStyle(selected(), { display: undefined, flexDirection: undefined, gap: undefined })),
    copyStyles: () => (copiedStyles = first() && structuredClone(first().style)),
    pasteStyles: () => copiedStyles && edit("Paste styles", () => store.updateStyle(selected(), copiedStyles)),

    // Bringing things in
    placeImage: () => images.choose(),
    importUrl: () => importer.open(),
    play: () => player.play(),
    pasteOnTop: () => clip.pasteOnTop(),
    pasteToReplace: () => clip.pasteToReplace(),

    // The view
    toggleComments: () => { store.setUI({ commentsHidden: !store.ui.commentsHidden }); toast(`Comments ${store.ui.commentsHidden ? "hidden" : "visible"}`); },
    nextPage: () => goToPage(1),
    previousPage: () => goToPage(-1),
    zoomToFit: () => view.zoomToFit(),
    zoomToSelection: () => view.zoomToSelection(),
    zoomTo100: () => view.zoomTo100(),
    zoomIn: () => store.setUI({ zoom: Math.min(16, store.ui.zoom * 1.25) }),
    zoomOut: () => store.setUI({ zoom: Math.max(0.05, store.ui.zoom / 1.25) }),
  };

  function goToPage(by) {
    const pages = store.pages();
    const target = pages[pages.findIndex((p) => p.id === store.activePage()) + by];
    if (target) store.setPage(target.id);
  }
  const run = (name, ...args) => commands[name]?.(...args);

  const images = mountImages({ store, view, canvas, upload });
  const importer = mountImportUrl({ store, view });
  const player = mountPlay({ store, canvas });
  mountPen({ store, canvas });
  const clip = mountClipboard({ store, view, canvas, images });

  // ---------- Keyboard ----------
  addEventListener("keydown", (event) => {
    if (event.target.matches?.(TYPING_FIELDS)) return;
    // Only while the pointer is over the editor or focus is inside it.
    const editor = canvas.closest(".editor");
    if (!editor.matches(":hover") && !editor.contains(document.activeElement)) return;

    if (event.code === "Space" && !event.repeat) { event.preventDefault(); return view.setSpace(true); }
    if (event.key === "Alt") return view.setAlt(true);

    const at = { mod: event.metaKey || event.ctrlKey, shift: event.shiftKey, alt: event.altKey, key: event.key.toLowerCase(), code: event.code, event };
    for (const rule of SHORTCUTS) {
      const matched = rule(at);
      if (!matched) continue;
      event.preventDefault();
      return run(...matched);
    }
    if (at.mod || at.alt || at.shift) return;
    const tool = TOOLS.find((t) => !t.divider && !t.disabled && t.keys.includes(at.key));
    if (tool) { event.preventDefault(); store.setUI({ tool: tool.name }); }
  });
  addEventListener("keyup", (event) => {
    if (event.code === "Space") view.setSpace(false);
    if (event.key === "Alt") view.setAlt(false);
  });
  addEventListener("blur", () => { view.setSpace(false); view.setAlt(false); });

  // ---------- The menu on the canvas ----------
  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    const under = document.elementsFromPoint(event.clientX, event.clientY).find((el) => el.dataset?.nodeId);
    if (under && !store.isSelected(under.dataset.nodeId)) store.select(under.dataset.nodeId);
    const nothingSelected = !store.selection().length;
    menu.innerHTML = CANVAS_MENU.map((item) => {
      if (!item) return "<hr>";
      const [label, shortcut, command] = item;
      const disabled = nothingSelected && !CANVAS_MENU_ALWAYS_ON.includes(command);
      return `<button data-cmd="${command}" ${disabled ? "disabled" : ""}>${label}<kbd>${shortcut}</kbd></button>`;
    }).join("");
    menu.style.left = `${event.clientX}px`;
    menu.style.top = `${event.clientY}px`;
    menu.hidden = false;
  });
  menu.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-cmd]");
    if (button) run(button.dataset.cmd);
    menu.hidden = true;
  });
  addEventListener("pointerdown", (event) => { if (!menu.contains(event.target)) menu.hidden = true; });

  return { run };
}
