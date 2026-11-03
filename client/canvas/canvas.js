// The canvas: every node is a real HTML element (data-node-id)
// inside a world that pans and zooms with one transform. Selection, handles, snapping guides,
// the marquee and measurements live in a screen-space overlay above it.

import { tokenVariables } from "../core/tokens.js";

const SNAP = 6;
const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
// Other modules can give a component its own element (kinds/vector.js does for "Vector").
export const nodeRenderers = {};

/** "Fit " or "Fill " before a size, as the dimensions badge writes it; "" when fixed. */
function sizeIntent(node, axis) {
  const s = node.style;
  const value = s[axis];
  if (value === "100%" || /^\s*[1-9]/.test(s.flex ?? "") || parseFloat(s.flexGrow) >= 1 || s.alignSelf === "stretch") return "Fill ";
  if (!value || value === "auto" || value === "fit-content" || value === "max-content") return "Fit ";
  return "";
}

export function mountCanvas(root, store) {
  root.innerHTML = `<div class="world"></div><div class="overlay"></div>`;
  const world = root.querySelector(".world");
  const overlay = root.querySelector(".overlay");
  let gesture = null;
  let spaceDown = false;
  let altDown = false;
  let guides = [];
  let marquee = null;
  let dropLine = null;

  // ---------- Coordinates ----------
  const base = () => root.getBoundingClientRect();
  const toWorld = (cx, cy) => {
    const b = base();
    const { panX, panY, zoom } = store.ui;
    return { x: (cx - b.left - panX) / zoom, y: (cy - b.top - panY) / zoom };
  };
  const elOf = (id) => world.querySelector(`[data-node-id="${CSS.escape(id)}"]`);
  const rectOf = (id) => {
    const el = elOf(id);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const b = base();
    return { x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height };
  };

  // ---------- Rendering the document ----------
  function renderNode(node) {
    const custom = nodeRenderers[node.component];
    const el = custom ? custom.create(node, store) : document.createElement(node.component === "Text" ? "p" : "div");
    el.dataset.nodeId = node.id;
    el.dataset.component = node.component;
    if (!custom) el.removeAttribute("style");
    Object.assign(el.style, { margin: "0", boxSizing: "border-box" }, node.style);
    if (node.hidden) el.style.visibility = "hidden";
    if (node.text != null && !custom) el.textContent = node.text;
    for (const child of store.children(node.id)) el.append(renderNode(child));
    return el;
  }

  // The file's theme tokens are CSS variables of the world, so any value may say var(--color-brand).
  let tokenVars = [];
  function applyTokens() {
    for (const name of tokenVars) world.style.removeProperty(name);
    const vars = tokenVariables(store.tokens());
    for (const [name, value] of Object.entries(vars)) world.style.setProperty(name, value);
    tokenVars = Object.keys(vars);
  }

  function renderDocument() {
    applyTokens();
    world.replaceChildren(
      ...store.roots().map((node) => {
        const board = document.createElement("div");
        board.className = "artboard";
        board.style.left = `${node.x ?? 0}px`;
        board.style.top = `${node.y ?? 0}px`;
        board.append(renderNode(node));
        return board;
      }),
    );
    applyView();
  }

  function applyView() {
    const { panX, panY, zoom } = store.ui;
    world.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    renderOverlay();
  }

  // ---------- Overlay: labels, hover, selection, guides, marquee, measurements ----------
  function renderOverlay() {
    const parts = [];
    // The label sits 7px off the frame, up to 3px more as the zoom passes 50% and 200%.
    const labelGap = 7 + Math.min(3, Math.max(0, 2 * store.ui.zoom - 1));
    for (const node of store.roots()) {
      const r = rectOf(node.id);
      if (!r) continue;
      const selected = store.isSelected(node.id) || store.ui.hovered === node.id;
      parts.push(`<div class="board-label${selected ? " on" : ""}" data-board="${node.id}" style="left:${r.x}px;top:${r.y - labelGap}px;max-width:${r.w}px">${esc(node.name)}</div>`);
    }
    const hovered = store.ui.hovered;
    if (hovered && !store.isSelected(hovered)) {
      const r = rectOf(hovered);
      if (r) parts.push(`<div class="hover-box" style="${box(r)}"></div>`);
    }
    const sel = store.selection().map(rectOf).filter(Boolean);
    for (const r of sel) parts.push(`<div class="sel-box" style="${box(r)}"></div>`);
    if (sel.length) {
      const u = union(sel);
      const single = store.selection().length === 1 ? store.get(store.selection()[0]) : null;
      if (!single?.locked) parts.push(`<div class="sel-frame" style="${box(u)}">${HANDLES.map((h) => `<i data-handle="${h}" class="h-${h}"></i>`).join("")}</div>`);
      const z = store.ui.zoom;
      const w = `${single ? sizeIntent(single, "width") : ""}${Math.round(u.w / z)}`;
      const h = `${single ? sizeIntent(single, "height") : ""}${Math.round(u.h / z)}`;
      parts.push(`<div class="sel-size" style="left:${u.x + u.w / 2}px;top:${u.y + u.h + 6}px">${w} × ${h}</div>`);
    }
    for (const g of guides) {
      parts.push(g.axis === "x"
        ? `<div class="guide" style="left:${g.at}px;top:${g.from}px;width:1px;height:${g.to - g.from}px"></div>`
        : `<div class="guide" style="top:${g.at}px;left:${g.from}px;height:1px;width:${g.to - g.from}px"></div>`);
    }
    if (marquee) parts.push(`<div class="marquee" style="${box(normalize(marquee))}"></div>`);
    if (dropLine) parts.push(`<div class="drop-line" style="${box(dropLine)}"></div>`);
    if (altDown) parts.push(...measurements());
    overlay.innerHTML = parts.join("");
  }

  // Distances from the selection to the hovered node, or to its parent's edges.
  function measurements() {
    const [id] = store.selection();
    if (!id) return [];
    const a = rectOf(id);
    const other = store.ui.hovered && store.ui.hovered !== id ? store.ui.hovered : store.get(id).parent;
    const b = other ? rectOf(other) : null;
    if (!a || !b) return [];
    const z = store.ui.zoom;
    const out = [`<div class="measure-box" style="${box(b)}"></div>`];
    const inside = a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
    const line = (x1, y1, x2, y2) => {
      const len = Math.round(Math.hypot(x2 - x1, y2 - y1) / z);
      if (len <= 0) return;
      const horizontal = y1 === y2;
      out.push(horizontal
        ? `<div class="measure" style="left:${Math.min(x1, x2)}px;top:${y1}px;width:${Math.abs(x2 - x1)}px;height:1px"></div>`
        : `<div class="measure" style="left:${x1}px;top:${Math.min(y1, y2)}px;width:1px;height:${Math.abs(y2 - y1)}px"></div>`);
      out.push(`<div class="measure-label" style="left:${(x1 + x2) / 2}px;top:${(y1 + y2) / 2}px">${len}</div>`);
    };
    const cy = a.y + a.h / 2;
    const cx = a.x + a.w / 2;
    if (inside) {
      line(b.x, cy, a.x, cy);
      line(a.x + a.w, cy, b.x + b.w, cy);
      line(cx, b.y, cx, a.y);
      line(cx, a.y + a.h, cx, b.y + b.h);
    } else {
      if (b.x >= a.x + a.w) line(a.x + a.w, cy, b.x, cy);
      if (b.x + b.w <= a.x) line(b.x + b.w, cy, a.x, cy);
      if (b.y >= a.y + a.h) line(cx, a.y + a.h, cx, b.y);
      if (b.y + b.h <= a.y) line(cx, b.y + b.h, cx, a.y);
    }
    return out;
  }

  // ---------- Hit testing ----------
  function nodeAt(cx, cy, { deep = true, digging = false } = {}) {
    const stack = document.elementsFromPoint(cx, cy).filter((el) => world.contains(el) && el.dataset?.nodeId);
    const ids = stack.map((el) => el.dataset.nodeId).filter((id) => !store.get(id)?.locked);
    if (!ids.length) return null;
    if (deep) return ids[0];
    // The first click selects the outermost child inside the artboard, and digs one level
    // deeper on each click into the current selection.
    const deepest = ids[0];
    const chain = [deepest, ...store.ancestors(deepest)].reverse();
    // Pressing on something already selected keeps it, so it can be dragged.
    const held = chain.findLast((id) => store.isSelected(id));
    if (held && !digging) return held;
    const current = store.selection()[0];
    const at = current ? chain.indexOf(current) : -1;
    if (at >= 0 && at < chain.length - 1) return chain[at + 1];
    return chain[Math.min(1, chain.length - 1)];
  }

  // ---------- Pointer ----------
  root.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 && event.button !== 1) return;
    root.setPointerCapture(event.pointerId);
    const tool = store.ui.tool;
    const start = { cx: event.clientX, cy: event.clientY, world: toWorld(event.clientX, event.clientY) };

    if (event.button === 1 || spaceDown || tool === "Pan") {
      gesture = { kind: "pan", start, panX: store.ui.panX, panY: store.ui.panY };
      root.classList.add("panning");
      return;
    }
    const handle = event.target.closest("[data-handle]")?.dataset.handle;
    if (handle) return startResize(handle, start);
    const label = event.target.closest("[data-board]")?.dataset.board;
    if (label) {
      store.select(label, { toggle: event.shiftKey });
      return startDrag(start);
    }
    if (["Frame", "Rectangle", "Text"].includes(tool)) {
      gesture = { kind: "draw", start, tool };
      return;
    }
    const hit = nodeAt(event.clientX, event.clientY, { deep: event.metaKey || event.ctrlKey || event.detail > 1 });
    if (!hit) {
      if (!event.shiftKey) store.select([]);
      gesture = { kind: "marquee", start };
      return;
    }
    if (event.shiftKey) store.select(hit, { toggle: true });
    else if (!store.isSelected(hit)) store.select(hit);
    if (event.altKey) {
      store.transact("Duplicate", () => store.select(store.duplicate(store.selection())));
    }
    startDrag(start);
  });

  // A double-click digs one level deeper than the current selection, toward the pointer.
  root.addEventListener("dblclick", (event) => {
    const stack = document.elementsFromPoint(event.clientX, event.clientY).filter((el) => world.contains(el) && el.dataset?.nodeId);
    const deepest = stack[0]?.dataset.nodeId;
    if (!deepest) return;
    const chain = [deepest, ...store.ancestors(deepest)].reverse();
    const at = chain.indexOf(store.selection()[0]);
    store.select(chain[Math.min(chain.length - 1, at + 1)]);
  });

  function startDrag(start) {
    const ids = store.selection().filter((id) => !store.get(id)?.locked);
    const origin = Object.fromEntries(ids.map((id) => [id, { x: store.get(id).x ?? 0, y: store.get(id).y ?? 0, left: parseFloat(store.get(id).style.left) || 0, top: parseFloat(store.get(id).style.top) || 0 }]));
    gesture = { kind: "drag", start, ids, origin, moved: false };
  }

  function startResize(handle, start) {
    const id = store.selection()[0];
    const node = store.get(id);
    const r = rectOf(id);
    const z = store.ui.zoom;
    gesture = { kind: "resize", start, handle, id, w: r.w / z, h: r.h / z, x: node.x ?? 0, y: node.y ?? 0 };
  }

  root.addEventListener("pointermove", (event) => {
    if (!gesture) {
      const hovered = event.target.closest("[data-board]")?.dataset.board ?? nodeAt(event.clientX, event.clientY, { deep: altDown || event.metaKey });
      if (hovered !== store.ui.hovered) store.setUI({ hovered });
      return;
    }
    const z = store.ui.zoom;
    const dx = (event.clientX - gesture.start.cx) / z;
    const dy = (event.clientY - gesture.start.cy) / z;

    if (gesture.kind === "pan") {
      store.setUI({ panX: gesture.panX + (event.clientX - gesture.start.cx), panY: gesture.panY + (event.clientY - gesture.start.cy) });
    } else if (gesture.kind === "drag") {
      if (!gesture.moved && Math.hypot(dx, dy) * z < 3) return;
      gesture.moved = true;
      dragTo(dx, dy, event);
    } else if (gesture.kind === "resize") {
      resizeTo(dx, dy, event.shiftKey);
    } else if (gesture.kind === "marquee" || gesture.kind === "draw") {
      const b = base();
      marquee = { x: gesture.start.cx - b.left, y: gesture.start.cy - b.top, x2: event.clientX - b.left, y2: event.clientY - b.top };
      if (gesture.kind === "marquee") selectInMarquee(event.shiftKey);
      renderOverlay();
    }
  });

  root.addEventListener("pointerup", (event) => {
    if (gesture?.kind === "draw") finishDraw(event);
    if (gesture?.kind === "drag" && gesture.flex) finishReorder();
    root.classList.remove("panning");
    gesture = null;
    guides = [];
    marquee = null;
    dropLine = null;
    renderOverlay();
  });

  function dragTo(dx, dy, event) {
    const roots = gesture.ids.filter((id) => store.get(id).parent == null);
    const children = gesture.ids.filter((id) => store.get(id).parent != null);
    // A child of a flex container moves by changing its place among its siblings.
    if (children.length === 1 && !roots.length) {
      const node = store.get(children[0]);
      const parentEl = elOf(node.parent);
      const flex = parentEl && getComputedStyle(parentEl).display.includes("flex");
      if (flex) return showReorder(node, parentEl, event);
    }
    let sx = 0;
    let sy = 0;
    if (roots.length) [sx, sy] = snapRoots(roots, dx, dy);
    store.transact("Move", () => {
      for (const id of roots) store.update(id, { x: Math.round(gesture.origin[id].x + dx + sx), y: Math.round(gesture.origin[id].y + dy + sy) });
      for (const id of children) store.updateStyle(id, { position: "relative", left: `${Math.round(gesture.origin[id].left + dx)}px`, top: `${Math.round(gesture.origin[id].top + dy)}px` });
    }, { merge: `move-${gesture.start.cx}` });
  }

  function showReorder(node, parentEl, event) {
    const row = getComputedStyle(parentEl).flexDirection.startsWith("row");
    const siblings = store.children(node.parent).filter((n) => n.id !== node.id);
    let index = siblings.length;
    for (let i = 0; i < siblings.length; i++) {
      const r = elOf(siblings[i].id).getBoundingClientRect();
      if (row ? event.clientX < r.left + r.width / 2 : event.clientY < r.top + r.height / 2) {
        index = i;
        break;
      }
    }
    gesture.flex = { id: node.id, parent: node.parent, index };
    const b = base();
    const pr = parentEl.getBoundingClientRect();
    const ref = siblings[index] ? elOf(siblings[index].id).getBoundingClientRect() : null;
    const prev = siblings[index - 1] ? elOf(siblings[index - 1].id).getBoundingClientRect() : null;
    if (row) {
      const x = ref ? ref.left - 3 : prev ? prev.right + 1 : pr.left + 4;
      dropLine = { x: x - b.left, y: pr.top - b.top + 4, w: 2, h: pr.height - 8 };
    } else {
      const y = ref ? ref.top - 3 : prev ? prev.bottom + 1 : pr.top + 4;
      dropLine = { x: pr.left - b.left + 4, y: y - b.top, w: pr.width - 8, h: 2 };
    }
    renderOverlay();
  }

  function finishReorder() {
    const { id, parent, index } = gesture.flex;
    store.transact("Reorder", () => store.move(id, { parent, index }));
  }

  // Snap the dragged artboards' edges and centers to the other artboards'.
  function snapRoots(ids, dx, dy) {
    guides = [];
    const z = store.ui.zoom;
    const moving = ids.map((id) => {
      const r = rectOf(id);
      return { x: gesture.origin[id].x + dx, y: gesture.origin[id].y + dy, w: r.w / z, h: r.h / z };
    });
    const m = moving.reduce((u, r) => ({ x: Math.min(u.x, r.x), y: Math.min(u.y, r.y), x2: Math.max(u.x2, r.x + r.w), y2: Math.max(u.y2, r.y + r.h) }), { x: Infinity, y: Infinity, x2: -Infinity, y2: -Infinity });
    const others = store.roots().filter((n) => !ids.includes(n.id)).map((n) => {
      const r = rectOf(n.id);
      return { x: n.x ?? 0, y: n.y ?? 0, x2: (n.x ?? 0) + r.w / z, y2: (n.y ?? 0) + r.h / z };
    });
    const xs = [m.x, (m.x + m.x2) / 2, m.x2];
    const ys = [m.y, (m.y + m.y2) / 2, m.y2];
    let best = { x: null, y: null };
    for (const o of others) {
      for (const t of [o.x, (o.x + o.x2) / 2, o.x2]) for (const s of xs) if (Math.abs(t - s) * z < SNAP && (!best.x || Math.abs(t - s) < Math.abs(best.x.d))) best.x = { d: t - s, at: t, o };
      for (const t of [o.y, (o.y + o.y2) / 2, o.y2]) for (const s of ys) if (Math.abs(t - s) * z < SNAP && (!best.y || Math.abs(t - s) < Math.abs(best.y.d))) best.y = { d: t - s, at: t, o };
    }
    const { panX, panY } = store.ui;
    if (best.x) guides.push({ axis: "x", at: best.x.at * z + panX, from: Math.min(m.y, best.x.o.y) * z + panY, to: Math.max(m.y2, best.x.o.y2) * z + panY });
    if (best.y) guides.push({ axis: "y", at: best.y.at * z + panY, from: Math.min(m.x, best.y.o.x) * z + panX, to: Math.max(m.x2, best.y.o.x2) * z + panX });
    return [best.x?.d ?? 0, best.y?.d ?? 0];
  }

  function resizeTo(dx, dy, keepRatio) {
    const g = gesture;
    let w = g.w;
    let h = g.h;
    let x = g.x;
    let y = g.y;
    if (g.handle.includes("e")) w = g.w + dx;
    if (g.handle.includes("w")) { w = g.w - dx; x = g.x + dx; }
    if (g.handle.includes("s")) h = g.h + dy;
    if (g.handle.includes("n")) { h = g.h - dy; y = g.y + dy; }
    if (keepRatio) {
      const ratio = g.w / g.h;
      if (g.handle === "n" || g.handle === "s") w = h * ratio;
      else h = w / ratio;
    }
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    const node = store.get(g.id);
    store.transact("Resize", () => {
      const style = {};
      if (g.handle !== "n" && g.handle !== "s") style.width = `${w}px`;
      if (g.handle !== "e" && g.handle !== "w") style.height = `${h}px`;
      store.updateStyle(g.id, style);
      if (node.parent == null) store.update(g.id, { x: Math.round(x), y: Math.round(y) });
    }, { merge: `resize-${g.start.cx}` });
  }

  function selectInMarquee(add) {
    const m = normalize(marquee);
    // Outside the artboards it picks artboards; started inside one, its direct children.
    const startedIn = store.roots().find((n) => contains(rectOf(n.id), m.x, m.y));
    const candidates = startedIn ? store.children(startedIn.id) : store.roots();
    const hits = candidates.filter((n) => !n.locked && intersects(rectOf(n.id), m)).map((n) => n.id);
    store.select(hits, { add });
  }

  function finishDraw(event) {
    const tool = gesture.tool;
    const a = gesture.start.world;
    const b = toWorld(event.clientX, event.clientY);
    const dragged = Math.abs(b.x - a.x) > 4 || Math.abs(b.y - a.y) > 4;
    const w = dragged ? Math.round(Math.abs(b.x - a.x)) : tool === "Text" ? null : 160;
    const h = dragged ? Math.round(Math.abs(b.y - a.y)) : tool === "Text" ? null : 100;
    // Drawn inside a frame, it goes into the deepest frame under the start point.
    const under = document.elementsFromPoint(gesture.start.cx, gesture.start.cy).find((el) => world.contains(el) && el.dataset?.component === "Frame");
    const parent = under?.dataset.nodeId ?? null;
    const node = {
      Frame: { component: "Frame", name: "Frame", style: { display: "flex", flexDirection: "column", gap: "8px", padding: "16px", background: "#ffffff", ...(parent ? { background: "#eef3ff", borderRadius: "8px" } : {}) } },
      Rectangle: { component: "Rectangle", name: "Rectangle", style: { background: "#d9d9d9" } },
      Text: { component: "Text", name: "Text", text: "Text", style: { fontSize: "16px", lineHeight: "1.4", color: "#111111", fontFamily: "system-ui" } },
    }[tool];
    if (w) node.style.width = `${w}px`;
    if (h) node.style.height = `${h}px`;
    if (!parent) Object.assign(node, { x: Math.round(Math.min(a.x, b.x)), y: Math.round(Math.min(a.y, b.y)) });
    store.transact(`Add ${node.name}`, () => {
      const id = store.insert(node, { parent });
      store.select(id);
    });
    store.setUI({ tool: "Move" });
  }

  // ---------- Wheel: pan, and zoom with Ctrl or a pinch ----------
  root.addEventListener("wheel", (event) => {
    event.preventDefault();
    const { panX, panY, zoom } = store.ui;
    if (event.ctrlKey || event.metaKey) {
      // A pinch sends small deltas, a mouse wheel notch about 100; both should feel the same.
      const rate = Math.abs(event.deltaY) >= 50 ? 0.002 : 0.01;
      const next = clamp(zoom * Math.exp(-event.deltaY * rate), 0.05, 16);
      const b = base();
      const px = event.clientX - b.left;
      const py = event.clientY - b.top;
      store.setUI({ zoom: next, panX: px - ((px - panX) * next) / zoom, panY: py - ((py - panY) * next) / zoom });
    } else store.setUI({ panX: panX - event.deltaX, panY: panY - event.deltaY });
  }, { passive: false });

  // ---------- View commands ----------
  function zoomToRect(r) {
    // Nothing to fit (an empty page) leaves the view where it is, rather than sending it to NaN.
    if (![r.x, r.y, r.w, r.h].every(Number.isFinite) || r.w <= 0 || r.h <= 0) return;
    const b = base();
    const pad = 48;
    const zoom = clamp(Math.min((b.width - pad * 2) / r.w, (b.height - pad * 2) / r.h), 0.05, 4);
    store.setUI({ zoom, panX: (b.width - r.w * zoom) / 2 - r.x * zoom, panY: (b.height - r.h * zoom) / 2 - r.y * zoom });
  }
  const worldRect = (ids) => {
    const { panX, panY, zoom } = store.ui;
    const u = union(ids.map(rectOf).filter(Boolean));
    return { x: (u.x - panX) / zoom, y: (u.y - panY) / zoom, w: u.w / zoom, h: u.h / zoom };
  };
  const view = {
    zoomToFit: () => zoomToRect(worldRect(store.roots().map((n) => n.id))),
    zoomToSelection: () => store.selection().length && zoomToRect(worldRect(store.selection())),
    zoomTo100: () => {
      const b = base();
      const { panX, panY, zoom } = store.ui;
      const cx = b.width / 2;
      const cy = b.height / 2;
      store.setUI({ zoom: 1, panX: cx - (cx - panX) / zoom, panY: cy - (cy - panY) / zoom });
    },
    setSpace(down) {
      spaceDown = down;
      root.classList.toggle("space", down);
    },
    setAlt(down) {
      altDown = down;
      renderOverlay();
    },
  };

  // A change that touched only styles rewrites those elements' style attributes in place, which is
  // cheap, instead of rebuilding every element. False when an element is missing or draws itself.
  function patchStyles(ids) {
    for (const id of ids) {
      const node = store.get(id);
      const el = world.querySelector(`[data-node-id="${CSS.escape(id)}"]`);
      if (!node || !el || nodeRenderers[node.component]) return false;
      el.removeAttribute("style");
      Object.assign(el.style, { margin: "0", boxSizing: "border-box" }, node.style);
      if (node.hidden) el.style.visibility = "hidden";
    }
    return true;
  }

  store.subscribe((reason, change) => {
    if (reason === "ui") applyView();
    else if (reason === "selection") renderOverlay();
    else if (reason === "document" && change?.style && patchStyles(change.style)) renderOverlay();
    else renderDocument();
  });
  new ResizeObserver(() => renderOverlay()).observe(root);
  renderDocument();
  return view;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const box = (r) => `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const normalize = (m) => ({ x: Math.min(m.x, m.x2), y: Math.min(m.y, m.y2), w: Math.abs(m.x2 - m.x), h: Math.abs(m.y2 - m.y) });
const contains = (r, x, y) => r && x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h;
const intersects = (r, m) => r && r.x < m.x + m.w && r.x + r.w > m.x && r.y < m.y + m.h && r.y + r.h > m.y;
function union(rects) {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y };
}
