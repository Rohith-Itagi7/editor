import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer } from "../server/server.mjs";

let server, base;
test.before(async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "editor-test-"));
  ({ server, url: base } = await startServer({ port: 0, dataDir }));
});
test.after(() => server.close());

const call = async (pathname, options = {}) => {
  const response = await fetch(new URL(pathname, base), options);
  const type = response.headers.get("content-type") ?? "";
  return { status: response.status, body: type.includes("json") ? await response.json() : Buffer.from(await response.arrayBuffer()), type };
};
const json = (method, body) => ({ method, body: JSON.stringify(body) });

test("new files are named Untitled, then Untitled 2", async () => {
  const one = await call("/api/files", { method: "POST" });
  const two = await call("/api/files", { method: "POST" });
  assert.equal(one.status, 201);
  assert.equal(one.body.name, "Untitled");
  assert.equal(two.body.name, "Untitled 2");
  assert.deepEqual(one.body.pages, [{ id: "page-1", label: "Page 1" }]);
});

test("a file keeps what is saved to it, and says so in the list", async () => {
  const { body: file } = await call("/api/files", { method: "POST" });
  const nodes = [{ id: "1", component: "Frame", name: "A", parent: null, style: {} }];
  const tokens = [{ id: "token-1", type: "color", name: "Brand", value: "#fff" }];
  assert.equal((await call(`/api/files/${file.id}`, json("PUT", { name: "Study", nodes, tokens }))).status, 200);
  const saved = await call(`/api/files/${file.id}`);
  assert.deepEqual(saved.body.nodes, nodes);
  assert.deepEqual(saved.body.tokens, tokens);
  assert.equal(saved.body.name, "Study");
  const list = await call("/api/files");
  assert.ok(list.body.some((f) => f.id === file.id && f.name === "Study"));
});

test("bad patches are refused with a reason", async () => {
  const { body: file } = await call("/api/files", { method: "POST" });
  for (const patch of [{ pages: [] }, { name: "  " }, { access: "everyone" }, { nodes: "x" }, { tokens: [{ id: 1 }] }]) {
    const answer = await call(`/api/files/${file.id}`, json("PUT", patch));
    assert.equal(answer.status, 400, JSON.stringify(patch));
    assert.ok(answer.body.error);
  }
  assert.equal((await call(`/api/files/${file.id}`, { method: "PUT", body: "not json" })).status, 400);
  assert.equal((await call("/api/files/..%2Fetc")).status, 400);
});

test("a visitor reads a file only when its access is link", async () => {
  const { body: file } = await call("/api/files", { method: "POST" });
  assert.equal((await call(`/api/shared/${file.id}`)).status, 403);
  await call(`/api/files/${file.id}`, json("PUT", { access: "link" }));
  assert.equal((await call(`/api/shared/${file.id}`)).status, 200);
  await call(`/api/files/${file.id}`, json("PUT", { access: "private" }));
  assert.equal((await call(`/api/shared/${file.id}`)).status, 403);
  assert.equal((await call("/api/shared/nothing")).status, 404);
});

test("images are stored by hash, served with their type, and removed with the file", async () => {
  const { body: file } = await call("/api/files", { method: "POST" });
  const png = Buffer.from("89504e470d0a1a0a", "hex");
  const placed = await call(`/api/files/${file.id}/assets`, { method: "POST", headers: { "content-type": "image/png" }, body: png });
  assert.equal(placed.status, 201);
  assert.match(placed.body.url, new RegExp(`^/assets/${file.id}/[a-f0-9]{16}\\.png$`));
  const served = await call(placed.body.url);
  assert.equal(served.status, 200);
  assert.equal(served.type, "image/png");
  assert.deepEqual(served.body, png);
  assert.equal((await call(`/api/files/${file.id}/assets`, { method: "POST", headers: { "content-type": "text/html" }, body: "<b>" })).status, 415);
  assert.equal((await call(`/assets/${file.id}/evil.png`)).status, 404);
  await call(`/api/files/${file.id}`, { method: "DELETE" });
  assert.equal((await call(placed.body.url)).status, 404);
});

test("pages of the app are served, and the rest of the folder is not", async () => {
  assert.equal((await call("/files")).status, 200);
  assert.equal((await call("/file/abc")).status, 200);
  assert.equal((await call("/client/main.js")).status, 200);
  for (const hidden of ["/server/server.mjs", "/server.mjs", "/package.json", "/CLAUDE.md", "/tests/server.test.mjs"]) assert.equal((await call(hidden)).status, 404, hidden);
});

test("the server answers only to its own host names, and the proxy only to web addresses", async () => {
  const stranger = await new Promise((resolve) => {
    import("node:http").then(({ default: http }) => {
      const request = http.request(new URL("/api/files", base), { headers: { host: "evil.example.com" } }, (response) => resolve(response.statusCode));
      request.end();
    });
  });
  assert.equal(stranger, 403);
  assert.equal((await call("/api/proxy?url=file%3A%2F%2F%2Fetc%2Fpasswd")).status, 400);
  assert.equal((await call("/api/proxy")).status, 400);
});

test("a comment can carry files: pictures, PDF, text, CSV and ZIP, served as downloads, nothing else", async () => {
  const { body: file } = await call("/api/files", { method: "POST" });
  const upload = (part, type, body = "x") => call(`/api/files/${file.id}/${part}`, { method: "POST", headers: { "content-type": type }, body });
  const csv = await upload("attachments", "text/csv", "a,b\n1,2");
  assert.equal(csv.status, 201);
  assert.match(csv.body.url, /\.csv$/);
  const served = await fetch(new URL(csv.body.url, base));
  assert.equal(served.headers.get("content-disposition"), "attachment");
  assert.equal(served.headers.get("x-content-type-options"), "nosniff");
  assert.equal(served.headers.get("content-type"), "text/csv");
  assert.equal((await upload("attachments", "image/png")).status, 201);
  assert.equal((await upload("attachments", "text/html", "<script>")).status, 415);
  assert.equal((await upload("attachments", "application/x-msdownload")).status, 415);
  assert.equal((await upload("assets", "text/csv")).status, 415); // a file is for comments; elements take pictures
});

test("a comment's mentions and files are kept with the file, and badly shaped ones are refused", async () => {
  const { body: file } = await call("/api/files", { method: "POST" });
  const thread = (message) => ({ threads: [{ id: "th", page: "page-1", x: 1, y: 2, readBy: [], messages: [{ id: "m", text: "hi", author: { id: "a", name: "Ann" }, at: 1, ...message }] }] });
  const put = (patch) => call(`/api/files/${file.id}`, { method: "PUT", body: JSON.stringify(patch) });
  assert.equal((await put(thread({ mentions: [{ id: "b", name: "Bea" }], attachments: [{ url: "/assets/x/0123456789abcdef.png", name: "a.png" }] }))).status, 200);
  assert.equal((await call(`/api/files/${file.id}`)).body.threads[0].messages[0].mentions[0].name, "Bea");
  assert.equal((await put(thread({ mentions: [{ id: 1 }] }))).status, 400);
  assert.equal((await put(thread({ attachments: [{ url: "https://evil.example/x.png", name: "x" }] }))).status, 400);
});

test("a request from another site cannot change anything or spend the key; the editor's own can", async () => {
  const cross = await call("/api/files", { method: "POST", headers: { "sec-fetch-site": "cross-site" } });
  assert.equal(cross.status, 403);
  const foreign = await call("/api/agent", { method: "POST", headers: { origin: "https://evil.example", "content-type": "text/plain" }, body: JSON.stringify({ messages: [] }) });
  assert.equal(foreign.status, 403);
  const own = await call("/api/files", { method: "POST", headers: { "sec-fetch-site": "same-origin", origin: new URL(base).origin } });
  assert.equal(own.status, 201);
  const read = await call("/api/files", { headers: { "sec-fetch-site": "cross-site" } }); // reading is not what it guards
  assert.equal(read.status, 200);
});

test("the agent route refuses what is not a conversation, and one that is too large", async () => {
  assert.equal((await call("/api/agent", json("POST", { messages: [] }))).status, 400);
  assert.equal((await call("/api/agent", json("POST", { messages: [{ role: "user", content: "x".repeat(7 * 1024 * 1024) }] }))).status, 413);
});
