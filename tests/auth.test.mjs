import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer } from "../server/server.mjs";

const fresh = async (options = {}) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "editor-auth-"));
  const { server, url } = await startServer({ port: 0, dataDir, ...options });
  return { server, url, dataDir };
};
// A client that keeps its own cookie, so two people can use one server.
const client = (url) => {
  let cookie = "";
  return async (pathname, options = {}) => {
    const response = await fetch(new URL(pathname, url), { ...options, headers: { ...options.headers, ...(cookie ? { cookie } : {}) }, redirect: "manual" });
    const set = response.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0].endsWith("=") ? "" : set.split(";")[0];
    const type = response.headers.get("content-type") ?? "";
    return { status: response.status, body: type.includes("json") ? await response.json() : Buffer.from(await response.arrayBuffer()), cookie: () => cookie, setCookie: set };
  };
};
const post = (body) => ({ method: "POST", body: JSON.stringify(body) });
const put = (body) => ({ method: "PUT", body: JSON.stringify(body) });

test("a server with sign-in off says so, and needs no account", async () => {
  const { server, url } = await fresh();
  try {
    const call = client(url);
    assert.deepEqual((await call("/api/auth/me")).body, { auth: false, user: null });
    assert.equal((await call("/api/files")).status, 200);
    assert.equal((await call("/api/auth/signin", post({ email: "a@b.co", password: "12345678" }))).status, 404);
  } finally { server.close(); }
});

test("with sign-in on, nothing but a shared file opens without an account", async () => {
  const { server, url } = await fresh({ auth: true });
  try {
    const call = client(url);
    assert.deepEqual((await call("/api/auth/me")).body, { auth: true, user: null });
    for (const route of ["/api/files", "/api/files/abc", "/api/proxy?url=http%3A%2F%2Fx"]) assert.equal((await call(route)).status, 401, route);
    assert.equal((await call("/api/files", { method: "POST" })).status, 401);
    assert.equal((await call("/api/shared/abc")).status, 404);
  } finally { server.close(); }
});

test("an account: checked, kept as a hash, and signed in with a cookie that cannot be forged", async () => {
  const { server, url, dataDir } = await fresh({ auth: true });
  try {
    const call = client(url);
    assert.equal((await call("/api/auth/signup", post({ email: "nope", password: "longenough" }))).status, 400);
    assert.equal((await call("/api/auth/signup", post({ email: "ann@example.com", password: "short" }))).status, 400);
    const made = await call("/api/auth/signup", post({ email: "Ann@Example.com", password: "correct horse", name: "Ann" }));
    assert.equal(made.status, 201);
    assert.match(made.setCookie, /HttpOnly; SameSite=Lax/);
    assert.deepEqual((await call("/api/auth/me")).body.user.name, "Ann");
    assert.equal((await call("/api/auth/signup", post({ email: "ann@example.com", password: "another one" }))).status, 409);
    const stored = await fs.readFile(path.join(dataDir, "account", "users.json"), "utf8");
    assert.doesNotMatch(stored, /correct horse/);
    // A cookie with its signature changed is nobody.
    const cookie = (await call("/api/auth/me")).cookie();
    assert.ok(cookie.startsWith("editor_session="));
    const bad = await fetch(new URL("/api/auth/me", url), { headers: { cookie: cookie.slice(0, -3) + "000" } });
    assert.equal((await bad.json()).user, null);
    await call("/api/auth/signout", { method: "POST" });
    assert.equal((await call("/api/files")).status, 401);
  } finally { server.close(); }
});

test("a wrong password is refused, and five misses make the account wait", async () => {
  const { server, url } = await fresh({ auth: true });
  try {
    const call = client(url);
    await call("/api/auth/signup", post({ email: "bo@example.com", password: "right password" }));
    await call("/api/auth/signout", { method: "POST" });
    for (let i = 0; i < 5; i++) assert.equal((await call("/api/auth/signin", post({ email: "bo@example.com", password: "wrong" + i }))).status, 401);
    assert.equal((await call("/api/auth/signin", post({ email: "bo@example.com", password: "right password" }))).status, 429);
    assert.equal((await call("/api/auth/signin", post({ email: "nobody@example.com", password: "whatever1" }))).status, 401);
  } finally { server.close(); }
});

test("files belong to whoever made them, and a visitor reaches only what is shared", async () => {
  const { server, url } = await fresh({ auth: true });
  try {
    const ann = client(url), bo = client(url), visitor = client(url);
    await ann("/api/auth/signup", post({ email: "ann@example.com", password: "annspassword" }));
    await bo("/api/auth/signup", post({ email: "bo@example.com", password: "bospassword" }));
    const made = (await ann("/api/files", post({ nodes: [] }))).body;
    assert.equal(made.owner !== undefined, true);
    assert.equal((await ann("/api/files")).body.length, 1);
    assert.equal((await bo("/api/files")).body.length, 0);
    // Bo cannot read, change, delete, or overwrite it by a PUT to its id.
    assert.equal((await bo(`/api/files/${made.id}`)).status, 404);
    assert.equal((await bo(`/api/files/${made.id}`, put({ name: "mine now" }))).status, 404);
    assert.equal((await bo(`/api/files/${made.id}`, { method: "DELETE" })).status, 404);
    assert.equal((await ann(`/api/files/${made.id}`)).body.name, "Untitled");
    // An image of a private file is the owner's; once shared, anyone's.
    const png = Buffer.from("89504e470d0a1a0a", "hex");
    const placed = (await ann(`/api/files/${made.id}/assets`, { method: "POST", headers: { "content-type": "image/png" }, body: png })).body.url;
    assert.equal((await visitor(placed)).status, 404);
    assert.equal((await bo(placed)).status, 404);
    assert.equal((await ann(placed)).status, 200);
    assert.equal((await visitor(`/api/shared/${made.id}`)).status, 403);
    await ann(`/api/files/${made.id}`, put({ access: "link" }));
    assert.equal((await visitor(`/api/shared/${made.id}`)).status, 200);
    assert.equal((await visitor(placed)).status, 200);
    assert.equal((await visitor(`/api/files/${made.id}`)).status, 401);
  } finally { server.close(); }
});

test("the first account takes the files made before sign-in", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "editor-claim-"));
  const open = await startServer({ port: 0, dataDir });
  const before = (await (await fetch(new URL("/api/files", open.url), { method: "POST" })).json()).id;
  open.server.close();
  const { server, url } = await startServer({ port: 0, dataDir, auth: true });
  try {
    const first = client(url), second = client(url);
    await first("/api/auth/signup", post({ email: "first@example.com", password: "firstpassword" }));
    await second("/api/auth/signup", post({ email: "second@example.com", password: "secondpassword" }));
    assert.deepEqual((await first("/api/files")).body.map((f) => f.id), [before]);
    assert.equal((await second("/api/files")).body.length, 0);
  } finally { server.close(); }
});
