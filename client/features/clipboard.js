// Copy, cut and paste of elements.
//
// Copy puts the selected elements, with everything inside them, on the clipboard as JSON hidden in an HTML comment,
// beside the plain text of the selection (the text of text elements, else "Node IDs: ..."). Cut is copy plus delete.
// Paste tries, in this order: an SVG as text or an image file, the elements embedded by Copy, HTML, then plain
// text as a new text element. The marker is this editor's own, so another app's clipboard is never read as elements.
//
// With elements selected, pasted ones go inside a selected frame (at its end) or right after any other element;
// with none selected they go to the top level, centered in the view. Paste on top puts them where the selection
// is, and Paste to replace puts them there and removes the selection.
import { looksLikeHtml, pasteHtml } from "./import-html.js";
import { svgFile } from "./images.js";

// ---------- What is on the clipboard ----------
const MARKER_OPEN = '<!--<editor-paste-start data-embed="';
const MARKER_CLOSE = '"></editor-paste-start>-->';

const asNumber = (value) => parseFloat(value) || 0;
const escapeHtml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The clipboard content for these element ids as { html, text }, or null when none of them exists. */
export function serializeNodes(store, ids) {
  const chosen = new Set(ids);
  // Only the outermost chosen elements are copied; the ones inside them come along.
  const tops = store.all().filter((n) => chosen.has(n.id) && !store.ancestors(n.id).some((ancestor) => chosen.has(ancestor)));
  if (!tops.length) return null;

  const json = JSON.stringify({ topLevel: tops.map((n) => n.id), nodes: tops.flatMap((n) => store.subtree(n.id)) });
  const text = tops.every((n) => n.text) ? tops.map((n) => n.text).join("\n") : `Node IDs: ${tops.map((n) => n.id).join(", ")}`;
  // Angle brackets inside the comment would end it early.
  const hidden = json.replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
  return { html: `<meta charset="utf-8">${MARKER_OPEN}${hidden}${MARKER_CLOSE}<span style="white-space:pre-wrap;">${escapeHtml(text)}</span>`, text };
}

/** The { topLevel, nodes } this editor embedded in clipboard HTML, or null when there is none (or it is malformed). */
export function readEmbedded(html) {
  const from = html?.indexOf(MARKER_OPEN) ?? -1;
  if (from === -1) return null;
  const to = html.indexOf(MARKER_CLOSE, from + MARKER_OPEN.length);
  if (to === -1) return null;
  try {
    const tree = JSON.parse(html.slice(from + MARKER_OPEN.length, to));
    const wellFormed = Array.isArray(tree.nodes) && Array.isArray(tree.topLevel)
      && tree.nodes.every((n) => typeof n.id === "string" && typeof n.component === "string");
    return wellFormed && tree.nodes.length ? tree : null;
  } catch {
    return null;
  }
}

// ---------- Putting copies into the document ----------
/** Adds the tree's elements as copies under `parent`, from `index`, and returns the ids of the new top-level ones. */
function insertCopies(store, tree, { parent, index, at }) {
  const newIdOf = new Map();
  const tops = [];
  let slot = index;
  for (const node of tree.nodes) {
    // A copy takes a new id, and opens on the page being looked at.
    const { id, parent: oldParent, x, y, page, ...rest } = structuredClone(node);
    const isTop = tree.topLevel.includes(id);
    const place = isTop ? { parent, index: parent == null ? undefined : slot++ } : { parent: newIdOf.get(oldParent) };
    const copy = parent == null && isTop ? { ...rest, x: at.x, y: at.y } : rest;
    newIdOf.set(id, store.insert(copy, place));
    if (isTop) tops.push(newIdOf.get(id));
  }
  return tops;
}

const firstSize = (tree) => {
  const first = tree.nodes.find((n) => n.id === tree.topLevel[0]);
  return { width: asNumber(first?.style?.width), height: asNumber(first?.style?.height) };
};

const TEXT_STYLE = { fontSize: "16px", lineHeight: "1.4", color: "#111111", fontFamily: "system-ui" };
const PASTE_LABELS = { paste: "Paste", top: "Paste on top", replace: "Paste to replace" };

export function mountClipboard({ store, view, canvas, images }) {
  /** The point (in canvas units) that puts a box of this size at the center of what is on screen. */
  const centeredFor = ({ width, height }) => {
    const box = canvas.getBoundingClientRect();
    const { panX, panY, zoom } = store.ui;
    return { x: Math.round((box.width / 2 - panX) / zoom - width / 2), y: Math.round((box.height / 2 - panY) / zoom - height / 2) };
  };

  /** Where the copies go, as a list of { parent, index, at }: one place for each selected element, or the view's center. */
  function destinations(tree, mode) {
    const selected = store.selectedNodes();
    if (!selected.length) return [{ parent: null, at: centeredFor(firstSize(tree)) }];
    const copiedIds = new Set(tree.nodes.map((n) => n.id));
    return selected.map((target) => {
      const siblings = store.children(target.parent);
      const here = { x: target.x ?? 0, y: target.y ?? 0 };
      const after = { parent: target.parent, index: siblings.indexOf(target) + 1, at: { x: here.x + 40, y: here.y + 40 } };
      if (mode === "top") return target.parent == null ? { ...after, at: here } : after;
      if (mode === "replace") return { ...after, index: siblings.indexOf(target), at: here };
      // A frame takes the paste inside it, unless what is pasted came from that frame.
      const goesInside = target.component === "Frame" && !copiedIds.has(target.id);
      return goesInside ? { parent: target.id, index: store.children(target.id).length, at: after.at } : after;
    });
  }

  function pasteElements(tree, mode = "paste") {
    const replaced = [...store.selection()];
    const where = destinations(tree, mode);
    let created = [];
    store.transact(PASTE_LABELS[mode], () => {
      created = where.flatMap((spot) => insertCopies(store, tree, spot));
      if (mode === "replace" && replaced.length) store.remove(replaced);
    });
    store.select(created);
    return created;
  }

  function pasteText(text) {
    const value = text.endsWith("\n") ? text.slice(0, -1) : text;
    if (!value.trim()) return;
    let id;
    store.transact("Paste text", () => {
      id = store.insert({ component: "Text", name: value.slice(0, 40), text: value, style: { ...TEXT_STYLE }, ...centeredFor({ width: 0, height: 0 }) });
    });
    store.select(id);
  }

  /** Pastes what was copied or dropped, trying the richest form first. */
  async function pasteContent({ html, text, files = [] }, mode = "paste") {
    const svg = svgFile(text);
    if (svg) return images.place([svg]);
    if (files.length && (await images.place(files))) return;
    const tree = readEmbedded(html);
    if (tree) return pasteElements(tree, mode);
    const markup = looksLikeHtml(text) ? text : html;
    if (markup) return pasteHtml(store, view, markup);
    if (text) return pasteText(text);
  }

  // ---------- Events ----------
  const typingIn = (target) => {
    const field = "input, select, textarea, [contenteditable]";
    return target?.matches?.(field) || document.activeElement?.matches?.(field);
  };
  const hasTextSelected = () => window.getSelection()?.type === "Range";

  function copySelection(event, andRemove) {
    // Text being typed or selected keeps the browser's own copy.
    if (typingIn(event.target) || hasTextSelected() || !store.selection().length) return;
    const payload = serializeNodes(store, store.selection());
    if (!payload) return;
    event.preventDefault();
    event.clipboardData.setData("text/html", payload.html);
    event.clipboardData.setData("text/plain", payload.text);
    if (andRemove) store.transact("Cut", () => store.remove([...store.selection()]));
  }
  addEventListener("copy", (event) => copySelection(event, false));
  addEventListener("cut", (event) => copySelection(event, true));
  addEventListener("paste", (event) => {
    if (typingIn(event.target)) return;
    const html = event.clipboardData.getData("text/html");
    const text = event.clipboardData.getData("text/plain");
    const files = [...event.clipboardData.files];
    if (!html && !text && !files.length) return;
    event.preventDefault();
    pasteContent({ html, text, files }).catch((error) => console.error("Paste failed", error));
  });

  // Paste on top and Paste to replace come from the menu, so there is no paste event: they read the clipboard themselves.
  async function readClipboard() {
    const items = await navigator.clipboard.read().catch(() => []);
    let html = "", text = "";
    for (const item of items) {
      if (item.types.includes("text/html")) html = await (await item.getType("text/html")).text();
      if (item.types.includes("text/plain")) text = await (await item.getType("text/plain")).text();
    }
    return html || text ? { html, text } : { html: "", text: await navigator.clipboard.readText() };
  }
  const pasteFromClipboard = (mode) => readClipboard().then((content) => pasteContent(content, mode)).catch((error) => console.error("Paste failed", error));

  return { pasteOnTop: () => pasteFromClipboard("top"), pasteToReplace: () => pasteFromClipboard("replace") };
}
