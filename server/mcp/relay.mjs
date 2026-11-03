// The process an agent starts to talk to the editor: JSON-RPC lines on stdin and stdout, the editor's /mcp on the other
// side. Every agent's config points at it, so each is set up the same way and none needs HTTP of its own. It has no
// dependencies, so one copy in ~/.editor/bin serves every version of the app.
//
// If the editor is not running, a request is answered with an error that says so. If the editor restarted (its
// session is gone) the relay opens a new session, repeats what the agent said first, and sends the request again.
import { createInterface } from "node:readline";

const ENDPOINT = process.env.EDITOR_URL ?? "http://127.0.0.1:4191/mcp";
const NOT_RUNNING = "The Editor app is not running. Open it, then try again.";

const emit = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const hasId = (message) => message.id !== undefined && message.id !== null;
const answerError = (message, text) => hasId(message) && emit({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: text } });
const drop = (response) => response?.body?.cancel().catch(() => {});

/** The data of every complete server-sent event in `text`, and what is left over after them. */
function takeEvents(text) {
  const events = [];
  let rest = text, gap;
  while ((gap = rest.search(/\r?\n\r?\n/)) >= 0) {
    const data = rest.slice(0, gap).split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
    if (data) events.push(data);
    rest = rest.slice(gap).replace(/^\r?\n\r?\n/, "");
  }
  return { events, rest };
}

/** The editor answers with one JSON body or with a stream of events; what is in it goes out on stdout. */
async function forward(response) {
  if ((response.headers.get("content-type") ?? "").includes("application/json")) {
    const body = await response.json();
    return [body].flat().forEach(emit);
  }
  const decoder = new TextDecoder();
  let pending = "";
  for await (const chunk of response.body) {
    const { events, rest } = takeEvents(pending + decoder.decode(chunk, { stream: true }));
    pending = rest;
    events.forEach((data) => emit(JSON.parse(data)));
  }
}

function connect() {
  let session = null;
  let opening = []; // what the agent said first (initialize, then initialized): sent again to a restarted editor

  const post = (message) => fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "x-editor-from": "relay", ...(session ? { "mcp-session-id": session } : {}) },
    body: JSON.stringify(message),
  });

  async function reopen() {
    session = null;
    for (const message of opening) {
      const response = await post(message).catch(() => null);
      session ??= response?.headers.get("mcp-session-id") ?? null;
      await drop(response);
    }
  }

  async function deliver(message, again = false) {
    let response;
    try {
      response = await post(message);
    } catch {
      return answerError(message, NOT_RUNNING);
    }
    if (response.status === 404 && session && !again) {
      await reopen();
      return deliver(message, true);
    }
    if (message.method === "initialize") opening = [message];
    if (message.method === "notifications/initialized") opening.push(message);
    session ??= response.headers.get("mcp-session-id");
    // A notification has no id, so nothing comes back (an id of 0 is still an id).
    if (!message.id && message.id !== 0) return drop(response);
    if (!response.ok) return answerError(message, (await response.text().catch(() => "")).slice(0, 300) || `The editor answered ${response.status}`);
    return forward(response);
  }

  const hangUp = async () => { if (session) await fetch(ENDPOINT, { method: "DELETE", headers: { "mcp-session-id": session } }).catch(() => {}); };
  return { deliver, hangUp };
}

const link = connect();
const running = new Set();
let handshaking = null; // the initialize in flight: nothing else goes out before the editor has given a session

createInterface({ input: process.stdin })
  .on("line", (line) => {
    if (!line.trim()) return;
    let message;
    try { message = JSON.parse(line); } catch { return; }
    const isInitialize = message.method === "initialize";
    const start = () => (isInitialize ? link.deliver(message) : Promise.resolve(handshaking).then(() => link.deliver(message)));
    const task = start().catch((error) => answerError(message, error.message)).finally(() => running.delete(task));
    if (isInitialize) handshaking = task;
    running.add(task);
  })
  .on("close", async () => {
    await Promise.allSettled(running);
    await link.hangUp();
    process.exit(0);
  });
