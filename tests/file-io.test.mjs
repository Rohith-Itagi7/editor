import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { exportFile, importFile } from "../server/file-io.mjs";
import { startServer } from "../server/server.mjs";

test("a file saved to the disk opens again as a new file, with everything in it", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "editor-io-"));
  const { server, url } = await startServer({ port: 0, dataDir });
  try {
    const patch = { name: "Study", nodes: [{ id: "n1", component: "Frame", name: "Card", parent: null, page: "page-1", style: {} }], pages: [{ id: "page-1", label: "One" }, { id: "page-2", label: "Two" }], tokens: [{ id: "t1", type: "color", name: "Brand", value: "#fff" }] };
    const { id } = await (await fetch(new URL("/api/files", url), { method: "POST", body: JSON.stringify(patch) })).json();
    const target = path.join(dataDir, "out.json");
    assert.deepEqual(await exportFile(url, id, target), { name: "Study" });
    const saved = JSON.parse(await fs.readFile(target, "utf8"));
    assert.deepEqual(Object.keys(saved).sort(), ["name", "nodes", "pages", "repo", "threads", "tokens"]);

    const again = await importFile(url, target);
    assert.notEqual(again, id);
    const copy = await (await fetch(new URL(`/api/files/${again}`, url))).json();
    assert.deepEqual([copy.name, copy.nodes, copy.pages, copy.tokens], [patch.name, patch.nodes, patch.pages, patch.tokens]);
  } finally { server.close(); }
});

test("a file that is not one of ours is refused with a reason", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "editor-io-"));
  const { server, url } = await startServer({ port: 0, dataDir });
  try {
    const write = (name, text) => fs.writeFile(path.join(dataDir, name), text).then(() => path.join(dataDir, name));
    await assert.rejects(importFile(url, await write("a.txt", "plain words")), /not a JSON file/);
    await assert.rejects(importFile(url, await write("b.json", JSON.stringify({ hello: 1 }))), /not a file saved from this editor/);
    await assert.rejects(importFile(url, path.join(dataDir, "missing.json")), /Could not read the file/);
    // No name inside: the file's own name stands in.
    const id = await importFile(url, await write("Sketch.json", JSON.stringify({ nodes: [] })));
    assert.equal((await (await fetch(new URL(`/api/files/${id}`, url))).json()).name, "Sketch");
    await assert.rejects(exportFile(url, "nothing", path.join(dataDir, "x.json")), /No such file/);
  } finally { server.close(); }
});
