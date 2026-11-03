import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../client/core/store.js";
import { tokensToCss, parseTokensCss } from "../client/core/tokens.js";

test("theme text: tokensToCss read back by parseTokensCss gives the same tokens, in both forms", () => {
  const store = createStore([], { tokens: [
    { id: "token-1", type: "color", name: "brand-blue", value: "#16a36a" },
    { id: "token-3", type: "fontFamily", name: "sans", value: "Inter Tight" },
    { id: "token-2", type: "fontWeight", name: "bold", value: "700" },
  ] });
  const expected = store.tokens().map(({ type, name, value }) => ({ type, name, value }));
  for (const format of ["tailwind", "css"]) assert.deepEqual(parseTokensCss(tokensToCss(store.tokens(), format)).tokens, expected);
});

test("theme text: comments and @theme inline are fine, and a typo is an error, not a wipe", () => {
  assert.equal(parseTokensCss("/* x */ @theme inline { --radius-card: 12px; }").tokens[0].name, "card");
  assert.equal(parseTokensCss("@theme {}").tokens.length, 0);
  for (const bad of ["", "--color-a: red;", "@theme { --color-a: red", "@theme { --color-a: red --color-b: blue; }", "@theme { --nope-a: 1px; }", "@theme { color-a red; }", "@theme { --color-: red; }"]) {
    assert.ok(parseTokensCss(bad).error, bad);
  }
});
