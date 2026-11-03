// How agents (Claude Code, Codex, Cursor, ...) reach the editor: /mcp on the editor's own port, over Streamable HTTP,
// one session per agent. A request from a browser page is refused (see `refusal`), and so is one that carries no
// bearer token when sign-in is on. Most tools run in the page that has the file open, so a call is passed to it
// through the hub (sync.mjs); the file tools need no page and are answered here. With sign-in on, an agent only
// gets the files that are open in an editor.
import { randomUUID, timingSafeEqual } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema, isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { GUIDE, INSTRUCTIONS, SERVER_TOOLS, TOOLS } from "./tools.mjs";

const MAX_BODY_BYTES = 5 * 1024 * 1024;
const GUIDE_TOPIC = "editor-mcp-instructions";
const MAX_LISTED = 200;

// ---------- What a call answers with ----------
const textPart = (value) => ({ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) });
const failure = (message) => ({ isError: true, content: [textPart(message)] });

/** A page's answer as MCP content: pictures and documents as themselves, anything else as text. */
export function contentOf(answer) {
  if (answer === undefined || answer === null) return [textPart("Done.")];
  if (typeof answer !== "object" || (!answer.images && !answer.documents)) return [textPart(answer)];
  const pictures = (answer.images ?? []).map(({ data, mimeType }) => ({ type: "image", data, mimeType }));
  const documents = (answer.documents ?? []).map(({ uri, mimeType, data }) => ({ type: "resource", resource: { uri, mimeType, blob: data } }));
  return [...pictures, ...documents, ...(answer.text !== undefined ? [textPart(answer.text)] : [])];
}

const absentArguments = (tool, args) => (tool.inputSchema.required ?? []).filter((key) => args[key] === undefined || args[key] === null);

/** Who an agent says it is, as the canvas will name it. */
function agentLabel(client = "agent") {
  if (/claude/i.test(client)) return "Claude";
  if (/codex|openai/i.test(client)) return "Codex";
  if (/cursor/i.test(client)) return "Cursor";
  const spaced = client.replace(/[-_]/g, " ");
  return spaced.replace(/^./, (c) => c.toUpperCase()).slice(0, 30);
}

// ---------- The tools that need no page ----------
const fileId = (value) => String(value ?? "").replace(/^.*\/file\//, "").replace(/[/?#].*$/, "");

function fileTools({ hub, files, authOn }) {
  const isOpen = (id) => hub.status().open.has(id);
  return {
    get_guide({ topic }) {
      if (topic !== GUIDE_TOPIC) throw new Error(`There is no guide called ${topic}. The guide is "${GUIDE_TOPIC}".`);
      return GUIDE;
    },

    async list_resources({ limit }) {
      const { open, active } = hub.status();
      const everything = await files.list();
      const shown = authOn ? everything.filter((f) => open.has(f.id)) : everything;
      const rows = shown.map((f) => ({
        id: f.id, type: "file", name: f.name,
        ...(open.has(f.id) ? { open: true } : {}), ...(f.id === active ? { active: true } : {}),
        updatedAt: f.updatedAt ? new Date(f.updatedAt).toISOString() : undefined,
      }));
      // Open files first, then the most recently changed.
      rows.sort((a, b) => Number(Boolean(b.open)) - Number(Boolean(a.open)) || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
      const count = Math.min(MAX_LISTED, Math.max(1, Number(limit) || 50));
      return { items: rows.slice(0, count), ...(rows.length > count ? { truncated: true } : {}) };
    },

    async create_file({ name, cloneFileId }) {
      if (authOn) throw new Error("With sign-in on, files are made from the app, not by an agent.");
      const made = await files.create({ name, cloneFileId });
      return { id: made.id, name: made.name, url: `${files.origin}file/${made.id}` };
    },

    async rename_resource({ resourceId, name }) {
      if (authOn && !isOpen(resourceId)) throw new Error("That file is not open in an editor.");
      const renamed = await files.rename(resourceId, name);
      return { name: renamed.name, type: "file" };
    },

    // Asks the editors to show the file (a pasted link is fine), then answers with what get_basic_info would.
    async open_file({ fileId: given, pageId }) {
      const id = fileId(given);
      if (authOn && !isOpen(id)) throw new Error("With sign-in on, open the file in the app; an agent works with what is open.");
      if (!(await files.exists(id))) throw new Error(`There is no file ${id}`);
      if (!isOpen(id) && !(await hub.open(id))) throw new Error("No editor is open to show that file. Open the Editor app first.");
      return hub.call(id, "get_basic_info", { fileId: id, pageId });
    },
  };
}

// ---------- Reading and refusing requests ----------
async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Too large"), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return undefined;
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw Object.assign(new Error("Body is not JSON"), { status: 400 }); }
}

function replyError(res, status, message) {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
}

function sameToken(header, token) {
  const given = Buffer.from(String(header ?? "").replace(/^Bearer\s+/i, "")), wanted = Buffer.from(token);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

export function createMcp({ hub, hostAllowed, files, authOn, token = process.env.EDITOR_MCP_TOKEN }) {
  const sessions = new Map(); // session id -> { server, transport }
  const fileHandlers = fileTools({ hub, files, authOn });

  /** Why a request is turned away before anything is read, or null. */
  function refusal(req) {
    // Browsers send Origin and MCP clients do not, so a web page can never be the caller. Only this machine's own names are served.
    if (req.headers.origin) return [403, "Browser requests are not allowed"];
    if (!hostAllowed(req)) return [403, "Invalid host"];
    if (req.method === "OPTIONS") return [403, "Browser requests are not allowed"];
    if (!authOn) return null;
    if (!token) return [503, "With sign-in on, set EDITOR_MCP_TOKEN to let agents in"];
    return sameToken(req.headers.authorization, token) ? null : [401, "Missing or wrong bearer token"];
  }

  function startSession() {
    const server = new Server({ name: "editor", version: "1.0.0" }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      onsessioninitialized: (id) => sessions.set(id, { server, transport }),
    });
    transport.onclose = () => { if (transport.sessionId) sessions.delete(transport.sessionId); };

    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) }));
    server.setRequestHandler(CallToolRequestSchema, async ({ params: { name, arguments: args = {} } }) => {
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return failure(`There is no tool called ${name}`);
      const absent = absentArguments(tool, args);
      if (absent.length) return failure(`${name} needs ${absent.join(", ")}`);
      try {
        const answer = SERVER_TOOLS.has(name)
          ? await fileHandlers[name](args)
          : await hub.call(args.fileId, name, args, { agent: agentLabel(server.getClientVersion?.()?.name) });
        return { content: contentOf(answer) };
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error));
      }
    });
    return { server, transport };
  }

  async function handle(req, res) {
    const refused = refusal(req);
    if (refused) return replyError(res, ...refused);
    try {
      const id = req.headers["mcp-session-id"];
      const session = id ? sessions.get(id) : undefined;
      if (req.method === "POST") {
        const message = await readJson(req);
        if (session) return session.transport.handleRequest(req, res, message);
        if (!id && isInitializeRequest(message)) {
          const fresh = startSession();
          await fresh.server.connect(fresh.transport);
          return fresh.transport.handleRequest(req, res, message);
        }
        return id ? replyError(res, 404, "Unknown session") : replyError(res, 400, "Send initialize first");
      }
      if ((req.method === "GET" || req.method === "DELETE") && session) return session.transport.handleRequest(req, res);
      return id ? replyError(res, 404, "Unknown session") : replyError(res, 400, "A session id is needed");
    } catch (error) {
      if (!res.headersSent) replyError(res, error.status ?? 500, error.message);
    }
  }

  const close = async () => {
    await Promise.allSettled([...sessions.values()].map((s) => s.transport.close()));
    sessions.clear();
  };

  return { handle, sessions, close };
}
