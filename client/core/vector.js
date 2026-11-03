// Vector geometry: a network of vertices and the edges between them, with no drawing in it. A vertex is
// { x, y }. An edge joins two vertices, { a, b }, and may bend: ta and tb are the tangents at its two
// ends, as [dx, dy] offsets from the vertex. Any number of edges may meet at a vertex, so a network can
// branch, hold several lines, and enclose regions; the regions are the loops, and only they are filled.
// Vectors made before networks, { points, closed }, are read as one line of vertices.

export const num = (v) => Math.round(v * 100) / 100;
const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];

/** The network of a vector, whichever way it was saved. */
export function networkOf(vector) {
  if (vector.vertices) return { vertices: vector.vertices, edges: vector.edges ?? [] };
  const points = vector.points ?? [];
  const vertices = points.map(({ x, y }) => ({ x, y }));
  const edges = [];
  const join = (i, j) => {
    const edge = { a: i, b: j };
    const out = points[i].ox || points[i].oy ? [points[i].ox ?? 0, points[i].oy ?? 0] : null;
    const into = points[j].ix || points[j].iy ? [points[j].ix ?? 0, points[j].iy ?? 0] : null;
    if (out) edge.ta = out;
    if (into) edge.tb = into;
    edges.push(edge);
  };
  for (let i = 1; i < points.length; i++) join(i - 1, i);
  if (vector.closed && points.length > 2) join(points.length - 1, 0);
  return { vertices, edges };
}

/** The lines the network is made of, each a run of edges from one vertex to the next that has other than two edges, or round a loop. */
export function chainsOf({ vertices, edges }) {
  const at = vertices.map(() => []);
  edges.forEach((e, i) => { at[e.a].push(i); at[e.b].push(i); });
  const used = new Set();
  const chains = [];
  const walk = (start, first) => {
    const steps = [];
    let v = start;
    let ei = first;
    for (;;) {
      used.add(ei);
      const e = edges[ei];
      const forward = e.a === v;
      const to = forward ? e.b : e.a;
      steps.push({ edge: ei, from: v, to, forward });
      v = to;
      if (at[v].length !== 2) break;
      const next = at[v].find((x) => !used.has(x));
      if (next === undefined) break;
      ei = next;
    }
    chains.push({ steps, closed: v === start });
  };
  vertices.forEach((_, v) => { if (at[v].length !== 2) for (const e of at[v]) if (!used.has(e)) walk(v, e); });
  edges.forEach((e, i) => { if (!used.has(i)) walk(e.a, i); }); // what is left is loops of plain vertices
  return chains;
}

/** The path's `d`. With `loopsOnly`, just the closed chains: what the fill is drawn from. */
export function pathData(vector, { loopsOnly = false } = {}) {
  const { vertices, edges } = networkOf(vector);
  let d = "";
  for (const chain of chainsOf({ vertices, edges })) {
    if (loopsOnly && !chain.closed) continue;
    const first = vertices[chain.steps[0].from];
    d += `M${num(first.x)} ${num(first.y)}`;
    for (const { edge, from, to, forward } of chain.steps) {
      const e = edges[edge];
      const out = forward ? e.ta : e.tb;
      const into = forward ? e.tb : e.ta;
      const u = vertices[from], v = vertices[to];
      d += out || into ? `C${num(u.x + (out?.[0] ?? 0))} ${num(u.y + (out?.[1] ?? 0))} ${num(v.x + (into?.[0] ?? 0))} ${num(v.y + (into?.[1] ?? 0))} ${num(v.x)} ${num(v.y)}` : `L${num(v.x)} ${num(v.y)}`;
    }
    if (chain.closed) d += "Z";
  }
  return d;
}

/** The box around the vertices and their tangent ends. */
export function boundsOf(vector) {
  const { vertices, edges } = networkOf(vector);
  const xs = vertices.map((v) => v.x), ys = vertices.map((v) => v.y);
  for (const e of edges) for (const [vertex, t] of [[vertices[e.a], e.ta], [vertices[e.b], e.tb]]) if (t) { xs.push(vertex.x + t[0]); ys.push(vertex.y + t[1]); }
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/** A network from a run of anchors, as the Pen draws it: { x, y, ix?, iy?, ox?, oy? }, closed or not. */
export function networkFromChain(points, closed) {
  const vertices = points.map(({ x, y }) => ({ x, y }));
  const edges = [];
  const join = (i, j) => {
    const edge = { a: i, b: j };
    if (points[i].ox || points[i].oy) edge.ta = [points[i].ox ?? 0, points[i].oy ?? 0];
    if (points[j].ix || points[j].iy) edge.tb = [points[j].ix ?? 0, points[j].iy ?? 0];
    edges.push(edge);
  };
  for (let i = 1; i < points.length; i++) join(i - 1, i);
  if (closed && points.length > 2) join(points.length - 1, 0);
  return { vertices, edges };
}

/** The point at `t` along an edge (0 at a, 1 at b). */
export function pointOn({ vertices, edges }, edge, t) {
  const e = edges[edge];
  const a = [vertices[e.a].x, vertices[e.a].y], b = [vertices[e.b].x, vertices[e.b].y];
  const c1 = e.ta ? [a[0] + e.ta[0], a[1] + e.ta[1]] : a, c2 = e.tb ? [b[0] + e.tb[0], b[1] + e.tb[1]] : b;
  const q = [lerp(a, c1, t), lerp(c1, c2, t), lerp(c2, b, t)];
  const r = [lerp(q[0], q[1], t), lerp(q[1], q[2], t)];
  return { point: lerp(r[0], r[1], t), q, r, a, b };
}

/** The t on an edge nearest a point, by sampling. */
export function nearestT(network, edge, [x, y]) {
  let best = 0.5, bestDistance = Infinity;
  for (let i = 1; i < 40; i++) {
    const { point } = pointOn(network, edge, i / 40);
    const distance = Math.hypot(point[0] - x, point[1] - y);
    if (distance < bestDistance) { best = i / 40; bestDistance = distance; }
  }
  return { t: best, distance: bestDistance };
}

/** A new vertex on an edge at `t`, the edge cut in two with the curve kept. Returns { network, vertex }. */
export function splitEdge(network, edge, t = 0.5) {
  const { point, q, r, a, b } = pointOn(network, edge, t);
  const e = network.edges[edge];
  const vertices = [...network.vertices, { x: num(point[0]), y: num(point[1]) }];
  const added = vertices.length - 1;
  const curved = e.ta || e.tb;
  const first = { a: e.a, b: added }, second = { a: added, b: e.b };
  if (curved) {
    Object.assign(first, { ta: [q[0][0] - a[0], q[0][1] - a[1]], tb: [r[0][0] - point[0], r[0][1] - point[1]] });
    Object.assign(second, { ta: [r[1][0] - point[0], r[1][1] - point[1]], tb: [q[2][0] - b[0], q[2][1] - b[1]] });
  }
  const edges = network.edges.flatMap((x, i) => (i === edge ? [first, second] : [x]));
  return { network: { vertices, edges }, vertex: added };
}

const without = (network, gone) => {
  // Vertices in `gone` are dropped and the rest renumbered; edges to a dropped vertex go with it.
  const map = new Map();
  const vertices = network.vertices.filter((v, i) => { if (gone.has(i)) return false; map.set(i, map.size); return true; });
  const edges = network.edges.filter((e) => map.has(e.a) && map.has(e.b)).map((e) => ({ ...e, a: map.get(e.a), b: map.get(e.b) }));
  return { vertices, edges };
};

/** Deletes a vertex. A vertex on a plain line joins its two neighbours, so the line stays whole. */
export function removeVertex(network, index) {
  const touching = network.edges.map((e, i) => (e.a === index || e.b === index ? i : -1)).filter((i) => i >= 0);
  let edges = network.edges;
  if (touching.length === 2) {
    const [first, second] = touching.map((i) => network.edges[i]);
    // Each edge seen from its far end: where it goes, and its tangent there.
    const far = (e) => (e.a === index ? { v: e.b, t: e.tb } : { v: e.a, t: e.ta });
    const u = far(first), w = far(second);
    if (u.v !== w.v) {
      const bridge = { a: u.v, b: w.v };
      if (u.t) bridge.ta = u.t;
      if (w.t) bridge.tb = w.t;
      edges = [...network.edges, bridge];
    }
  }
  return without({ vertices: network.vertices, edges }, new Set([index]));
}

/** Deletes an edge, and the vertices left with no edge. */
export function removeEdge(network, index) {
  const edges = network.edges.filter((_, i) => i !== index);
  const alone = new Set(network.vertices.map((_, v) => v).filter((v) => !edges.some((e) => e.a === v || e.b === v)));
  return without({ vertices: network.vertices, edges }, alone);
}

export const defaultStroke = { color: "#111111", width: 2, cap: "round", join: "round" };
