import test from "node:test";
import assert from "node:assert/strict";
import { apply, diff, validOps } from "../shared/ops.js";
import { createStore } from "../client/core/store.js";

const el = (id, extra = {}) => ({ id, component: "Frame", name: id, parent: null, page: "page-1", style: {}, ...extra });
const state = (nodes, extra = {}) => ({ nodes, pages: [{ id: "page-1", label: "Page 1" }], tokens: [], threads: [], ...extra });
const clone = (x) => structuredClone(x);

test("what diff finds, apply makes: any edit, in any order", () => {
  const a = state([el("1"), el("2", { parent: "1" }), el("3")]);
  const cases = [
    state([el("1"), el("3")]), // a removal, with its child
    state([el("1"), el("2", { parent: "1", name: "renamed" }), el("3")]),
    state([el("3"), el("1"), el("2", { parent: "1" })]), // a reorder
    state([el("1"), el("9"), el("2", { parent: "1" }), el("3")]), // an insert in the middle
    state(a.nodes, { pages: [{ id: "page-1", label: "One" }, { id: "page-x", label: "Two" }], tokens: [{ id: "t", type: "color", name: "A", value: "#fff" }], threads: [{ id: "th", page: "page-1", x: 1, y: 2, messages: [], readBy: [] }] }),
  ];
  for (const b of cases) {
    const ops = diff(a, b);
    assert.ok(validOps(ops));
    assert.deepEqual(apply(clone(a), ops), b);
  }
  assert.deepEqual(diff(a, clone(a)), []);
});

test("two people's edits to different elements both stand; the same element goes to the last", () => {
  const base = state([el("1"), el("2")]);
  const mine = diff(base, state([el("1", { name: "mine" }), el("2")]));
  const theirs = diff(base, state([el("1"), el("2", { name: "theirs" })]));
  const merged = apply(apply(clone(base), mine), theirs);
  assert.deepEqual(merged.nodes.map((n) => n.name), ["mine", "theirs"]);
  const clash = apply(apply(clone(base), diff(base, state([el("1", { name: "first" }), el("2")]))), diff(base, state([el("1", { name: "second" }), el("2")])));
  assert.equal(clash.nodes[0].name, "second");
});

test("edits from the network are checked before they are applied", () => {
  assert.equal(validOps("x"), false);
  assert.equal(validOps([{ op: "drop table" }]), false);
  assert.equal(validOps([{ op: "node", id: "1", value: { id: "2" } }]), false);
  assert.equal(validOps([{ op: "pages", value: "no" }]), false);
  assert.equal(validOps([{ op: "node", id: "1", value: null }, { op: "order", ids: ["1"] }]), true);
});

test("store: remote edits arrive without history, and your own undo leaves them alone", () => {
  const store = createStore([el("1")]);
  store.transact("mine", () => store.insert({ component: "Frame", name: "Mine", x: 0, y: 0, style: {} }));
  store.applyRemote([{ op: "node", id: "9", value: el("9", { name: "Theirs" }) }]);
  assert.deepEqual(store.all().map((n) => n.name), ["1", "Mine", "Theirs"]);
  assert.equal(store.history().undo.length, 1);
  store.undo();
  assert.deepEqual(store.all().map((n) => n.name), ["1", "Theirs"]);
});

test("store: ids carry the client's tag, so two clients never make the same one", () => {
  const a = createStore([], { clientTag: "aaaa" });
  const b = createStore([], { clientTag: "bbbb" });
  a.transact("n", () => a.insert({ component: "Frame", name: "A", style: {} }));
  b.transact("n", () => b.insert({ component: "Frame", name: "B", style: {} }));
  assert.match(a.all()[0].id, /^aaaa\d+$/);
  assert.match(b.all()[0].id, /^bbbb\d+$/);
  a.transact("p", () => a.addPage());
  assert.match(a.pages()[1].id, /^page-aaaa\d+$/);
});
