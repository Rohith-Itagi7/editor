// Live sync, the page's side (the server's is sync.mjs): your edits go out as short lists of changes,
// other people's come in and are applied as they arrive, and you see where they are: a cursor with
// their name on the page they are on, an outline on what they have selected, and their initial beside
// yours in the top bar. The file is the server's, so what is on the page when the connection comes back
// is the server's copy with your unsent edits laid over it, element by element, the last one winning.
//
// An agent working over MCP (mcp.mjs) is one more editor: the server sends this page its tool calls, they
// are run here (mcp-handlers.js) on the page's own store, so they sync like anything typed, and the layers
// an agent is working on are outlined with its name for everyone who has the file open.
import { apply, diff } from "../../shared/ops.js";
import { toast } from "../ui/toast.js";
import { agentColor } from "../ui/agent-colors.js";

const SEND_DELAY = 60;
const POINTER_EVERY = 50;
const RETRY = [1000, 2000, 4000, 8000];
const GIVE_UP_AFTER = 3; // tries before the first connection, after which saving goes by plain requests
const clone = (value) => structuredClone(value);

export function mountSync({ store, canvas, fileId, shared, onMeta, identity, agentCalls }) {
  const layer = Object.assign(document.createElement("div"), { className: "peers" });
  canvas.append(layer);
  const avatar = document.querySelector(".top-bar .avatar");
  let ws = null;
  let status = "connecting"; // connecting | open | offline | none
  let everOpen = false;
  let tries = 0;
  let role = shared ? "view" : "edit";
  let you = null;
  let synced = clone(store.state()); // what the server is known to have
  const peers = new Map();
  let sendTimer = null;
  let announced = false;
  let runCall = null; // runs an agent's tool call here; made once the connection can announce
  const agents = new Map(); // who is working on what: key -> { name, nodeIds, timer }

  // With sign-in off the server cannot know who is who, so the page says: a guest's id and name.
  const url = () => {
    const query = new URLSearchParams();
    if (shared) query.set("shared", "1");
    if (identity) { query.set("uid", identity.id); query.set("name", identity.name); }
    return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/sync/${fileId}${query.size ? `?${query}` : ""}`;
  };
  const open = () => ws?.readyState === 1;
  const tell = (message) => open() && ws.send(JSON.stringify(message));

  // ---------- Going out ----------
  function flush() {
    sendTimer = null;
    if (status !== "open" || role !== "edit") return;
    const ops = diff(synced, store.state());
    if (!ops.length) return;
    tell({ t: "ops", ops });
    synced = clone(store.state());
  }
  const schedule = () => { if (!sendTimer) sendTimer = setTimeout(flush, SEND_DELAY); };
  store.subscribe((reason) => {
    if (reason === "document" || reason === "threads") schedule();
    if (reason === "selection" || reason === "page") sendPresence();
    if (reason === "ui" || reason === "document" || reason === "page" || reason === "selection") paintPeers();
  });

  let lastPointer = { x: 0, y: 0 };
  let pointerTimer = 0;
  function sendPresence() {
    if (!open()) return;
    tell({ t: "presence", page: store.activePage(), x: lastPointer.x, y: lastPointer.y, selection: store.selection() });
  }
  canvas.addEventListener("pointermove", (event) => {
    const box = canvas.getBoundingClientRect();
    lastPointer = { x: Math.round((event.clientX - box.left - store.ui.panX) / store.ui.zoom), y: Math.round((event.clientY - box.top - store.ui.panY) / store.ui.zoom) };
    if (Date.now() - pointerTimer > POINTER_EVERY) { pointerTimer = Date.now(); sendPresence(); }
  });

  // ---------- Coming in ----------
  function onHello(message) {
    you = message.you;
    role = message.role;
    everOpen = true;
    tries = 0;
    status = "open";
    const server = { nodes: message.file.nodes, pages: message.file.pages, tokens: message.file.tokens, threads: message.file.threads };
    // What was changed here while the server was out of reach goes over what the server has now.
    const pending = diff(synced, store.state());
    const merged = apply(clone(server), pending);
    if (JSON.stringify(merged) !== JSON.stringify({ nodes: store.state().nodes, pages: store.state().pages, tokens: store.state().tokens, threads: store.state().threads })) store.replaceState(merged);
    synced = clone(server);
    if (pending.length && role === "edit") { tell({ t: "ops", ops: pending }); synced = clone(store.state()); }
    onMeta?.({ name: message.file.name, access: message.file.access });
    if (avatar) { avatar.textContent = (you.name?.[0] ?? "?").toUpperCase(); avatar.style.background = you.color; avatar.title = `${you.name} (you)`; }
    peers.clear();
    for (const peer of message.peers) peers.set(peer.id, peer);
    if (announced) toast("Back online");
    announced = false;
    sendPresence();
    paintPeers();
  }

  // An agent says what it is working on; the layers stay outlined until it says it is done, or for 30 seconds.
  function showAgent(key, { name, nodeIds, working }) {
    clearTimeout(agents.get(key)?.timer);
    if (!working || !nodeIds.length) agents.delete(key);
    else agents.set(key, { name, nodeIds, timer: setTimeout(() => { agents.delete(key); paintPeers(); }, 30000) });
    paintPeers();
  }
  const announce = (info) => { tell({ t: "agent", ...info }); showAgent(`here:${info.name ?? "Agent"}`, { name: "Agent", nodeIds: [], ...info }); };
  runCall = agentCalls?.(announce) ?? null;

  async function onCall(message) {
    try {
      if (!runCall) throw new Error("This page cannot run agent calls");
      tell({ t: "result", id: message.id, value: (await runCall(message.method, message.args, message.agent)) ?? null });
    } catch (error) {
      tell({ t: "result", id: message.id, error: error instanceof Error ? error.message : String(error) });
    }
  }

  function onMessage(raw) {
    const message = JSON.parse(raw.data);
    if (message.t === "hello") return onHello(message);
    if (message.t === "call") return onCall(message);
    // An agent asked for another file: the window the user is looking at goes there.
    if (message.t === "open") { if (document.visibilityState === "visible" && !shared && location.pathname !== `/file/${message.fileId}`) location.href = `/file/${message.fileId}`; return; }
    if (message.t === "agent") return showAgent(message.from, message);
    if (message.t === "ops") {
      // Known to the server already, so not sent back. The copy kept here must not share objects with the store's,
      // or an edit to an element would change both and never show as a difference.
      apply(synced, clone(message.ops));
      store.applyRemote(message.ops);
    } else if (message.t === "presence") { peers.set(message.id, message); paintPeers(); }
    else if (message.t === "leave") { peers.delete(message.id); paintPeers(); }
    else if (message.t === "meta") onMeta?.({ name: message.name, access: message.access });
    else if (message.t === "error") toast(message.error);
  }

  // ---------- The connection ----------
  function connect() {
    try {
      ws = new WebSocket(url());
    } catch {
      return lost();
    }
    ws.onmessage = onMessage;
    ws.onclose = (event) => {
      if (event.code === 4004) { toast("This file was deleted"); return setTimeout(() => (location.href = "/files"), 1200); }
      lost();
    };
    ws.onerror = () => {};
  }
  function lost() {
    peers.clear();
    paintPeers();
    if (!everOpen && ++tries >= GIVE_UP_AFTER) { status = "none"; return; } // no live sync here: saves go by plain requests
    if (status === "open" && !announced) { toast("Offline. Reconnecting…"); announced = true; }
    status = everOpen ? "offline" : "connecting";
    setTimeout(connect, RETRY[Math.min(tries++, RETRY.length - 1)]);
  }
  // The server sends an agent's calls to the page the user was last in.
  const focused = () => document.visibilityState === "visible" && tell({ t: "focus" });
  addEventListener("focus", focused);
  document.addEventListener("visibilitychange", focused);
  addEventListener("pagehide", () => { flush(); ws?.close(1000); });
  connect();

  // ---------- Showing the others ----------
  const screen = (x, y) => ({ left: x * store.ui.zoom + store.ui.panX, top: y * store.ui.zoom + store.ui.panY });
  function paintPeers() {
    const here = [...peers.values()].filter((p) => p.page === store.activePage());
    const pieces = [];
    for (const peer of here) {
      for (const id of peer.selection ?? []) {
        const element = canvas.querySelector(`[data-node-id="${CSS.escape(id)}"]`);
        if (!element) continue;
        const r = element.getBoundingClientRect(), box = canvas.getBoundingClientRect();
        pieces.push(Object.assign(document.createElement("div"), { className: "peer-outline", style: `left:${r.left - box.left}px;top:${r.top - box.top}px;width:${r.width}px;height:${r.height}px;--peer:${peer.color}` }));
      }
      const at = screen(peer.x, peer.y);
      const cursor = Object.assign(document.createElement("div"), { className: "peer-cursor", style: `left:${at.left}px;top:${at.top}px;--peer:${peer.color}` });
      cursor.innerHTML = `<svg width="14" height="18" viewBox="0 0 14 18"><path d="M1 1l11 7-5 1.5L5 16z" fill="${peer.color}" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/></svg><span></span>`;
      cursor.querySelector("span").textContent = peer.name;
      pieces.push(cursor);
    }
    for (const agent of agents.values()) {
      for (const id of agent.nodeIds) {
        const element = canvas.querySelector(`[data-node-id="${CSS.escape(id)}"]`);
        if (!element) continue;
        const r = element.getBoundingClientRect(), box = canvas.getBoundingClientRect();
        const outline = Object.assign(document.createElement("div"), { className: "peer-outline agent-outline", style: `left:${r.left - box.left}px;top:${r.top - box.top}px;width:${r.width}px;height:${r.height}px;--peer:${agentColor(agent.name)}` });
        outline.dataset.agent = agent.name;
        pieces.push(outline);
      }
    }
    layer.replaceChildren(...pieces);
    // The top bar: your own initial, then each person who has the file open.
    if (avatar) {
      avatar.parentElement.querySelectorAll(".avatar.peer").forEach((el) => el.remove());
      [...peers.values()].forEach((peer) => avatar.after(Object.assign(document.createElement("span"), { className: "avatar peer", textContent: (peer.name?.[0] ?? "?").toUpperCase(), title: peer.name, style: `background:${peer.color}` })));
    }
  }

  return { call: (method, args, agent) => { if (!runCall) throw new Error("This page cannot run agent calls"); return runCall(method, args, agent); }, mode: () => (status === "none" ? "none" : "live"), isOpen: () => status === "open", you: () => you, peers: () => [...peers.values()] };
}
