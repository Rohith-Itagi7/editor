import test from "node:test";
import assert from "node:assert/strict";
import { boundsOf, chainsOf, nearestT, networkFromChain, networkOf, pathData, pointOn, removeEdge, removeVertex, splitEdge } from "../client/core/vector.js";

const square = () => ({ vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], edges: [{ a: 0, b: 1 }, { a: 1, b: 2 }, { a: 2, b: 3 }, { a: 3, b: 0 }] });

test("a vector saved before networks reads as one line of vertices", () => {
  const legacy = { points: [{ x: 0, y: 0, ox: 5, oy: 0 }, { x: 10, y: 10, ix: -5, iy: 0 }, { x: 20, y: 0 }], closed: false };
  const network = networkOf(legacy);
  assert.equal(network.vertices.length, 3);
  assert.deepEqual(network.edges, [{ a: 0, b: 1, ta: [5, 0], tb: [-5, 0] }, { a: 1, b: 2 }]);
  assert.deepEqual(networkOf({ ...legacy, closed: true }).edges.at(-1), { a: 2, b: 0 });
});

test("lines and loops: a loop is one closed path, a line is open, a branch makes three lines", () => {
  assert.deepEqual(chainsOf(square()).map((c) => [c.closed, c.steps.length]), [[true, 4]]);
  assert.equal(pathData(square()), "M0 0L10 0L10 10L0 10L0 0Z");
  const line = { vertices: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }], edges: [{ a: 0, b: 1 }, { a: 1, b: 2 }] };
  assert.deepEqual(chainsOf(line).map((c) => [c.closed, c.steps.length]), [[false, 2]]);
  const fork = { vertices: [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }, { x: 5, y: 10 }], edges: [{ a: 0, b: 1 }, { a: 1, b: 2 }, { a: 1, b: 3 }] };
  assert.equal(chainsOf(fork).length, 3);
  // Only loops are filled.
  assert.equal(pathData(line, { loopsOnly: true }), "");
  assert.equal(pathData(square(), { loopsOnly: true }), pathData(square()));
});

test("a curve is drawn with its tangents, from either end", () => {
  const curved = { vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }], edges: [{ a: 0, b: 1, ta: [30, 40], tb: [-30, 40] }] };
  assert.equal(pathData(curved), "M0 0C30 40 70 40 100 0");
  // The same edge written the other way round is drawn the same, from the vertex that comes first.
  assert.equal(pathData({ vertices: curved.vertices, edges: [{ a: 1, b: 0, ta: [-30, 40], tb: [30, 40] }] }), "M0 0C30 40 70 40 100 0");
  assert.deepEqual(boundsOf(curved), { minX: 0, minY: 0, maxX: 100, maxY: 40 });
});

test("a vertex put on an edge keeps the curve and the neighbours", () => {
  const curved = { vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }], edges: [{ a: 0, b: 1, ta: [30, 40], tb: [-30, 40] }] };
  const { network, vertex } = splitEdge(curved, 0, 0.5);
  assert.equal(vertex, 2);
  assert.deepEqual(network.edges.map((e) => [e.a, e.b]), [[0, 2], [2, 1]]);
  // The two halves meet where the whole curve was at its middle, and the whole shape has not moved.
  const middle = pointOn(curved, 0, 0.5).point;
  assert.deepEqual([network.vertices[2].x, network.vertices[2].y], middle.map((c) => Math.round(c * 100) / 100));
  const halves = [pointOn(network, 0, 0.5).point, pointOn(network, 1, 0.5).point];
  const whole = [pointOn(curved, 0, 0.25).point, pointOn(curved, 0, 0.75).point];
  halves.forEach((p, i) => whole[i].forEach((c, k) => assert.ok(Math.abs(c - p[k]) < 0.05)));
  // A straight edge stays straight.
  assert.equal(splitEdge(square(), 0).network.edges[0].ta, undefined);
  // The nearest point on the top side to (2.5, 3) is 2.5 along it.
  const near = nearestT(square(), 0, [2.5, 3]);
  assert.ok(Math.abs(pointOn(square(), 0, near.t).point[0] - 2.5) < 0.3 && Math.abs(near.distance - 3) < 0.1);
});

test("deleting: a plain vertex joins its neighbours, a corner of three edges takes them with it, an edge leaves no stray vertex", () => {
  const joined = removeVertex(square(), 1);
  assert.equal(joined.vertices.length, 3);
  assert.deepEqual(chainsOf(joined).map((c) => [c.closed, c.steps.length]), [[true, 3]]); // still a loop, now a triangle
  const fork = { vertices: [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }, { x: 5, y: 10 }], edges: [{ a: 0, b: 1 }, { a: 1, b: 2 }, { a: 1, b: 3 }] };
  const cut = removeVertex(fork, 1);
  assert.equal(cut.edges.length, 0);
  const open = removeEdge(square(), 0); // breaking the loop leaves one line of four vertices
  assert.deepEqual(chainsOf(open).map((c) => [c.closed, c.steps.length]), [[false, 3]]);
  assert.equal(removeEdge({ vertices: [{ x: 0, y: 0 }, { x: 1, y: 1 }], edges: [{ a: 0, b: 1 }] }, 0).vertices.length, 0);
});

test("the Pen's run of anchors becomes a network, closed or not", () => {
  const pen = [{ x: 0, y: 0, ox: 10, oy: 0 }, { x: 50, y: 0, ix: -10, iy: 0 }, { x: 50, y: 50 }];
  assert.equal(networkFromChain(pen, false).edges.length, 2);
  assert.deepEqual(networkFromChain(pen, true).edges.at(-1), { a: 2, b: 0 });
  assert.deepEqual(networkFromChain(pen, false).edges[0], { a: 0, b: 1, ta: [10, 0], tb: [-10, 0] });
});
