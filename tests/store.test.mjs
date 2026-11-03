import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../client/core/store.js";
import { readEmbedded, serializeNodes } from "../client/features/clipboard.js";
import { cssName, tokensToCss } from "../client/core/tokens.js";

const frame = (extra = {}) => ({ component: "Frame", name: "Frame", style: {}, ...extra });

test("pages: Page N is the first free number, opens after the active one, and the last cannot go", () => {
  const store = createStore([]);
  store.transact("add", () => store.addPage());
  store.transact("add", () => store.addPage());
  assert.deepEqual(store.pages().map((p) => p.label), ["Page 1", "Page 2", "Page 3"]);
  assert.equal(store.activePage(), "page-3");
  store.setPage("page-1");
  store.transact("add", () => store.addPage());
  assert.deepEqual(store.pages().map((p) => p.id), ["page-1", "page-4", "page-2", "page-3"]);
  for (const id of ["page-2", "page-3", "page-4"]) store.transact("delete", () => store.deletePage(id));
  store.transact("delete", () => store.deletePage("page-1"));
  assert.equal(store.pages().length, 1);
});

test("pages: roots belong to one page, deleting a page deletes them, undo brings both back", () => {
  const store = createStore([]);
  store.transact("a", () => store.insert(frame({ name: "On one", x: 0, y: 0 })));
  store.transact("add", () => store.addPage());
  store.transact("b", () => store.insert(frame({ name: "On two", x: 0, y: 0 })));
  assert.deepEqual(store.roots().map((n) => n.name), ["On two"]);
  store.setPage("page-1");
  assert.deepEqual(store.roots().map((n) => n.name), ["On one"]);
  store.transact("delete", () => store.deletePage("page-2"));
  assert.equal(store.all().length, 1);
  store.undo();
  assert.equal(store.all().length, 2);
  assert.equal(store.pages().length, 2);
});

test("tokens: a new one is Untitled, then Untitled 2, with the last one's value", () => {
  const store = createStore([]);
  store.transact("t", () => store.createToken("color"));
  store.transact("t", () => store.updateToken("token-1", { value: "#ff0000" }));
  store.transact("t", () => store.createToken("color"));
  assert.deepEqual(store.tokens().map((t) => [t.name, t.value]), [["Untitled", "#ff0000"], ["Untitled 2", "#ff0000"]]);
  store.transact("t", () => store.updateToken("token-1", { name: "Brand blue" }));
  assert.equal(cssName(store.tokens()[0]), "--color-brand-blue");
  assert.match(tokensToCss(store.tokens()), /^@theme \{\n  --color-brand-blue: #ff0000;\n  --color-untitled-2: #ff0000;\n\}\n$/);
  assert.match(tokensToCss(store.tokens(), "css"), /^:root \{/);
});

test("read-only: every write is refused, selecting still works", () => {
  const store = createStore([{ id: "1", component: "Frame", name: "A", parent: null, style: {}, page: "page-1" }], { readOnly: true });
  store.transact("x", () => store.remove("1"));
  assert.equal(store.all().length, 1);
  store.select("1");
  assert.deepEqual(store.selection(), ["1"]);
});

test("clipboard: copied elements come back whole, children included, and only top-level ones are listed", () => {
  const store = createStore([]);
  let parent;
  store.transact("a", () => {
    parent = store.insert(frame({ name: "Card", x: 5, y: 6 }));
    store.insert({ component: "Text", name: "Title", text: "Title", style: { color: "red" } }, { parent });
  });
  const child = store.children(parent)[0].id;
  const payload = serializeNodes(store, [parent, child]);
  assert.equal(payload.text, "Node IDs: " + parent);
  const tree = readEmbedded(payload.html);
  assert.deepEqual(tree.topLevel, [parent]);
  assert.equal(tree.nodes.length, 2);
  assert.equal(serializeNodes(store, [child]).text, "Title");
  assert.equal(readEmbedded("<b>nothing</b>"), null);
  assert.equal(readEmbedded(`<!--<editor-paste-start data-embed="{bad"></editor-paste-start>-->`), null);
});

test("tokens: a renamed token keeps its uses, a deleted one leaves its value behind", () => {
  const store = createStore([{ id: "1", component: "Text", name: "T", parent: null, page: "page-1", text: "T", style: { color: "var(--color-brand)", background: "var(--color-other)" } }]);
  store.transact("t", () => store.createToken("color"));
  store.transact("t", () => store.updateToken("token-1", { name: "Brand", value: "#123456" }));
  store.transact("t", () => store.updateToken("token-1", { name: "Primary" }));
  assert.equal(store.get("1").style.color, "var(--color-primary)");
  assert.equal(store.get("1").style.background, "var(--color-other)");
  store.transact("t", () => store.deleteTokens("token-1"));
  assert.equal(store.get("1").style.color, "#123456");
  assert.equal(store.tokens().length, 0);
});

test("tokens: moving within a kind, and pasting under free names", () => {
  const store = createStore([]);
  for (const type of ["color", "color", "radius", "color"]) store.transact("t", () => store.createToken(type));
  const names = () => store.tokens().map((t) => `${t.type}:${t.name}`);
  assert.deepEqual(names(), ["color:Untitled", "color:Untitled 2", "radius:Untitled", "color:Untitled 3"]);
  store.transact("m", () => store.moveTokens(["token-4"], "top"));
  assert.deepEqual(names(), ["color:Untitled 3", "color:Untitled", "radius:Untitled", "color:Untitled 2"]);
  store.transact("m", () => store.moveTokens(["token-4"], "up")); // already first: stays
  assert.deepEqual(names().filter((n) => n.startsWith("color")), ["color:Untitled 3", "color:Untitled", "color:Untitled 2"]);
  store.transact("m", () => store.moveTokens(["token-4"], "down"));
  assert.deepEqual(names().filter((n) => n.startsWith("color")), ["color:Untitled", "color:Untitled 3", "color:Untitled 2"]);
  const made = store.insertTokens([{ type: "color", name: "Untitled", value: "#000" }, { type: "radius", name: "Round", value: "8px" }]);
  assert.equal(made.length, 2);
  assert.ok(names().includes("color:Untitled 4"), "a pasted name that is taken gets the next free number");
  assert.ok(names().includes("radius:Round"));
});

test("comments: a message may be only files, and carries who it mentions", () => {
  const store = createStore([]);
  const ann = { id: "a", name: "Ann" };
  assert.equal(store.addThread({ x: 0, y: 0, text: "  ", author: ann }), null);
  const id = store.addThread({ x: 0, y: 0, text: "", author: ann, attachments: [{ url: "/assets/f/0123456789abcdef.png", name: "a.png" }] });
  assert.ok(id);
  assert.equal(store.reply(id, "Hi @Bea", ann, { mentions: [{ id: "b", name: "Bea" }] }), true);
  assert.deepEqual(store.threads()[0].messages.map((m) => [m.text, m.mentions.length, m.attachments.length]), [["", 0, 1], ["Hi @Bea", 1, 0]]);
  assert.deepEqual(store.threads()[0].readBy, ["a"]); // a reply is unread for everyone else
});
