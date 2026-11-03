import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";

const relay = path.join(import.meta.dirname, "..", "server", "mcp", "relay.mjs");

// A stand-in for the editor: it hands out sessions, answers a tool list as a stream of events cut in the
// middle of one, and can forget every session at once, as a restart does.
function fakeEditor() {
  const sessions = new Set();
  const seen = { initializes: 0, deleted: [] };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => { body += d; });
    req.on("end", () => {
      const session = req.headers["mcp-session-id"];
      if (req.method === "DELETE") { seen.deleted.push(session); return res.writeHead(200).end(); }
      const message = JSON.parse(body);
      if (message.method === "initialize") {
        seen.initializes++;
        const id = `session-${seen.initializes}`;
        sessions.add(id);
        return res.writeHead(200, { "content-type": "application/json", "mcp-session-id": id }).end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { serverInfo: { name: "editor" } } }));
      }
      if (!sessions.has(session)) return res.writeHead(404).end("Unknown session");
      if (message.id === undefined) return res.writeHead(202).end();
      if (message.method === "bad") return res.writeHead(500).end("it broke");
      const event = `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { tools: ["a", "b"] } })}\n\n`;
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(event.slice(0, 20));
      setTimeout(() => res.end(event.slice(20)), 10);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, sessions, seen, url: `http://127.0.0.1:${server.address().port}/mcp` })));
}

function startRelay(url) {
  const child = spawn(process.execPath, [relay], { env: { ...process.env, EDITOR_URL: url } });
  const answers = [], waiting = [];
  let buffer = "";
  child.stdout.on("data", (d) => {
    buffer += d;
    let i;
    while ((i = buffer.indexOf("\n")) >= 0) { answers.push(JSON.parse(buffer.slice(0, i))); buffer = buffer.slice(i + 1); }
    waiting.splice(0).forEach((wake) => wake());
  });
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  const answered = async (id) => { while (!answers.some((a) => a.id === id)) await new Promise((wake) => waiting.push(wake)); return answers.find((a) => a.id === id); };
  const close = () => new Promise((resolve) => { child.on("close", resolve); child.stdin.end(); });
  return { send, answered, close };
}

test("the relay reads events cut in pieces, reports a failing editor, and opens a new session when the editor restarts", async () => {
  const editor = await fakeEditor();
  const agent = startRelay(editor.url);
  try {
    agent.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    agent.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    agent.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    assert.equal((await agent.answered(1)).result.serverInfo.name, "editor");
    assert.deepEqual((await agent.answered(2)).result.tools, ["a", "b"]);

    agent.send({ jsonrpc: "2.0", id: 0, method: "bad" });
    assert.match((await agent.answered(0)).error.message, /it broke/);

    editor.sessions.clear(); // the editor restarted
    agent.send({ jsonrpc: "2.0", id: 3, method: "tools/list" });
    assert.deepEqual((await agent.answered(3)).result.tools, ["a", "b"]);
    assert.equal(editor.seen.initializes, 2);
  } finally {
    await agent.close();
    editor.server.close();
  }
  assert.deepEqual(editor.seen.deleted, ["session-2"]); // it hangs up the session it ended with
});
