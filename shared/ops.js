// What travels between clients and the server in live sync: the difference between two states of a file as a short
// list of edits, and the application of such a list. Plain data and plain functions, so the page and the server
// both import this one file.
//
// A state is { nodes, pages, tokens, threads }. Its elements and comment threads are lists of things with an `id`;
// pages and tokens are lists that always travel whole. An edit is one of:
//
//   { op: "node", id, value }     put this element (value) in place, or remove it (value null)
//   { op: "order", ids }          the order of the elements: the layers' stacking, and each parent's children
//   { op: "pages", value }        the pages, whole
//   { op: "tokens", value }       the theme tokens, whole
//   { op: "thread", id, value }   a comment thread, or its removal
//
// Two people changing the same element at once is settled by whoever arrives last, element by element.

const MAX_OPS = 5000;
const KINDS = new Set(["node", "order", "pages", "tokens", "thread"]);

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const idsOf = (items) => items.map((item) => item.id);

// ---------- Finding the difference ----------
/** Edits of one kind that add, change and then remove the items of `before` to reach `after`. */
function itemEdits(kind, before, after) {
  const was = new Map(before.map((item) => [item.id, item]));
  const now = new Map(after.map((item) => [item.id, item]));
  const edits = [];
  for (const [id, item] of now) if (!was.has(id) || !equal(was.get(id), item)) edits.push({ op: kind, id, value: item });
  for (const id of was.keys()) if (!now.has(id)) edits.push({ op: kind, id, value: null });
  return edits;
}

/** The edits that turn state `a` into state `b`. */
export function diff(a, b) {
  const edits = itemEdits("node", a.nodes, b.nodes);

  // Applying the element edits keeps the old order and appends new elements, so an order edit is only needed when
  // that is not the order wanted.
  const kept = new Set(idsOf(b.nodes)), known = new Set(idsOf(a.nodes));
  const resulting = [...idsOf(a.nodes).filter((id) => kept.has(id)), ...idsOf(b.nodes).filter((id) => !known.has(id))];
  if (!equal(resulting, idsOf(b.nodes))) edits.push({ op: "order", ids: idsOf(b.nodes) });

  if (!equal(a.pages, b.pages)) edits.push({ op: "pages", value: b.pages });
  if (!equal(a.tokens, b.tokens)) edits.push({ op: "tokens", value: b.tokens });
  edits.push(...itemEdits("thread", a.threads ?? [], b.threads ?? []));
  return edits;
}

// ---------- Applying edits ----------
/** Puts `value` in the list where the item with this id is (or at the end), or takes the item out when value is null. */
function setItem(list, id, value) {
  const at = list.findIndex((item) => item.id === id);
  if (value === null) { if (at >= 0) list.splice(at, 1); }
  else if (at >= 0) list[at] = value;
  else list.push(value);
}

/** Applies edits to a state, in place, and returns it. */
export function apply(state, edits) {
  for (const edit of edits) {
    switch (edit.op) {
      case "node":
        setItem(state.nodes, edit.id, edit.value);
        break;
      case "order": {
        const byId = new Map(state.nodes.map((n) => [n.id, n]));
        const named = new Set(edit.ids);
        const ordered = edit.ids.filter((id) => byId.has(id)).map((id) => byId.get(id));
        // An element only the receiver knows stays, at the end.
        state.nodes = [...ordered, ...state.nodes.filter((n) => !named.has(n.id))];
        break;
      }
      case "pages":
        state.pages = edit.value;
        break;
      case "tokens":
        state.tokens = edit.value;
        break;
      case "thread":
        state.threads ??= [];
        setItem(state.threads, edit.id, edit.value);
        break;
    }
  }
  return state;
}

// ---------- Checking what arrives ----------
function validEdit(edit) {
  if (!edit || !KINDS.has(edit.op)) return false;
  switch (edit.op) {
    case "node":
    case "thread":
      return typeof edit.id === "string" && (edit.value === null || (typeof edit.value === "object" && edit.value.id === edit.id));
    case "order":
      return Array.isArray(edit.ids) && edit.ids.every((id) => typeof id === "string");
    default:
      return Array.isArray(edit.value);
  }
}

/** Whether a list from the network is shaped like edits, before anything is applied. */
export function validOps(ops) {
  return Array.isArray(ops) && ops.length <= MAX_OPS && ops.every(validEdit);
}
