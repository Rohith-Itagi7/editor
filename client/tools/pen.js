// The Pen tool (P) and the vector edit mode.
//
// Pen: click to lay an anchor, press and drag to pull its tangents out, click the first anchor to close the line,
// and press Enter or Escape (or double-click) to finish an open one; Backspace takes the last anchor back. With a
// vector in edit mode, the Pen on one of its vertices carries on from there, so lines branch, and ending on
// another vertex closes a loop.
//
// Edit mode (Enter on a selected vector, or a double-click on it): drag a vertex or a tangent, click an edge to
// select it, double-click an edge to put a vertex on it, double-click a vertex to make it smooth or sharp,
// Backspace deletes the selected vertex (a plain one joins its neighbours) or edge, Escape or Enter leaves.
// Every gesture is one undo step.
import { boundsOf, defaultStroke, nearestT, networkFromChain, networkOf, pathData, removeEdge, removeVertex, splitEdge } from "../core/vector.js";
import { toast } from "../ui/toast.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const CLOSE_RADIUS = 8; // screen pixels: close a line, or end it on a vertex
const SMOOTH_HANDLE = 24; // world pixels of tangent a vertex gets when it is made smooth
const DRAG_THRESHOLD = 3; // screen pixels before a press becomes a drag that pulls tangents
const BLUE = "var(--color-blue, #3b82f6)";
const FIELDS = "input, select, textarea, [contenteditable]";

const ANCHOR = ".pen-anchor[data-vertex]";
const roundTo2 = (n) => Math.round(n * 100) / 100;

/** A vector's own properties with its network replaced (a vector saved as a chain of points has none of the old ones). */
const withNetwork = (vector, network) => {
  const { points, closed, vertices, edges, ...rest } = vector;
  return { ...rest, ...network };
};

export function mountPen({ store, canvas }) {
  const layer = document.createElementNS(SVG_NS, "svg");
  layer.setAttribute("class", "pen-layer");
  canvas.append(layer);

  let draft = null; // a line being drawn: { points, cursor, from?: { id, vertex }, to?: vertex }
  let editing = null; // a vector being edited: { id, vertex, edge, origin }

  // ---------- Coordinates ----------
  const canvasBox = () => canvas.getBoundingClientRect();
  const toWorld = (event) => {
    const box = canvasBox();
    return { x: Math.round((event.clientX - box.left - store.ui.panX) / store.ui.zoom), y: Math.round((event.clientY - box.top - store.ui.panY) / store.ui.zoom) };
  };
  const toScreen = (p) => ({ x: p.x * store.ui.zoom + store.ui.panX, y: p.y * store.ui.zoom + store.ui.panY });
  /** Where a vector's own coordinates start, in world units. */
  function originOf(id) {
    const element = canvas.querySelector(`[data-node-id="${CSS.escape(id)}"]`);
    if (!element) return null;
    const box = element.getBoundingClientRect(), outer = canvasBox();
    return { x: (box.left - outer.left - store.ui.panX) / store.ui.zoom, y: (box.top - outer.top - store.ui.panY) / store.ui.zoom };
  }
  const vertexInWorld = (state, index) => {
    const v = networkOf(store.get(state.id).vector).vertices[index];
    return { x: state.origin.x + v.x, y: state.origin.y + v.y };
  };

  const svg = (tag, attributes) => {
    const element = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    return element;
  };
  const isEditable = (target) => target.matches?.(FIELDS);

  // ---------- What is drawn over the canvas ----------
  function paint() {
    layer.replaceChildren();
    if (draft) paintDraft();
    if (!editing) return;
    const node = store.get(editing.id);
    const origin = node && originOf(editing.id);
    if (!node || !origin) return stopEditing();
    editing.origin = origin;
    paintNetwork(node, origin);
  }

  function paintDraft() {
    const zoom = store.ui.zoom;
    const points = draft.points.map((p) => ({ ...p, ...toScreen(p), ix: (p.ix ?? 0) * zoom, iy: (p.iy ?? 0) * zoom, ox: (p.ox ?? 0) * zoom, oy: (p.oy ?? 0) * zoom }));
    const d = pathData({ vertices: points.map(({ x, y }) => ({ x, y })), edges: networkFromChain(points, false).edges });
    layer.append(svg("path", { d, fill: "none", stroke: BLUE, "stroke-width": 1.5 }));
    if (draft.cursor && points.length) {
      const last = points.at(-1), cursor = toScreen(draft.cursor);
      layer.append(svg("line", { x1: last.x, y1: last.y, x2: cursor.x, y2: cursor.y, stroke: BLUE, "stroke-width": 1, "stroke-dasharray": "4 3" }));
    }
    draft.points.forEach((p, i) => {
      const at = toScreen(p);
      layer.append(svg("rect", { x: at.x - 4, y: at.y - 4, width: 8, height: 8, class: "pen-anchor pen-draft", "data-point": i }));
    });
  }

  function paintNetwork(node, origin) {
    const zoom = store.ui.zoom;
    const network = networkOf(node.vector);
    const place = (v) => toScreen({ x: origin.x + v.x, y: origin.y + v.y });
    const placed = network.vertices.map(place);
    const scaled = (tangent) => tangent && [tangent[0] * zoom, tangent[1] * zoom];

    // Each edge twice: a wide invisible one to click, and the line itself.
    network.edges.forEach((edge, i) => {
      const d = pathData({ vertices: placed, edges: [{ a: edge.a, b: edge.b, ta: scaled(edge.ta), tb: scaled(edge.tb) }] });
      layer.append(svg("path", { d, class: "pen-edge-hit", "data-edge": i, fill: "none", stroke: "transparent", "stroke-width": 12 }));
      layer.append(svg("path", { d, fill: "none", stroke: BLUE, "stroke-width": editing.edge === i ? 3 : 1.5, "pointer-events": "none" }));
    });
    // Tangents of the selected vertex's edges, or of the selected edge.
    network.edges.forEach((edge, i) => {
      for (const [end, vertex, tangent] of [["a", edge.a, edge.ta], ["b", edge.b, edge.tb]]) {
        if (!tangent || !(editing.edge === i || editing.vertex === vertex)) continue;
        const v = network.vertices[vertex];
        const from = place(v), to = place({ x: v.x + tangent[0], y: v.y + tangent[1] });
        layer.append(svg("line", { x1: from.x, y1: from.y, x2: to.x, y2: to.y, stroke: BLUE, "stroke-width": 1 }));
        layer.append(svg("circle", { cx: to.x, cy: to.y, r: 4, class: "pen-handle", "data-edge": i, "data-end": end }));
      }
    });
    network.vertices.forEach((v, i) => {
      const at = place(v);
      layer.append(svg("rect", { x: at.x - 4, y: at.y - 4, width: 8, height: 8, class: `pen-anchor${editing.vertex === i ? " on" : ""}`, "data-vertex": i }));
    });
  }

  // ---------- The Pen: drawing a line ----------
  /** The vertex of the vector being edited that a click landed on, or null. */
  const vertexUnder = (event) => {
    const target = event.target.closest?.(ANCHOR);
    return target ? Number(target.dataset.vertex) : null;
  };
  const relativeTo = (p, origin) => ({ x: roundTo2(p.x - origin.x), y: roundTo2(p.y - origin.y) });

  /** A line carried on from a vertex: its new anchors join the network being edited. */
  function finishBranch(drawn, closed) {
    const { from, to, points } = drawn;
    const node = store.get(from.id);
    const origin = originOf(from.id);
    const network = structuredClone(networkOf(node.vector));
    const ids = [from.vertex]; // the vertex each point of the draft ended up as
    points.slice(1).forEach((p, k) => {
      const isLast = k === points.length - 2;
      if (isLast && to !== undefined) ids.push(to);
      else { network.vertices.push(relativeTo(p, origin)); ids.push(network.vertices.length - 1); }
    });
    if (closed && to === undefined) ids.push(from.vertex);
    points.forEach((p, i) => {
      if (i === points.length - 1) return;
      const edge = { a: ids[i], b: ids[i + 1] };
      if (p.ox || p.oy) edge.ta = [p.ox ?? 0, p.oy ?? 0];
      const next = points[i + 1];
      if (next.ix || next.iy) edge.tb = [next.ix ?? 0, next.iy ?? 0];
      if (edge.a !== edge.b) network.edges.push(edge);
    });
    store.transact("Draw path", () => { store.update(from.id, { vector: withNetwork(node.vector, network) }); refit(from.id); });
    editing.vertex = ids.at(-1);
  }

  /** A new vector from a line drawn on its own. */
  function finishNewVector(drawn, closed) {
    const { points } = drawn;
    const bounds = boundsOf({ vertices: points.map(({ x, y }) => ({ x, y })), edges: networkFromChain(points, false).edges });
    const local = points.map((p) => ({ ...p, x: p.x - bounds.minX, y: p.y - bounds.minY }));
    let id;
    store.transact("Draw path", () => {
      id = store.insert({
        component: "Vector", name: "Path", x: bounds.minX, y: bounds.minY,
        style: { width: `${Math.max(1, bounds.maxX - bounds.minX)}px`, height: `${Math.max(1, bounds.maxY - bounds.minY)}px` },
        vector: { ...networkFromChain(local, Boolean(closed) && local.length > 2), fill: null, stroke: { ...defaultStroke } },
      });
    });
    store.setUI({ tool: "Move" });
    store.select(id);
  }

  function finish(closed) {
    const drawn = draft;
    draft = null;
    if (!drawn || drawn.points.length < 2) return paint();
    // The draft is cleared first: finishing changes the document, and what listens to that must not see it again.
    if (drawn.from) finishBranch(drawn, closed);
    else finishNewVector(drawn, closed);
    paint();
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (editing && store.ui.tool !== "Pen") return pressInEditMode(event);
    if (store.ui.tool !== "Pen") return;
    event.stopPropagation();
    event.preventDefault();
    if (store.readOnly) return toast("Drawing needs a file of your own");

    const p = toWorld(event);
    const vertex = editing ? vertexUnder(event) : null;
    if (!draft && vertex !== null) { // carry on from this vertex
      const v = networkOf(store.get(editing.id).vector).vertices[vertex];
      draft = { points: [{ x: editing.origin.x + v.x, y: editing.origin.y + v.y }], cursor: p, from: { id: editing.id, vertex } };
      return paint();
    }
    if (draft?.from && vertex !== null && draft.points.length >= 2) { // end the branch on another vertex
      draft.to = vertex;
      draft.points.push({ ...vertexInWorld(editing, vertex) });
      return finish(false);
    }
    draft ??= { points: [], cursor: p };
    const first = draft.points[0];
    if (!draft.from && first && draft.points.length > 2) {
      const box = canvasBox(), at = toScreen(first);
      if (Math.hypot(at.x - (event.clientX - box.left), at.y - (event.clientY - box.top)) <= CLOSE_RADIUS) return finish(true);
    }

    // Press: lay the anchor. Drag: pull its tangents out, mirrored, so the anchor is smooth.
    const point = { x: p.x, y: p.y };
    draft.points.push(point);
    const drag = (e) => {
      const q = toWorld(e);
      const dx = q.x - point.x, dy = q.y - point.y;
      if (Math.hypot(dx, dy) * store.ui.zoom > DRAG_THRESHOLD) Object.assign(point, { ox: dx, oy: dy, ix: -dx, iy: -dy });
      paint();
    };
    const release = () => { removeEventListener("pointermove", drag); removeEventListener("pointerup", release); };
    addEventListener("pointermove", drag);
    addEventListener("pointerup", release);
    paint();
  }, true);

  canvas.addEventListener("pointermove", (event) => {
    if (draft && store.ui.tool === "Pen" && !event.buttons) { draft.cursor = toWorld(event); paint(); }
  });
  canvas.addEventListener("dblclick", (event) => {
    if (draft) { // the double-click's first click laid a point that is not wanted
      draft.points.pop();
      finish(false);
      event.stopPropagation();
      return;
    }
    const node = store.get(store.selection()[0]);
    if (!editing && store.selection().length === 1 && node?.component === "Vector" && !store.readOnly) startEditing(node.id);
  }, true);

  // ---------- Editing a vector ----------
  function startEditing(id) {
    editing = { id, vertex: null, edge: null, origin: originOf(id) };
    store.setUI({ vectorEditing: id });
    paint();
  }
  function stopEditing() {
    editing = null;
    store.setUI({ vectorEditing: null });
    paint();
  }

  /** Moving things can leave the network outside its box: the box follows, and the vertices are rebased to it. */
  function refit(id) {
    const node = store.get(id);
    const network = networkOf(node.vector);
    const b = boundsOf(network);
    const fits = b.minX === 0 && b.minY === 0 && Math.abs(b.maxX - parseFloat(node.style.width)) < 0.5 && Math.abs(b.maxY - parseFloat(node.style.height)) < 0.5;
    if (fits && node.vector.vertices) return;
    store.update(id, {
      vector: withNetwork(node.vector, { vertices: network.vertices.map((v) => ({ x: v.x - b.minX, y: v.y - b.minY })), edges: network.edges }),
      style: { width: `${Math.max(1, b.maxX - b.minX)}px`, height: `${Math.max(1, b.maxY - b.minY)}px` },
      ...(node.parent == null ? { x: (node.x ?? 0) + b.minX, y: (node.y ?? 0) + b.minY } : {}),
    });
  }

  /** One undo step that changes the edited network: `make` gets a copy and returns the new one (or nothing). */
  function change(label, make, merge) {
    const id = editing.id;
    store.transact(label, () => {
      const node = store.get(id);
      const next = make(structuredClone(networkOf(node.vector)));
      if (!next) return;
      store.update(id, { vector: withNetwork(node.vector, next) });
      refit(id);
    }, merge ? { merge } : {});
  }

  /** A press in edit mode: on an edge it selects it; on a vertex or a tangent handle it starts a drag. */
  function pressInEditMode(event) {
    const vertexEl = event.target.closest?.(ANCHOR);
    const handleEl = event.target.closest?.(".pen-handle");
    const edgeEl = event.target.closest?.(".pen-edge-hit");
    if (!vertexEl && !handleEl && !edgeEl) return;
    event.stopPropagation();
    event.preventDefault();
    const id = editing.id;
    if (edgeEl) {
      editing.edge = Number(edgeEl.dataset.edge);
      editing.vertex = null;
      return paint();
    }

    const start = toWorld(event);
    const before = structuredClone(networkOf(store.get(id).vector));
    let dragTo;
    if (vertexEl) {
      const index = Number(vertexEl.dataset.vertex);
      editing.vertex = index;
      editing.edge = null;
      const original = before.vertices[index];
      dragTo = (e) => {
        const q = toWorld(e);
        change("Edit path", (n) => { n.vertices[index] = { x: original.x + q.x - start.x, y: original.y + q.y - start.y }; return n; }, `${id}-vertex-${index}`);
      };
    } else {
      const edgeIndex = Number(handleEl.dataset.edge), end = handleEl.dataset.end;
      const grabbed = before.edges[edgeIndex];
      const vertex = end === "a" ? grabbed.a : grabbed.b;
      editing.vertex = vertex;
      const key = end === "a" ? "ta" : "tb";
      const original = grabbed[key];
      // At a vertex with two edges the two tangents stay in line, unless Alt is held.
      const others = before.edges.map((e, i) => [e, i]).filter(([e, i]) => i !== edgeIndex && (e.a === vertex || e.b === vertex));
      dragTo = (e) => {
        const q = toWorld(e);
        const tangent = [original[0] + q.x - start.x, original[1] + q.y - start.y];
        change("Edit path", (n) => {
          n.edges[edgeIndex][key] = tangent;
          if (!e.altKey && others.length === 1) {
            const [other, i] = others[0];
            n.edges[i][other.a === vertex ? "ta" : "tb"] = [-tangent[0], -tangent[1]];
          }
          return n;
        }, `${id}-tangent-${edgeIndex}-${end}`);
      };
    }
    const move = (e) => { dragTo(e); paint(); };
    const up = (e) => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); move(e); };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
    paint();
  }

  /** A vertex's tangents: gone when it was smooth; else along the line between its neighbours, or along each edge. */
  function toggleSmooth(network, index) {
    const touching = network.edges.map((e, i) => [e, i]).filter(([e]) => e.a === index || e.b === index);
    const tangentKey = (e) => (e.a === index ? "ta" : "tb");
    const wasSmooth = touching.some(([e]) => e[tangentKey(e)]);
    const v = network.vertices[index];
    const farEnd = ([e]) => network.vertices[e.a === index ? e.b : e.a];
    for (const [e] of touching) delete e[tangentKey(e)];
    if (!wasSmooth) {
      let along = null;
      if (touching.length === 2) {
        const [p, q] = [farEnd(touching[0]), farEnd(touching[1])];
        const length = Math.hypot(q.x - p.x, q.y - p.y) || 1;
        along = [(q.x - p.x) / length, (q.y - p.y) / length];
      }
      touching.forEach(([e], k) => {
        const far = farEnd([e]);
        e[tangentKey(e)] = along ? along.map((c) => c * SMOOTH_HANDLE * (k === 0 ? -1 : 1)) : [(far.x - v.x) / 3, (far.y - v.y) / 3];
      });
    }
    return network;
  }

  // Double-click: a vertex goes smooth or sharp; an edge gets a vertex where it was clicked.
  layer.addEventListener("dblclick", (event) => {
    if (!editing) return;
    const vertexEl = event.target.closest?.(ANCHOR);
    const edgeEl = event.target.closest?.(".pen-edge-hit");
    if (!vertexEl && !edgeEl) return;
    event.stopPropagation();
    if (vertexEl) {
      const index = Number(vertexEl.dataset.vertex);
      change("Edit path", (network) => toggleSmooth(network, index));
    } else {
      const index = Number(edgeEl.dataset.edge);
      const p = toWorld(event);
      const { t } = nearestT(networkOf(store.get(editing.id).vector), index, [p.x - editing.origin.x, p.y - editing.origin.y]);
      change("Edit path", (network) => {
        const split = splitEdge(network, index, t);
        editing.vertex = split.vertex;
        editing.edge = null;
        return split.network;
      });
    }
    paint();
  }, true);

  // ---------- Keys ----------
  function draftKey(event) {
    const handled = () => { event.stopPropagation(); event.preventDefault(); };
    if (event.key === "Enter") { handled(); finish(false); }
    else if (event.key === "Escape") {
      handled();
      if (draft.points.length >= 2) finish(false);
      else { draft = null; paint(); }
    } else if (event.key === "Backspace") {
      handled();
      draft.points.pop();
      if (!draft.points.length) draft = null;
      paint();
    }
  }

  function editKey(event) {
    if (event.key === "Escape" || event.key === "Enter") {
      event.stopPropagation();
      event.preventDefault();
      return stopEditing();
    }
    const isDelete = event.key === "Backspace" || event.key === "Delete";
    if (!isDelete || (editing.vertex === null && editing.edge === null)) return;
    event.stopPropagation();
    event.preventDefault();
    const network = networkOf(store.get(editing.id).vector);
    const after = editing.edge !== null ? removeEdge(network, editing.edge) : removeVertex(network, editing.vertex);
    if (after.vertices.length < 2) return toast("A path needs two anchors; delete the element instead");
    change("Delete path part", () => after);
    editing.vertex = null;
    editing.edge = null;
    paint();
  }

  addEventListener("keydown", (event) => {
    if (isEditable(event.target)) return;
    if (draft && store.ui.tool === "Pen") return draftKey(event);
    if (editing) return editKey(event);
    const node = store.get(store.selection()[0]);
    const plainEnter = event.key === "Enter" && !event.metaKey && !event.ctrlKey;
    if (plainEnter && store.selection().length === 1 && node?.component === "Vector" && !store.readOnly) {
      event.stopPropagation();
      event.preventDefault();
      startEditing(node.id);
    }
  }, true);

  store.subscribe((reason) => {
    // Leaving the Pen finishes the line being drawn, or drops it when it has fewer than two anchors.
    if (draft && store.ui.tool !== "Pen") {
      if (draft.points.length >= 2) finish(false);
      else draft = null;
    }
    if (editing && reason === "selection" && store.selection()[0] !== editing.id) return stopEditing();
    if (reason === "ui" || reason === "document" || reason === "page") paint();
  });
}
