// The editor's one source of truth: the document (nodes), the selection, and history.
// Every module reads through this API and writes only inside `transact`, so each edit is one
// undo step and every view hears about it through `subscribe`.
//
// A node: { id, component: "Frame" | "Text" | "Rectangle" | "Vector", name, parent: id | null,
//   style: { css props in camelCase }, text?, x?, y? (roots only, canvas position),
//   hidden?, locked?, collapsed? }
// Children keep the order of the `nodes` array.
import { cssName, moveWithinKind, typeInfo } from "./tokens.js";
import { freeName } from "./naming.js";
import { apply } from "../../shared/ops.js";

// `readOnly` is a visitor's view of a shared file (access level "read"): every write goes
// through `transact`, so refusing there is enough, and selecting and looking still work.
// `clientTag` (letters only) goes into every id this store makes, so two people adding elements, pages,
// tokens or comments at once never make the same id; without sync it is empty and ids are plain numbers.
export function createStore(initialNodes, { readOnly = false, pages: initialPages, tokens: initialTokens, threads: initialThreads, clientTag = "" } = {}) {
  let nodes = structuredClone(initialNodes);
  // Theme tokens: { id, type, name, value }, in the order shown.
  let tokens = structuredClone(initialTokens ?? []);
  // Comment threads: a pin on a page, and its messages. They are not part of
  // the document's history, so undo never takes a comment back.
  let threads = structuredClone(initialThreads ?? []);
  let nextThread = Math.max(0, ...threads.flatMap((t) => [Number(String(t.id).replace(/\D/g, "")) || 0, ...t.messages.map((m) => Number(String(m.id).replace(/\D/g, "")) || 0)])) + 1;
  let nextToken = Math.max(0, ...tokens.map((t) => Number(String(t.id).replace(/\D/g, "")) || 0)) + 1;
  let selection = [];
  // Pages: a list of { id, label }, one active,
  // and every root node on exactly one of them. Roots from before pages belong to the first.
  let pages = structuredClone(initialPages?.length ? initialPages : [{ id: "page-1", label: "Page 1" }]);
  let activePage = pages[0].id;
  const pageViews = new Map();
  for (const n of nodes) if (n.parent == null && !n.page) n.page = pages[0].id;
  let nextPage = Math.max(0, ...pages.map((p) => Number(p.id.replace(/\D/g, "")) || 0)) + 1;
  let nextId = Math.max(0, ...nodes.map((n) => Number(n.id) || 0)) + 1;
  const ui = { tool: "Move", zoom: 1, panX: 40, panY: 40, hovered: null, measuring: false };
  const undoStack = [];
  const redoStack = [];
  const listeners = new Set();
  let depth = 0;
  let pending = null;

  // Rewrites `var(--old)` in every element's styles: a token renamed or deleted keeps its uses whole.
  const rewriteVars = (from, to) => {
    for (const node of nodes) for (const [key, value] of Object.entries(node.style ?? {})) if (typeof value === "string" && value.includes(`var(${from})`)) node.style[key] = value.split(`var(${from})`).join(to);
  };
  const emit = (reason, detail) => listeners.forEach((listener) => listener(reason, detail));
  const snapshot = () => structuredClone({ nodes, selection, pages, activePage, tokens });
  // When a transaction changed nothing but element styles, say which elements and which properties
  // ({ style: ids, keys }), so the views patch those instead of rebuilding everything (a drag on a
  // number field makes one of these per frame). Any other change, in structure, text, names, tokens,
  // pages or selection, gives null.
  const styleChange = (before) => {
    const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
    if (before.nodes.length !== nodes.length || before.activePage !== activePage || !same(before.selection, selection) || !same(before.pages, pages) || !same(before.tokens, tokens)) return null;
    const ids = [], keys = new Set();
    for (let i = 0; i < nodes.length; i++) {
      const a = before.nodes[i], b = nodes[i];
      if (a.id !== b.id) return null;
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (k !== "style" && !same(a[k], b[k])) return null;
      let changed = false;
      for (const k of new Set([...Object.keys(a.style ?? {}), ...Object.keys(b.style ?? {})])) if (a.style?.[k] !== b.style?.[k]) (keys.add(k), (changed = true));
      if (changed) ids.push(b.id);
    }
    return ids.length ? { style: ids, keys } : null;
  };
  const restore = (state) => {
    nodes = state.nodes;
    tokens = state.tokens;
    pages = state.pages;
    activePage = pages.some((p) => p.id === state.activePage) ? state.activePage : pages[0].id;
    selection = state.selection.filter((id) => nodes.some((n) => n.id === id));
  };

  const api = {
    // Reading
    get: (id) => nodes.find((n) => n.id === id),
    all: () => nodes,
    children: (id) => nodes.filter((n) => n.parent === id),
    roots: () => nodes.filter((n) => n.parent == null && n.page === activePage),
    pages: () => pages,
    activePage: () => activePage,
    tokens: () => tokens,
    threads: () => threads,
    // Comments: a thread is { id, page, x, y, messages: [{ id, author: { id, name }, text, at }], readBy: [user ids] }.
    addThread({ page = activePage, x, y, text, author, mentions = [], attachments = [] }) {
      if (readOnly || (!text.trim() && !attachments.length)) return null;
      const id = `thread-${clientTag}${nextThread++}`;
      threads.push({ id, page, x, y, readBy: [author.id], messages: [{ id: `msg-${clientTag}${nextThread++}`, author, text: text.trim(), at: Date.now(), mentions, attachments }] });
      emit("threads");
      return id;
    },
    reply(threadId, text, author, { mentions = [], attachments = [] } = {}) {
      const thread = threads.find((t) => t.id === threadId);
      if (readOnly || !thread || (!text.trim() && !attachments.length)) return false;
      thread.messages.push({ id: `msg-${clientTag}${nextThread++}`, author, text: text.trim(), at: Date.now(), mentions, attachments });
      thread.readBy = [author.id];
      emit("threads");
      return true;
    },
    // Deleting the only message deletes the thread.
    deleteMessage(threadId, messageId) {
      const thread = threads.find((t) => t.id === threadId);
      if (readOnly || !thread) return;
      thread.messages = thread.messages.filter((m) => m.id !== messageId);
      if (!thread.messages.length) threads = threads.filter((t) => t !== thread);
      emit("threads");
    },
    // "open" or "resolved", (set_comment_thread_status).
    setThreadStatus(threadId, status) {
      const thread = threads.find((t) => t.id === threadId);
      if (readOnly || !thread) return false;
      thread.resolved = status === "resolved";
      emit("threads");
      return true;
    },
    markRead(threadId, userId, read) {
      const thread = threads.find((t) => t.id === threadId);
      if (!thread) return;
      thread.readBy = read ? [...new Set([...thread.readBy, userId])] : thread.readBy.filter((u) => u !== userId);
      emit("threads");
    },
    ancestors(id) {
      const out = [];
      for (let n = api.get(id); n?.parent != null; n = api.get(n.parent)) out.push(n.parent);
      return out;
    },
    rootOf: (id) => api.ancestors(id).at(-1) ?? id,
    selection: () => selection,
    selectedNodes: () => selection.map(api.get).filter(Boolean),
    isSelected: (id) => selection.includes(id),
    ui,

    // UI state: not part of the document, not in history.
    setUI(patch) {
      Object.assign(ui, patch);
      emit("ui");
    },
    // Opening a page is a view change: no undo step, and each page keeps its own camera.
    setPage(id) {
      if (id === activePage || !pages.some((p) => p.id === id)) return;
      pageViews.set(activePage, { zoom: ui.zoom, panX: ui.panX, panY: ui.panY });
      activePage = id;
      selection = [];
      Object.assign(ui, pageViews.get(id) ?? { zoom: 1, panX: 40, panY: 40 });
      emit("page");
    },
    select(ids, { add = false, toggle = false } = {}) {
      const list = [ids].flat().filter((id) => id != null);
      if (toggle) selection = list.reduce((acc, id) => (acc.includes(id) ? acc.filter((x) => x !== id) : [...acc, id]), selection);
      else selection = add ? [...new Set([...selection, ...list])] : list;
      emit("selection");
    },

    // Writing: always inside transact. `merge` folds repeated edits with the same key (typing,
    // dragging) into the last history step; `history: false` changes view state on nodes, such
    // as collapsing a layer, without an undo step.
    readOnly,
    transact(label, fn, { merge, history = true } = {}) {
      if (readOnly) return;
      if (depth > 0) return fn();
      const before = history ? snapshot() : null;
      depth++;
      try {
        fn();
      } finally {
        depth--;
      }
      if (!history) return emit("document");
      const now = Date.now();
      const last = undoStack.at(-1);
      if (merge && last?.merge === merge && now - last.at < 1200) last.at = now;
      else undoStack.push({ label, before, merge, at: now });
      if (undoStack.length > 200) undoStack.shift();
      redoStack.length = 0;
      emit("document", styleChange(before));
    },
    update(ids, patch) {
      for (const id of [ids].flat()) {
        const node = api.get(id);
        if (!node) continue;
        const next = typeof patch === "function" ? patch(node) : patch;
        const { style, ...rest } = next;
        Object.assign(node, rest);
        if (style) {
          node.style = { ...node.style, ...style };
          for (const [key, value] of Object.entries(style)) if (value === undefined || value === "") delete node.style[key];
        }
      }
    },
    updateStyle: (ids, style) => api.update(ids, { style }),
    // Pages (call inside `transact`). A new page is "Page N", the first N not taken, placed after
    // the active one and opened; the only page cannot be deleted, and deleting the open one opens
    // the next, else the previous.
    addPage({ activate = true } = {}) {
      const first = pages.length + 1;
      const label = freeName((name) => pages.some((p) => p.label === name), `Page ${first}`, (n) => `Page ${first + n - 1}`);
      const page = { id: `page-${clientTag}${nextPage++}`, label };
      pages.splice(pages.findIndex((p) => p.id === activePage) + 1, 0, page);
      if (!activate) return page.id; // an agent's new page: the person looking stays where they are
      pageViews.set(activePage, { zoom: ui.zoom, panX: ui.panX, panY: ui.panY });
      activePage = page.id;
      selection = [];
      Object.assign(ui, { zoom: 1, panX: 40, panY: 40 });
      return page.id;
    },
    // Theme tokens (call inside `transact`). A new one is named "Untitled", else "Untitled N", among
    // those of its kind, and starts with the last one's value.
    createToken(type) {
      const same = tokens.filter((t) => t.type === type);
      const name = freeName((candidate) => same.some((t) => t.name === candidate), "Untitled");
      const token = { id: `token-${clientTag}${nextToken++}`, type, name, value: same.at(-1)?.value ?? typeInfo(type).fallback };
      tokens.push(token);
      return token.id;
    },
    updateToken(id, patch) {
      const token = tokens.find((t) => t.id === id);
      if (!token) return;
      if (patch.name !== undefined && patch.name.trim() && patch.name.trim() !== token.name) {
        const before = cssName(token);
        token.name = patch.name.trim();
        // Elements that use the token follow its new name.
        rewriteVars(before, `var(${cssName(token)})`);
      }
      if (patch.value !== undefined && String(patch.value).trim()) token.value = String(patch.value).trim();
    },
    duplicateToken(id) {
      const at = tokens.findIndex((t) => t.id === id);
      if (at === -1) return;
      const same = tokens.filter((t) => t.type === tokens[at].type);
      const name = freeName((candidate) => same.some((t) => t.name === candidate), `${tokens[at].name} copy`);
      const copy = { ...tokens[at], id: `token-${clientTag}${nextToken++}`, name };
      tokens.splice(at + 1, 0, copy);
      return copy.id;
    },
    // Deleting a token leaves the elements that used it with its value, so nothing goes blank.
    deleteTokens(ids) {
      const gone = tokens.filter((t) => [ids].flat().includes(t.id));
      for (const token of gone) rewriteVars(cssName(token), token.value);
      tokens = tokens.filter((t) => !gone.includes(t));
    },
    // Moves tokens within their kind: up and down by one place, or to the top or the bottom.
    moveTokens(ids, where) {
      tokens = moveWithinKind(tokens, ids, where);
    },
    // Adds tokens from the clipboard, each under a name free in its kind ("Brand", then "Brand 2").
    insertTokens(list) {
      const made = [];
      for (const { type, name, value } of list) {
        const same = tokens.filter((t) => t.type === type);
        const unique = freeName((candidate) => same.some((t) => t.name === candidate), name);
        const token = { id: `token-${clientTag}${nextToken++}`, type, name: unique, value };
        tokens.push(token);
        made.push(token.id);
      }
      return made;
    },
    renamePage(id, label) {
      const page = pages.find((p) => p.id === id);
      if (page && label.trim()) page.label = label.trim();
    },
    deletePage(id) {
      const at = pages.findIndex((p) => p.id === id);
      if (at === -1 || pages.length === 1) return;
      api.remove(nodes.filter((n) => n.parent == null && n.page === id).map((n) => n.id));
      pages.splice(at, 1);
      if (id === activePage) {
        activePage = (pages[at] ?? pages[at - 1]).id;
        Object.assign(ui, pageViews.get(activePage) ?? { zoom: 1, panX: 40, panY: 40 });
      }
      selection = selection.filter((s) => nodes.some((n) => n.id === s));
    },
    insert(node, { parent = null, index } = {}) {
      const created = { style: {}, ...structuredClone(node), id: `${clientTag}${nextId++}`, parent };
      if (parent == null && created.page == null) created.page = activePage;
      const siblings = api.children(parent);
      if (index == null || index >= siblings.length) {
        const lastDescendant = siblings.length ? api.lastDescendant(siblings.at(-1).id) : null;
        const at = lastDescendant ? nodes.indexOf(lastDescendant) + 1 : parent == null ? nodes.length : nodes.indexOf(api.get(parent)) + 1;
        nodes.splice(at, 0, created);
      } else nodes.splice(nodes.indexOf(siblings[index]), 0, created);
      return created.id;
    },
    lastDescendant(id) {
      const kids = api.children(id);
      return kids.length ? api.lastDescendant(kids.at(-1).id) : api.get(id);
    },
    subtree(id) {
      return [api.get(id), ...api.children(id).flatMap((c) => api.subtree(c.id))];
    },
    remove(ids) {
      const drop = new Set([ids].flat().flatMap((id) => api.subtree(id).map((n) => n.id)));
      nodes = nodes.filter((n) => !drop.has(n.id));
      selection = selection.filter((id) => !drop.has(id));
    },
    duplicate(ids) {
      const created = [];
      for (const id of [ids].flat()) {
        const tree = api.subtree(id);
        const map = new Map();
        for (const n of tree) map.set(n.id, `${clientTag}${nextId++}`);
        const copies = tree.map((n) => ({ ...structuredClone(n), id: map.get(n.id), parent: n.id === id ? n.parent : map.get(n.parent) }));
        copies[0].name = `${copies[0].name} copy`;
        if (copies[0].parent == null) copies[0].x = (copies[0].x ?? 0) + 40;
        const after = nodes.indexOf(api.lastDescendant(id)) + 1;
        nodes.splice(after, 0, ...copies);
        created.push(copies[0].id);
      }
      return created;
    },
    // Moves a node (with its subtree) to `index` among the children of `parent`.
    move(id, { parent, index }) {
      if (id === parent || api.ancestors(parent ?? "").includes(id)) return;
      const tree = api.subtree(id);
      nodes = nodes.filter((n) => !tree.includes(n));
      tree[0].parent = parent;
      if (parent == null) tree[0].page ??= activePage;
      const siblings = api.children(parent);
      let at;
      if (index == null || index >= siblings.length) {
        const last = siblings.length ? api.lastDescendant(siblings.at(-1).id) : null;
        at = last ? nodes.indexOf(last) + 1 : parent == null ? nodes.length : nodes.indexOf(api.get(parent)) + 1;
      } else at = nodes.indexOf(siblings[index]);
      nodes.splice(at, 0, ...tree);
    },

    // History
    undo() {
      const step = undoStack.pop();
      if (!step) return;
      redoStack.push({ ...step, before: snapshot() });
      restore(step.before);
      emit("document");
    },
    redo() {
      const step = redoStack.pop();
      if (!step) return;
      undoStack.push({ ...step, before: snapshot() });
      restore(step.before);
      emit("document");
    },
    history: () => ({ undo: undoStack.map((s) => s.label), redo: redoStack.map((s) => s.label) }),

    // Live sync (collab/sync.js): the parts of the file that travel, edits arriving from other people, and
    // the whole state when the server's replaces ours. Remote edits are not history: they are applied to
    // the saved steps as well, so undoing your own work does not undo theirs.
    state: () => ({ nodes, pages, tokens, threads }),
    applyRemote(ops) {
      const live = { nodes, pages, tokens, threads };
      apply(live, ops);
      ({ nodes, pages, tokens, threads } = live);
      const forSteps = ops.filter((op) => op.op !== "thread");
      for (const step of [...undoStack, ...redoStack]) apply(step.before, forSteps);
      if (!pages.some((p) => p.id === activePage)) activePage = pages[0].id;
      selection = selection.filter((id) => nodes.some((n) => n.id === id));
      if (forSteps.length) emit("document");
      if (ops.some((op) => op.op === "thread")) emit("threads");
    },
    replaceState(state) {
      nodes = structuredClone(state.nodes);
      pages = structuredClone(state.pages?.length ? state.pages : [{ id: "page-1", label: "Page 1" }]);
      tokens = structuredClone(state.tokens ?? []);
      threads = structuredClone(state.threads ?? []);
      for (const n of nodes) if (n.parent == null && !n.page) n.page = pages[0].id;
      if (!pages.some((p) => p.id === activePage)) activePage = pages[0].id;
      selection = selection.filter((id) => nodes.some((n) => n.id === id));
      undoStack.length = 0;
      redoStack.length = 0;
      emit("document");
      emit("threads");
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return api;
}
