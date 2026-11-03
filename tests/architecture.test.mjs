import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PUBLIC } from "../server/server.mjs";

// Who may import whom. Each folder lists the folders it can reach; everything else is a mistake, so the
// page cannot grow a hidden tangle and the server never reaches into the page. Lower levels come first.
//   shared   code both the server and the page run (the edit format)
//   core     the document: store, tokens, vector geometry, style values, the registries kinds add to
//   ui       controls, icons, toasts: no knowledge of the document
//   canvas   drawing and moving things on the canvas
//   features copy and paste, import, export: what can be done with a document
//   kinds    node kinds that add themselves to the canvas and the panel (vectors)
//   panels   the side panels and the design panel's sections
//   tools    the toolbar, hotkeys, the Pen
//   collab   live sync and the agent's calls
const RULES = {
  "shared": [],
  "client/core": ["shared"],
  "client/ui": [],
  "client/canvas": ["client/core", "client/ui"],
  "client/features": ["client/core", "client/ui"],
  "client/kinds": ["client/core", "client/ui", "client/canvas"],
  "client/panels": ["client/core", "client/ui", "client/features"],
  "client/tools": ["client/core", "client/ui", "client/features", "client/kinds"],
  "client/collab": ["client/core", "client/ui", "client/features", "shared"],
  "client": ["client/core", "client/ui", "client/canvas", "client/features", "client/kinds", "client/panels", "client/tools", "client/collab"],
  "server/mcp": ["shared"],
  "server": ["server/mcp", "shared"],
  "desktop": ["server", "server/mcp"],
};

const root = path.join(import.meta.dirname, "..");
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const zoneOf = (file) => {
  const parts = path.relative(root, file).split(path.sep);
  if (parts[0] === "client") return parts.length > 2 ? `client/${parts[1]}` : "client";
  if (parts[0] === "server") return parts[1] === "mcp" ? "server/mcp" : "server";
  return parts[0];
};

test("every file belongs to a folder that has rules", () => {
  for (const top of ["client", "server", "shared", "desktop"]) {
    for (const file of walk(path.join(root, top)).filter((f) => /\.m?js$/.test(f))) assert.ok(zoneOf(file) in RULES, `${path.relative(root, file)} is in a folder with no rules`);
  }
});

test("imports only go where the rules allow", () => {
  const broken = [];
  for (const top of ["client", "server", "shared", "desktop"]) {
    for (const file of walk(path.join(root, top)).filter((f) => /\.m?js$/.test(f))) {
      const from = zoneOf(file);
      for (const match of fs.readFileSync(file, "utf8").matchAll(/(?:from\s*|import\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/g)) {
        const target = path.resolve(path.dirname(file), match[1]);
        if (!fs.existsSync(target)) { broken.push(`${path.relative(root, file)} imports ${match[1]}, which is not there`); continue; }
        const to = zoneOf(target);
        if (to !== from && !RULES[from].includes(to)) broken.push(`${path.relative(root, file)} (${from}) imports ${path.relative(root, target)} (${to})`);
      }
    }
  }
  assert.deepEqual(broken, []);
});

test("the server only serves the page's folders", () => {
  assert.ok(PUBLIC.test("/client/main.js") && PUBLIC.test("/shared/ops.js"));
  assert.ok(!PUBLIC.test("/server/server.mjs") && !PUBLIC.test("/desktop/main.mjs") && !PUBLIC.test("/package.json"));
});

test("every node kind is loaded by something, or it never registers", () => {
  const sources = walk(path.join(root, "client")).filter((f) => /\.js$/.test(f)).map((f) => [f, fs.readFileSync(f, "utf8")]);
  for (const [kind] of sources.filter(([f]) => zoneOf(f) === "client/kinds")) {
    const name = path.basename(kind);
    assert.ok(sources.some(([f, text]) => f !== kind && text.includes(`kinds/${name}"`)), `${name} is imported by no file, so it never registers its renderer`);
  }
});
