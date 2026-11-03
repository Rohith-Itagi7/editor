// The editor's server: its static files, and for each file keeping it and saying who may open it.
// There is no sync socket and no sign-in: a file is one JSON on disk.
//
//   GET    /api/files        the files, newest first:   [{ id, name, access, updatedAt }]
//   POST   /api/files        a new file, named "Untitled", "Untitled 2", ...
//   GET    /api/files/:id    the file, for its owner:   { id, name, access, pages, nodes, updatedAt }
//   PUT    /api/files/:id    saves any of name, access, pages, tokens, nodes (POST does too, for a beacon)
//   DELETE /api/files/:id    removes it, and its images
//   POST   /api/agent        { messages }: one turn of the agent panel's conversation, the model's { content, stop_reason } (agent.mjs)
//   POST   /api/files/:id/assets  an image as the raw body: { url: "/assets/:id/:name" }
//   GET    /api/proxy?url=   a web page for Import URL: scripts stripped, its CSS and fonts routed back here
//   POST   /api/files/:id/attachments  the same for a comment: also PDF, text, CSV and ZIP files
//   GET    /assets/:id/:name an image or attachment (named by its hash, so a link is not guessable)
//   GET    /api/shared/:id   the file for a visitor: 200 when access is "link", else 403
//   WS     /sync/:id         live sync of an open file between the people who have it open (see sync.mjs)
//   POST   /mcp              agents (Claude Code, Codex, ...) over MCP (see mcp/server.mjs)
//   GET    /files            the home page: the list of files
//   GET    /file/:id         the editor on a file;   GET /f/:id   the same, read-only, through /api/shared
//
// `access` is "link" (anyone with the link) or "private" (only the owner). Without sign-in the
// owner routes are open to whoever can reach the server, so run it only on this machine.
import http from "node:http";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAuth, AuthError } from "./auth.mjs";
import { createHub } from "./sync.mjs";
import { createMcp } from "./mcp/server.mjs";
import { ModelError } from "./model.mjs";
import { costFrom, createCredits } from "./credits.mjs";
import { MAX_AGENT_BYTES, MAX_MESSAGES, agentTurn } from "./agent.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), ".."); // the repo: the page's files and, by default, the data
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".woff2": "font/woff2" };
const ID = /^[\w-]{1,64}$/;
const ACCESS = ["link", "private"];
const MAX_BODY = 20 * 1024 * 1024;
const MAX_IMAGE = 15 * 1024 * 1024;
const IMAGE_TYPES = { "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp", "image/avif": ".avif", "image/svg+xml": ".svg" };
const IMAGE_MIME = Object.fromEntries(Object.entries(IMAGE_TYPES).map(([mime, ext]) => [ext, mime]));
// What a comment may carry along besides pictures. These are served as downloads, never shown by the page.
const FILE_TYPES = { "application/pdf": ".pdf", "text/plain": ".txt", "text/csv": ".csv", "application/zip": ".zip" };
const FILE_MIME = Object.fromEntries(Object.entries(FILE_TYPES).map(([mime, ext]) => [ext, mime]));
const ASSET_NAME = /^[a-f0-9]{16}\.(png|jpg|gif|webp|avif|svg|pdf|txt|csv|zip)$/;
// Files the browser may fetch: the page (client/) and what it shares with the server (shared/), nothing else.
export const PUBLIC = /^\/(client|shared)\/.+$/;
const validTokens = (tokens) => Array.isArray(tokens) && tokens.every((t) => ["id", "type", "name", "value"].every((k) => typeof t?.[k] === "string"));
const validMessage = (m) => typeof m?.id === "string" && typeof m.text === "string" && typeof m.author?.id === "string"
  && (m.mentions === undefined || (Array.isArray(m.mentions) && m.mentions.every((p) => typeof p?.id === "string" && typeof p.name === "string")))
  && (m.attachments === undefined || (Array.isArray(m.attachments) && m.attachments.length <= 10 && m.attachments.every((a) => typeof a?.url === "string" && a.url.startsWith("/assets/") && typeof a.name === "string")));
const validThreads = (threads) => Array.isArray(threads) && threads.every((t) => typeof t?.id === "string" && (t.resolved === undefined || typeof t.resolved === "boolean") && typeof t.page === "string" && Number.isFinite(t.x) && Number.isFinite(t.y) && Array.isArray(t.messages) && t.messages.every(validMessage));
const validPages = (pages) => Array.isArray(pages) && pages.length > 0 && pages.every((p) => typeof p?.id === "string" && ID.test(p.id) && typeof p.label === "string");


// ---------- Import URL: a web page, through /api/proxy ----------
// The page is fetched here so the editor can read it: scripts and CSP tags are dropped, a <base>
// makes its links work, and stylesheets, imports and fonts come back through this route, since a font
// from another origin does not load without CORS. It reaches any http(s) address, this machine's own
// included, which is what importing a local site needs, so the server answers only to its own host.
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const FONT_URL = /\.(woff2?|ttf|otf|eot)(\?|#|$)/i;
const MAX_PAGE = 10 * 1024 * 1024;
const proxied = (url, origin) => `${origin}/api/proxy?url=${encodeURIComponent(url)}`;
const absolute = (ref, base) => { try { return new URL(ref.trim(), base).href; } catch { return ref; } };

function rewriteCss(css, base, origin) {
  return css
    .replace(/@import\s+(?:url\()?\s*(['"]?)([^'")\s;]+)\1\s*\)?/g, (_m, _q, ref) => `@import url("${proxied(absolute(ref, base), origin)}")`)
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, _q, ref) => {
      if (/^(data:|#|blob:)/.test(ref)) return m;
      const abs = absolute(ref, base);
      return `url("${FONT_URL.test(abs) ? proxied(abs, origin) : abs}")`;
    });
}

function rewriteHtml(html, base, origin) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<script\b[^>]*\/?>/gi, "")
    .replace(/<meta\b[^>]*http-equiv=["']?content-security-policy["']?[^>]*>/gi, "")
    .replace(/<link\b[^>]*>/gi, (tag) => {
      if (!/rel=["']?[^"'>]*stylesheet/i.test(tag)) return tag;
      return tag.replace(/href=(["']?)([^"'\s>]+)\1/i, (_m, _q, href) => `href="${proxied(absolute(href, base), origin)}"`);
    })
    .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (tag, css) => tag.replace(css, rewriteCss(css, base, origin)))
    .replace(/<head\b[^>]*>/i, (tag) => `${tag}<base href="${base}">`);
}

const reply = (res, status, data) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(data));
async function proxy(req, res) {
  const target = new URL(req.url ?? "", "http://x").searchParams.get("url");
  if (!target || !/^https?:\/\//i.test(target)) return reply(res, 400, { error: "Give an http or https address" });
  try {
    const upstream = await fetch(target, { headers: { "user-agent": BROWSER_UA, accept: req.headers.accept ?? "*/*", "accept-language": "en-US,en;q=0.9" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
    const type = upstream.headers.get("content-type") ?? "application/octet-stream";
    const bytes = Buffer.from(await upstream.arrayBuffer());
    if (bytes.length > MAX_PAGE) return reply(res, 413, { error: "That page is over 10 MB" });
    const base = upstream.url || target;
    const origin = `http://${req.headers.host}`;
    res.writeHead(upstream.status, { "content-type": type });
    if (type.includes("text/html")) return void res.end(rewriteHtml(bytes.toString("utf8"), base, origin));
    if (type.includes("text/css")) return void res.end(rewriteCss(bytes.toString("utf8"), base, origin));
    res.end(bytes);
  } catch (error) {
    reply(res, 502, { error: error.name === "TimeoutError" ? "The page took too long to answer" : `Could not reach the page: ${error.cause?.code ?? error.message}` });
  }
}

export async function startServer({ port = 4192, dataDir = path.join(root, ".data"), allowedHosts = [], auth: authEnabled = false } = {}) {
  const auth = authEnabled ? await createAuth({ dataDir }) : null;
  const credits = createCredits({ dataDir });
  const fileOf = (id) => path.join(dataDir, `${id}.json`);
  const read = async (id) => {
    try {
      return JSON.parse(await fs.readFile(fileOf(id), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  };
  // Written beside the target, flushed, then renamed over it, so a crash leaves the old file or the
  // new one and never half of either (Pencil's writeFileAtomic does the same).
  const write = async (file) => {
    await fs.mkdir(dataDir, { recursive: true });
    const target = fileOf(file.id);
    const temp = `${target}.${crypto.randomUUID()}.tmp`;
    const handle = await fs.open(temp, "w");
    try {
      await handle.writeFile(JSON.stringify(file));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temp, target);
  };
  const hostAllowed = (req) => ["127.0.0.1", "localhost", "[::1]", ...allowedHosts].includes((req.headers.host ?? "").replace(/:\d+$/, ""));
  const sameSite = (req) => {
    if (req.headers["sec-fetch-site"] === "cross-site") return false;
    const origin = req.headers.origin;
    if (origin === undefined) return true; // not a browser page: an agent's relay, a script
    try { return hostAllowed({ headers: { host: new URL(origin).host } }); } catch { return false; }
  };
  // An image kept under the file, named by its hash so a link to it cannot be guessed.
  const saveAsset = async (id, bytes, ext) => {
    const name = `${crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 16)}${ext}`;
    await fs.mkdir(path.join(dataDir, "assets", id), { recursive: true });
    await fs.writeFile(path.join(dataDir, "assets", id, name), bytes);
    return `/assets/${id}/${name}`;
  };
  const hub = createHub({ read, write, hostAllowed, auth, validate: { pages: validPages, tokens: validTokens, threads: validThreads } });
  const list = async (user, { all = false } = {}) => {
    const names = await fs.readdir(dataDir).catch((error) => (error.code === "ENOENT" ? [] : Promise.reject(error)));
    const files = await Promise.all(names.filter((n) => n.endsWith(".json")).map((n) => read(n.slice(0, -5)).catch(() => null)));
    return files.filter((f) => f && (!auth || all || f.owner === user?.id)).map(({ id, name = "Untitled", access = "private", updatedAt = 0 }) => ({ id, name, access, updatedAt })).sort((a, b) => b.updatedAt - a.updatedAt);
  };
  // A new file's name: "Untitled", then the first "Untitled N" not taken.
  const freeName = (taken) => {
    let name = "Untitled";
    for (let n = 2; taken.includes(name); n++) name = `Untitled ${n}`;
    return name;
  };
  const rawBody = async (req, limit) => {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) throw Object.assign(new Error("Too large"), { status: 413 });
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  };
  const body = async (req) => {
    const raw = await rawBody(req, MAX_BODY);
    const chunks = raw.length ? [raw] : [];
    if (!chunks.length) return {};
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw Object.assign(new Error("Body is not JSON"), { status: 400 });
    }
  };
  const send = (res, status, data) => {
    res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(data));
  };

  // A patch to a file: the fields it may carry, checked.
  function applyPatch(file, patch) {
    if (patch.nodes !== undefined) {
      if (!Array.isArray(patch.nodes)) return "nodes must be an array";
      file.nodes = patch.nodes;
    }
    if (patch.pages !== undefined) {
      if (!validPages(patch.pages)) return "pages must be a list of { id, label }";
      file.pages = patch.pages;
    }
    if (patch.tokens !== undefined) {
      if (!validTokens(patch.tokens)) return "tokens must be a list of { id, type, name, value }";
      file.tokens = patch.tokens;
    }
    if (patch.threads !== undefined) {
      if (!validThreads(patch.threads)) return "threads must be a list of { id, page, x, y, messages }";
      file.threads = patch.threads;
    }
    if (patch.access !== undefined) {
      if (!ACCESS.includes(patch.access)) return `access must be one of ${ACCESS.join(", ")}`;
      file.access = patch.access;
    }
    if (patch.name !== undefined) {
      if (typeof patch.name !== "string" || !patch.name.trim() || patch.name.length > 200) return "name must be 1 to 200 characters";
      file.name = patch.name.trim();
    }
    file.updatedAt = Date.now();
  }

  // The files that were made before anyone signed in belong to the first account.
  async function claimFiles(ownerId) {
    for (const file of await Promise.all((await fs.readdir(dataDir).catch(() => [])).filter((n) => n.endsWith(".json")).map((n) => read(n.slice(0, -5)).catch(() => null)))) {
      if (file && !file.owner) await write({ ...file, owner: ownerId });
    }
  }
  async function authRoutes(req, res, action, user) {
    if (action === "me" && req.method === "GET") return send(res, 200, { auth: Boolean(auth), user: user ? auth.publicUser(user) : null });
    if (!auth) return send(res, 404, { error: "Sign-in is off on this server" });
    if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
    const secure = Boolean(req.socket.encrypted);
    try {
      if (action === "signup") {
        const { user: made, first } = await auth.signUp(await body(req));
        if (first) await claimFiles(made.id);
        res.setHeader("set-cookie", auth.cookie(made, secure));
        return send(res, 201, { user: auth.publicUser(made) });
      }
      if (action === "signin") {
        const found = await auth.signIn(await body(req));
        res.setHeader("set-cookie", auth.cookie(found, secure));
        return send(res, 200, { user: auth.publicUser(found) });
      }
      if (action === "signout") {
        res.setHeader("set-cookie", auth.clearCookie());
        return send(res, 200, {});
      }
    } catch (error) {
      if (error instanceof AuthError) return send(res, error.status, { error: error.message });
      throw error;
    }
    send(res, 404, { error: "Not found" });
  }

  async function api(req, res, pathname, user) {
    const [, , kind, id] = pathname.split("/");
    if (kind === "auth") return authRoutes(req, res, id, user);
    // With sign-in on, everything but a shared file needs an account.
    if (auth && !user && !(kind === "shared" && req.method === "GET")) return send(res, 401, { error: "Sign in first" });
    if (kind === "proxy" && req.method === "GET") return proxy(req, res);
    if (kind === "agent" && req.method === "POST") {
      const { messages } = await body(req);
      if (!Array.isArray(messages) || !messages.length || messages.length > MAX_MESSAGES) return send(res, 400, { error: `messages must be a list of 1 to ${MAX_MESSAGES}` });
      // A turn costs a credit however large it is, so how large it can be is capped.
      if (JSON.stringify(messages).length > MAX_AGENT_BYTES) return send(res, 413, { error: "That conversation is too large for one turn" });
      const who = user?.id ?? "local", cost = costFrom("agent");
      try {
        await credits.spend(who, cost);
      } catch (error) {
        return send(res, error.status ?? 500, { error: error.message, credits: await credits.balance(who) });
      }
      try {
        return send(res, 200, { ...(await agentTurn(messages)), credits: await credits.balance(who) });
      } catch (error) {
        await credits.refund(who, cost);
        if (error instanceof ModelError) return send(res, error.status, { error: error.message, credits: await credits.balance(who) });
        throw error;
      }
    }
    if (kind === "files" && id === undefined) {
      if (req.method === "GET") return send(res, 200, await list(user));
      if (req.method === "POST") {
        const patch = await body(req);
        const file = { id: crypto.randomBytes(6).toString("hex"), name: freeName((await list(user)).map((f) => f.name)), access: "private", ...(auth ? { owner: user.id } : {}), pages: [{ id: "page-1", label: "Page 1" }], nodes: [] };
        const problem = applyPatch(file, patch);
        if (problem) return send(res, 400, { error: problem });
        await write(file);
        return send(res, 201, file);
      }
      return send(res, 405, { error: "Method not allowed" });
    }

    if (!ID.test(id ?? "")) return send(res, 400, { error: "Bad file id" });
    const file = hub.room(id)?.file ?? await read(id);
    // Someone else's file is not there, for any method: a PUT must not make a new one over it.
    if (kind !== "shared" && auth && file && file.owner !== user.id) return send(res, 404, { error: "No such file" });

    const part = pathname.split("/")[4];
    if (kind === "files" && (part === "assets" || part === "attachments")) {
      if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
      if (!file) return send(res, 404, { error: "No such file" });
      const type = (req.headers["content-type"] ?? "").split(";")[0].trim();
      const ext = IMAGE_TYPES[type] ?? (part === "attachments" ? FILE_TYPES[type] : undefined);
      if (!ext) return send(res, 415, { error: part === "attachments" ? "A comment can carry pictures, PDF, text, CSV and ZIP files" : "Only PNG, JPEG, GIF, WebP, AVIF and SVG images can be placed" });
      const bytes = await rawBody(req, MAX_IMAGE).catch((error) => (error.status === 413 ? Promise.reject(Object.assign(error, { message: "That image is over 15 MB" })) : Promise.reject(error)));
      return send(res, 201, { url: await saveAsset(id, bytes, ext) });
    }

    if (kind === "shared" && req.method === "GET") {
      if (!file) return send(res, 404, { error: "No such file" });
      if (file.access !== "link") return send(res, 403, { error: "This file is not shared" });
      return send(res, 200, file);
    }
    if (kind !== "files") return send(res, 404, { error: "Not found" });

    if (req.method === "GET") return file ? send(res, 200, file) : send(res, 404, { error: "No such file" });
    // POST saves too, because a closing page can only send a beacon (navigator.sendBeacon).
    if (req.method === "PUT" || req.method === "POST") {
      const patch = await body(req);
      if (hub.room(id)) {
        // The file is open for editing: this goes the way the editors' own edits go, so nobody's work is overwritten.
        const live = structuredClone(hub.room(id).file);
        const bad = applyPatch(live, patch);
        if (bad) return send(res, 400, { error: bad });
        const merged = hub.patch(id, live);
        return send(res, 200, { id, name: merged.name, access: merged.access, updatedAt: merged.updatedAt });
      }
      const next = { id, name: "Untitled", access: "private", pages: [{ id: "page-1", label: "Page 1" }], nodes: [], ...(auth ? { owner: user.id } : {}), ...file };
      const problem = applyPatch(next, patch);
      if (problem) return send(res, 400, { error: problem });
      await write(next);
      return send(res, 200, { id, name: next.name, access: next.access, updatedAt: next.updatedAt });
    }
    if (req.method === "DELETE") {
      if (!file) return send(res, 404, { error: "No such file" });
      hub.drop(id);
      await fs.unlink(fileOf(id));
      await fs.rm(path.join(dataDir, "assets", id), { recursive: true, force: true });
      return send(res, 200, { id });
    }
    send(res, 405, { error: "Method not allowed" });
  }

  let origin = "http://127.0.0.1/";
  const mcp = createMcp({
    hub, hostAllowed, authOn: Boolean(auth),
    files: {
      get origin() { return origin; },
      list: () => list(undefined, { all: true }),
      exists: async (id) => ID.test(id) && Boolean(hub.room(id)?.file ?? (await read(id))),
      async create({ name, cloneFileId }) {
        const source = cloneFileId && ID.test(cloneFileId) ? (hub.room(cloneFileId)?.file ?? (await read(cloneFileId))) : null;
        if (cloneFileId && !source) throw new Error(`There is no file ${cloneFileId} to copy`);
        const file = { id: crypto.randomBytes(6).toString("hex"), name: "", access: "private", pages: [{ id: "page-1", label: "Page 1" }], nodes: [], ...(source ? structuredClone({ pages: source.pages, tokens: source.tokens ?? [], nodes: source.nodes }) : {}) };
        file.name = typeof name === "string" && name.trim() ? name.trim().slice(0, 200) : freeName((await list(undefined, { all: true })).map((f) => f.name));
        file.updatedAt = Date.now();
        await write(file);
        return file;
      },
      async rename(id, name) {
        const current = ID.test(id) ? (hub.room(id)?.file ?? (await read(id))) : null;
        if (!current) throw new Error(`There is no file ${id}`);
        const next = structuredClone(current);
        const problem = applyPatch(next, { name });
        if (problem) throw new Error(problem);
        if (hub.room(id)) hub.patch(id, next);
        else await write(next);
        return { name: next.name };
      },
    },
  });

  const server = http.createServer(async (req, res) => {
    try {
      // Only this machine's own names: a page on another site must not reach the server through the browser.
      if (!hostAllowed(req)) return res.writeHead(403).end("Forbidden host");
      // A page on another site can still send a request to this machine, only not read the answer: whatever changes a file or spends
      // the provider key has to come from this editor, so a cross-site one is refused (the browser says so in Sec-Fetch-Site and Origin).
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !sameSite(req)) return res.writeHead(403).end("Cross-site request refused");
      if (new URL(req.url, "http://x").pathname === "/mcp") return await mcp.handle(req, res);
      const pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
      const user = auth ? await auth.userOf(req) : null;
      if (pathname.startsWith("/api/")) return await api(req, res, pathname, user);
      if (pathname === "/") return res.writeHead(302, { location: "/files" }).end();
      const asset = pathname.match(/^\/assets\/([\w-]{1,64})\/([^/]+)$/);
      if (asset) {
        if (!ASSET_NAME.test(asset[2])) return res.writeHead(404).end();
        // With sign-in on, an image is for its file's owner, or for anyone when the file is shared.
        const owner = auth ? await read(asset[1]) : null;
        if (auth && !(owner && (owner.access === "link" || owner.owner === user?.id))) return res.writeHead(404).end();
        const bytes = await fs.readFile(path.join(dataDir, "assets", asset[1], asset[2]));
        // An SVG opened on its own must not run anything, so it is sandboxed; as a background it never does.
        const ext = path.extname(asset[2]);
        const download = ext in FILE_MIME; // a document is saved, never displayed from here
        return res.writeHead(200, { "content-type": IMAGE_MIME[ext] ?? FILE_MIME[ext], "x-content-type-options": "nosniff", ...(download ? { "content-disposition": "attachment" } : {}), "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox", "cache-control": "public, max-age=31536000, immutable" }).end(bytes);
      }
      const editor = /^\/(f|file)\/[\w-]{1,64}\/?$/.test(pathname);
      const asked = editor ? "/client/index.html" : pathname === "/files" ? "/client/home.html" : pathname;
      if (!PUBLIC.test(asked)) return res.writeHead(404).end();
      const file = path.join(root, asked);
      if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
      res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" }).end(await fs.readFile(file));
    } catch (error) {
      if (error.code === "ENOENT") return res.writeHead(404).end();
      send(res, error.status ?? 500, { error: error.message });
    }
  });

  server.on("upgrade", (req, socket, head) => hub.upgrade(req, socket, head));
  // Closing the server also lets the editors go and saves what they last sent.
  const closeServer = server.close.bind(server);
  server.close = (callback) => { Promise.allSettled([hub.close(), mcp.close()]).finally(() => closeServer(callback)); return server; };

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => { origin = `http://127.0.0.1:${server.address().port}/`; resolve({ server, url: origin, dataDir }); });
  });
}
