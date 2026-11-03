import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { allowanceFrom, costFrom, createCredits } from "../server/credits.mjs";

const tempDir = () => fs.mkdtemp(path.join(os.tmpdir(), "editor-credits-"));

test("a charge is taken first, refused when it is more than what is left, and given back", async () => {
  const credits = createCredits({ dataDir: await tempDir(), env: { EDITOR_CREDITS: "3" } });
  await credits.spend("local", 2);
  assert.equal((await credits.balance("local")).remaining, 1);
  await assert.rejects(credits.spend("local", 2), (error) => error.status === 402 && /costs 2 credits and 1 are left/.test(error.message.replace("That ", "")));
  await credits.refund("local", 2);
  assert.equal((await credits.balance("local")).remaining, 3);
  await credits.refund("local", 5);
  assert.equal((await credits.balance("local")).spent, 0);
});

test("each account has its own allowance, and it is whole again when the month turns", async () => {
  const dataDir = await tempDir();
  const env = { EDITOR_CREDITS: "25" };
  await createCredits({ dataDir, env }).spend("ann", 10);
  assert.equal((await createCredits({ dataDir, env }).balance("bob")).remaining, 25);
  const later = createCredits({ dataDir, env, now: () => new Date(Date.UTC(2099, 0, 1)) });
  assert.equal((await later.balance("ann")).remaining, 25);
});

test("settings: unlimited turns the guard off, and a bad number falls back to the default", async () => {
  assert.equal(allowanceFrom({ EDITOR_CREDITS: "unlimited" }), Infinity);
  assert.equal(allowanceFrom({ EDITOR_CREDITS: "lots" }), 100);
  assert.equal(costFrom("agent", {}), 1);
  assert.equal(costFrom("agent", { EDITOR_COST_AGENT: "4" }), 4);
  const credits = createCredits({ dataDir: await tempDir(), env: { EDITOR_CREDITS: "unlimited" } });
  await credits.spend("local", 1000);
  assert.equal((await credits.balance("local")).remaining, null);
});
