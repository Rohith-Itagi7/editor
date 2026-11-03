// Live sync: people who have the same file open see each other's edits as they happen, and each other's pointers.
// It runs over one WebSocket per person. They get a snapshot when they join, then small edits (shared/ops.js) and
// the pointer, selection and page of everyone else. A room for each open file holds the current file in memory,
// applies what editors send, tells the others, and writes the file a moment after the last change.
//
//   page  -> server   { t: "ops", ops }  { t: "presence", page, x, y, selection }  { t: "focus" }
//   server -> page    { t: "hello", you, role, rev, file, peers }   { t: "ops", ops, from, rev }   { t: "ack", rev }
//                     { t: "presence", id, name, color, userId, page, x, y, selection }   { t: "leave", id }
//                     { t: "meta", name, access }   { t: "error", error }
//   agents (server/mcp/server.mjs): server -> page { t: "call", id, method, args, agent } and { t: "open", fileId };
//                     page -> server { t: "result", id, value | error } and { t: "agent", name, nodeIds, working },
//                     which the others are told of as { t: "agent", from, name, nodeIds, working }
//
// A person who may only look (the visitor of a shared file, role "view") is sent everything and can send only presence.
import { randomBytes } from "node:crypto";
import { WebSocketServer } from "ws";
import { apply, diff, validOps } from "../shared/ops.js";

const COLORS = ["#e54666", "#2f6bff", "#0a7a55", "#e8a317", "#8b5cf6", "#0ea5b7", "#f97316", "#64748b"];
const SAVE_AFTER_MS = 300;
const CALL_TIMEOUT_MS = 30000;
const OPEN_TIMEOUT_MS = 8000;
const MAX_PAYLOAD = 20 * 1024 * 1024;
const MAX_SELECTION = 50;
const MAX_AGENT_NODES = 100;

/** The parts of a file that edits change. */
const stateOf = (file) => ({ nodes: file.nodes, pages: file.pages, tokens: file.tokens, threads: file.threads });
const strings = (list, limit) => (Array.isArray(list) ? list.filter((s) => typeof s === "string").slice(0, limit) : []);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The parts of an edit that arrive whole are checked the way a saved file is. */
function partsAreValid(ops, validate) {
  return ops.every((op) => {
    if (op.op === "pages") return validate.pages(op.value);
    if (op.op === "tokens") return validate.tokens(op.value);
    if (op.op === "thread" && op.value) return validate.threads([op.value]);
    return true;
  });
}

export function createHub({ read, write, hostAllowed, auth, validate }) {
  const rooms = new Map(); // file id -> room
  const joining = new Map(); // file id -> the room being made, so two people arriving together share it
  const pending = new Map(); // call id -> { resolve, reject, client, timer }: tool calls a page has yet to answer
  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });

  // ---------- Telling people things ----------
  const tell = (client, message) => client.ws.readyState === 1 && client.ws.send(JSON.stringify(message));
  const tellAll = (room, message, except) => {
    for (const client of room.clients) if (client !== except) tell(client, message);
  };

  // ---------- Keeping the file ----------
  function saveNow(room) {
    clearTimeout(room.saveTimer);
    room.saveTimer = null;
    room.file.updatedAt = Date.now();
    return write(room.file).catch((error) => console.error("Could not save", room.id, error));
  }
  function saveSoon(room) {
    clearTimeout(room.saveTimer);
    room.saveTimer = setTimeout(() => saveNow(room), SAVE_AFTER_MS);
  }

  /** Applies edits to the room's file, tells everyone but `from`, and schedules the write. */
  function change(room, ops, from) {
    const state = stateOf(room.file);
    apply(state, ops);
    Object.assign(room.file, state);
    room.rev++;
    tellAll(room, { t: "ops", ops, rev: room.rev, from: from?.id ?? null }, from);
    saveSoon(room);
  }

  async function loadRoom(id) {
    const file = await read(id);
    if (!file) return null;
    file.pages ??= [{ id: "page-1", label: "Page 1" }];
    file.tokens ??= [];
    file.threads ??= [];
    const room = { id, file, clients: new Set(), rev: 0, saveTimer: null };
    rooms.set(id, room);
    return room;
  }
  function roomFor(id) {
    if (rooms.has(id)) return Promise.resolve(rooms.get(id));
    if (!joining.has(id)) joining.set(id, loadRoom(id).finally(() => joining.delete(id)));
    return joining.get(id);
  }

  // ---------- Letting people in ----------
  async function upgrade(req, socket, head) {
    const refuse = (code, text) => { socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`); socket.destroy(); };
    try {
      if (!hostAllowed(req)) return refuse(403, "Forbidden");
      const url = new URL(req.url, "http://x");
      const id = /^\/sync\/([\w-]{1,64})$/.exec(url.pathname)?.[1];
      if (!id) return refuse(404, "Not Found");

      // With sign-in on, who someone is comes from their account; with it off, from what their page says.
      const claimed = { id: url.searchParams.get("uid"), name: url.searchParams.get("name") };
      const user = auth ? await auth.userOf(req)
        : /^[\w-]{1,40}$/.test(claimed.id ?? "") && claimed.name?.trim() ? { id: claimed.id, name: claimed.name.trim().slice(0, 40) } : null;
      const room = await roomFor(id);
      if (!room) return refuse(404, "Not Found");

      // The owner edits (with sign-in off, anyone does) unless they asked only to look; anyone may look at a shared file.
      const isOwner = auth ? room.file.owner === user?.id : true;
      const role = isOwner && url.searchParams.get("shared") !== "1" ? "edit" : room.file.access === "link" ? "view" : null;
      if (!role) return refuse(auth && !user ? 401 : 403, "Forbidden");
      sockets.handleUpgrade(req, socket, head, (ws) => admit(room, ws, user, role));
    } catch (error) {
      console.error("Sync refused", error);
      refuse(500, "Server Error");
    }
  }

  /** The first color nobody in the room has, else one reused in turn. */
  function colorFor(room) {
    const used = new Set([...room.clients].map((c) => c.color));
    return COLORS.find((color) => !used.has(color)) ?? COLORS[room.clients.size % COLORS.length];
  }

  function admit(room, ws, user, role) {
    const client = { ws, id: randomBytes(4).toString("hex"), role, user, color: colorFor(room), presence: null, lastActive: Date.now() };
    client.name = user?.name ?? `Guest ${room.clients.size + 1}`;
    room.clients.add(client);

    const { name, access, pages, tokens, threads, nodes } = room.file;
    const peers = [...room.clients].filter((c) => c !== client && c.presence)
      .map((c) => ({ id: c.id, name: c.name, color: c.color, ...c.presence, userId: c.user?.id ?? null }));
    tell(client, { t: "hello", you: { id: client.id, name: client.name, color: client.color, userId: user?.id ?? null }, role, rev: room.rev, file: { name, access, pages, tokens, threads, nodes }, peers });

    ws.on("message", (raw) => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { message = null; }
      if (!message || typeof message !== "object") return tell(client, { t: "error", error: "Not JSON" });
      onMessage(room, client, message);
    });
    ws.on("close", () => leave(room, client));
  }

  // ---------- What people send ----------
  const handlers = {
    // A page's answer to a tool call; only the page the call was sent to may answer it.
    result(room, client, message) {
      const call = pending.get(message.id);
      if (call?.client !== client) return;
      pending.delete(message.id);
      clearTimeout(call.timer);
      if (message.error) call.reject(new Error(String(message.error)));
      else call.resolve(message.value);
    },

    // An editor shows the others what an agent is working on.
    agent(room, client, message) {
      if (client.role !== "edit") return;
      tellAll(room, {
        t: "agent", from: client.id, name: String(message.name ?? "Agent").slice(0, 40),
        nodeIds: strings(message.nodeIds, MAX_AGENT_NODES), working: Boolean(message.working),
      }, client);
    },

    // The tab is in front: calls from agents go to the page touched last.
    focus(room, client) {
      client.lastActive = Date.now();
    },

    presence(room, client, message) {
      client.lastActive = Date.now();
      client.presence = { page: String(message.page ?? ""), x: Number(message.x) || 0, y: Number(message.y) || 0, selection: strings(message.selection, MAX_SELECTION) };
      tellAll(room, { t: "presence", id: client.id, name: client.name, color: client.color, userId: client.user?.id ?? null, ...client.presence }, client);
    },

    ops(room, client, message) {
      if (client.role !== "edit") return tell(client, { t: "error", error: "This file is open for looking only" });
      if (!validOps(message.ops) || !partsAreValid(message.ops, validate)) return tell(client, { t: "error", error: "Those edits are not valid" });
      client.lastActive = Date.now();
      change(room, message.ops, client);
      tell(client, { t: "ack", rev: room.rev });
    },
  };
  const onMessage = (room, client, message) => Object.hasOwn(handlers, message.t) && handlers[message.t](room, client, message);

  async function leave(room, client) {
    for (const [id, call] of pending) {
      if (call.client !== client) continue;
      pending.delete(id);
      clearTimeout(call.timer);
      call.reject(new Error("The editor was closed before it answered"));
    }
    room.clients.delete(client);
    tellAll(room, { t: "leave", id: client.id });
    if (room.clients.size) return;
    if (room.saveTimer) await saveNow(room);
    rooms.delete(room.id);
  }

  // ---------- Agents: which page to ask ----------
  const editorsOf = (fileId) => [...rooms.values()]
    .filter((room) => !fileId || room.id === fileId)
    .flatMap((room) => [...room.clients].filter((c) => c.role === "edit").map((client) => ({ room, client })));
  const mostRecent = (list) => [...list].sort((a, b) => b.client.lastActive - a.client.lastActive)[0];

  return {
    upgrade,
    room: (id) => rooms.get(id),

    /** Which files are open in an editor, and which one the user is in. */
    status() {
      const editors = editorsOf();
      return { open: new Set(editors.map((e) => e.room.id)), active: mostRecent(editors)?.room.id ?? null };
    },

    /** Runs a tool in the page that has the file open (the one the user touched last, if several have it). */
    call(fileId, method, args, { timeout = CALL_TIMEOUT_MS, agent } = {}) {
      const target = mostRecent(editorsOf(fileId));
      if (!target) {
        return Promise.reject(new Error(fileId ? "That file is not open in an editor. Open it with open_file first." : "No file is open in an editor. Open the Editor app on a file, or use open_file."));
      }
      const id = randomBytes(6).toString("hex");
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`The editor did not answer ${method} in ${timeout / 1000} seconds`));
        }, timeout);
        pending.set(id, { resolve, reject, client: target.client, timer });
        tell(target.client, { t: "call", id, method, args, agent });
      });
    },

    /** Tells every editor to open a file, and waits for one to have it. */
    async open(fileId, patience = OPEN_TIMEOUT_MS) {
      for (const { client } of editorsOf()) tell(client, { t: "open", fileId });
      const deadline = Date.now() + patience;
      while (Date.now() < deadline) {
        if (mostRecent(editorsOf(fileId))) return true;
        await wait(150);
      }
      return false;
    },

    /** A change made by a plain request while the file is open goes the same way as an editor's edits. Null when it is not open. */
    patch(id, next) {
      const room = rooms.get(id);
      if (!room) return null;
      const { file } = room;
      const ops = diff(stateOf(file), stateOf({ pages: file.pages, tokens: file.tokens, threads: file.threads, nodes: file.nodes, ...next }));
      if (ops.length) change(room, ops, null);
      if (next.name !== file.name || next.access !== file.access) {
        Object.assign(file, { name: next.name ?? file.name, access: next.access ?? file.access });
        tellAll(room, { t: "meta", name: file.name, access: file.access });
        saveSoon(room);
      }
      return file;
    },

    /** The file was deleted: everyone is let go. */
    drop(id) {
      const room = rooms.get(id);
      if (!room) return;
      clearTimeout(room.saveTimer);
      rooms.delete(id);
      for (const client of room.clients) client.ws.close(4004, "deleted");
    },

    async close() {
      for (const room of rooms.values()) {
        if (room.saveTimer) await saveNow(room);
        for (const client of room.clients) client.ws.close(1001, "going away");
      }
      sockets.close();
    },
  };
}
