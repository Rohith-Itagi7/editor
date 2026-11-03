import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { startServer } from "../server/server.mjs";

const el = (id, extra = {}) => ({ id, component: "Frame", name: id, parent: null, page: "page-1", style: {}, ...extra });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A client that remembers what it was told, and can wait for the next thing of a kind.
function connect(url, id, { query = "", headers = {} } = {}) {
  const ws = new WebSocket(`${url.replace("http", "ws")}sync/${id}${query}`, { headers });
  const seen = [];
  const waiting = [];
  ws.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    seen.push(message);
    for (const w of [...waiting]) if (w.type === message.t) { waiting.splice(waiting.indexOf(w), 1); w.resolve(message); }
  });
  return {
    ws, seen,
    send: (message) => ws.send(JSON.stringify(message)),
    next: (type) => new Promise((resolve, reject) => { const hit = seen.find((m) => m.t === type && !m.taken && (m.taken = true)); if (hit) return resolve(hit); const w = { type, resolve: (m) => { m.taken = true; resolve(m); } }; waiting.push(w); setTimeout(() => reject(new Error(`no ${type}`)), 3000); }),
    refused: () => new Promise((resolve) => { ws.on("unexpected-response", (_req, res) => resolve(res.statusCode)); ws.on("error", () => {}); }),
    close: () => ws.close(),
  };
}

async function openServer(options) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "editor-sync-"));
  const { server, url } = await startServer({ port: 0, dataDir, ...options });
  return { server, url, dataDir };
}
const make = async (url, patch = {}, headers = {}) => (await (await fetch(new URL("/api/files", url), { method: "POST", body: JSON.stringify(patch), headers })).json()).id;

test("what one editor sends, the other receives, and the file is kept", async () => {
  const { server, url, dataDir } = await openServer();
  try {
    const id = await make(url, { nodes: [el("1")] });
    const a = connect(url, id), b = connect(url, id);
    const helloA = await a.next("hello"), helloB = await b.next("hello");
    assert.equal(helloA.role, "edit");
    assert.notEqual(helloA.you.id, helloB.you.id);
    assert.notEqual(helloA.you.color, helloB.you.color);
    assert.deepEqual(helloB.file.nodes.map((n) => n.id), ["1"]);

    a.send({ t: "ops", ops: [{ op: "node", id: "2", value: el("2", { name: "from A" }) }] });
    const got = await b.next("ops");
    assert.equal(got.from, helloA.you.id);
    assert.equal(got.ops[0].value.name, "from A");
    assert.equal((await a.next("ack")).rev, 1);
    // The sender is not told its own edit again.
    assert.equal(a.seen.filter((m) => m.t === "ops").length, 0);

    // Someone who joins later starts from the current file.
    const late = connect(url, id);
    assert.deepEqual((await late.next("hello")).file.nodes.map((n) => n.id), ["1", "2"]);

    await sleep(500);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(dataDir, `${id}.json`), "utf8")).nodes.map((n) => n.id), ["1", "2"]);
    for (const c of [a, b, late]) c.close();
  } finally { server.close(); }
});

test("pointers: each editor's page, place and selection reach the others, and a leaver is announced", async () => {
  const { server, url } = await openServer();
  try {
    const id = await make(url);
    const a = connect(url, id), b = connect(url, id);
    const you = (await a.next("hello")).you;
    await b.next("hello");
    a.send({ t: "presence", page: "page-1", x: 10, y: 20, selection: ["5"] });
    const seen = await b.next("presence");
    assert.deepEqual([seen.id, seen.page, seen.x, seen.y, seen.selection, seen.color], [you.id, "page-1", 10, 20, ["5"], you.color]);
    assert.equal(a.seen.filter((m) => m.t === "presence").length, 0);
    a.close();
    assert.equal((await b.next("leave")).id, you.id);
    // A newcomer is told where the others are.
    b.send({ t: "presence", page: "page-1", x: 1, y: 2, selection: [] });
    await sleep(100);
    const c = connect(url, id);
    assert.equal((await c.next("hello")).peers.length, 1);
    b.close(); c.close();
  } finally { server.close(); }
});

test("a visitor of a shared file looks and cannot change; a private file is closed to them", async () => {
  const { server, url } = await openServer();
  try {
    const id = await make(url, { nodes: [el("1")] });
    assert.equal(await connect(url, id, { query: "?shared=1" }).refused(), 403);
    await fetch(new URL(`/api/files/${id}`, url), { method: "PUT", body: JSON.stringify({ access: "link" }) });
    const owner = connect(url, id), visitor = connect(url, id, { query: "?shared=1" });
    await owner.next("hello");
    const hello = await visitor.next("hello");
    assert.equal(hello.role, "view");
    visitor.send({ t: "ops", ops: [{ op: "node", id: "1", value: null }] });
    assert.match((await visitor.next("error")).error, /looking only/);
    owner.send({ t: "ops", ops: [{ op: "node", id: "3", value: el("3") }] });
    assert.equal((await visitor.next("ops")).ops[0].id, "3");
    owner.close(); visitor.close();
  } finally { server.close(); }
});

test("edits are checked, and a plain save while the file is open reaches the editors as edits", async () => {
  const { server, url } = await openServer();
  try {
    const id = await make(url, { nodes: [el("1")] });
    const a = connect(url, id), b = connect(url, id);
    await a.next("hello"); await b.next("hello");
    a.send({ t: "ops", ops: [{ op: "pages", value: [] }] });
    assert.match((await a.next("error")).error, /not valid/);
    a.send({ t: "ops", ops: [{ op: "drop", id: "1" }] });
    assert.match((await a.next("error")).error, /not valid/);

    await fetch(new URL(`/api/files/${id}`, url), { method: "PUT", body: JSON.stringify({ name: "Renamed", nodes: [el("1"), el("4")] }) });
    assert.equal((await b.next("meta")).name, "Renamed");
    assert.deepEqual((await b.next("ops")).ops.map((o) => o.id), ["4"]);
    assert.equal((await (await fetch(new URL(`/api/files/${id}`, url))).json()).nodes.length, 2);
    a.close(); b.close();
  } finally { server.close(); }
});

test("deleting a file lets its editors go", async () => {
  const { server, url } = await openServer();
  try {
    const id = await make(url);
    const a = connect(url, id);
    await a.next("hello");
    const closed = new Promise((resolve) => a.ws.on("close", (code) => resolve(code)));
    await fetch(new URL(`/api/files/${id}`, url), { method: "DELETE" });
    assert.equal(await closed, 4004);
  } finally { server.close(); }
});

test("with sign-in on, only the owner edits, and a stranger cannot even look at a private file", async () => {
  const { server, url } = await openServer({ auth: true });
  try {
    const cookieOf = async (email) => { const r = await fetch(new URL("/api/auth/signup", url), { method: "POST", body: JSON.stringify({ email, password: "a good password", name: email.split("@")[0] }) }); return r.headers.get("set-cookie").split(";")[0]; };
    const ann = await cookieOf("ann@example.com"), bo = await cookieOf("bo@example.com");
    const id = await make(url, {}, { cookie: ann });
    assert.equal(await connect(url, id).refused(), 401);
    assert.equal(await connect(url, id, { headers: { cookie: bo } }).refused(), 403);
    const owner = connect(url, id, { headers: { cookie: ann } });
    const hello = await owner.next("hello");
    assert.equal(hello.role, "edit");
    assert.equal(hello.you.name, "ann");
    await fetch(new URL(`/api/files/${id}`, url), { method: "PUT", body: JSON.stringify({ access: "link" }), headers: { cookie: ann } });
    const stranger = connect(url, id, { headers: { cookie: bo } });
    assert.equal((await stranger.next("hello")).role, "view");
    owner.close(); stranger.close();
  } finally { server.close(); }
});

test("guests are told apart by name and color, an agent's work is shown to the others, and a bad message is answered", async () => {
  const { server, url } = await openServer();
  try {
    const id = await make(url, { access: "link" });
    const a = connect(url, id), b = connect(url, id);
    const first = (await a.next("hello")).you, second = (await b.next("hello")).you;
    assert.deepEqual([first.name, second.name], ["Guest 1", "Guest 2"]);
    assert.notEqual(first.color, second.color);

    // An editor announces what an agent is working on; the others hear it with who said so, cut down to size.
    a.send({ t: "agent", name: "N".repeat(60), nodeIds: ["1", 2, "3"], working: 1 });
    const told = await b.next("agent");
    assert.deepEqual([told.from, told.name.length, told.nodeIds, told.working], [first.id, 40, ["1", "3"], true]);
    assert.equal(a.seen.filter((m) => m.t === "agent").length, 0);

    // A visitor who may only look is not heard on this.
    const visitor = connect(url, id, { query: "?shared=1" });
    await visitor.next("hello");
    visitor.send({ t: "agent", name: "Nope", nodeIds: [], working: true });
    await sleep(100);
    assert.equal(a.seen.filter((m) => m.t === "agent").length, 0);
    assert.equal(b.seen.filter((m) => m.t === "agent" && m.name === "Nope").length, 0);

    a.ws.send("this is not json");
    assert.equal((await a.next("error")).error, "Not JSON");
    a.close(); b.close(); visitor.close();
  } finally { server.close(); }
});
