import test from "node:test";
import assert from "node:assert/strict";
import { extractDeclarations, mapToTheme, pickTokenFiles } from "../client/core/repo-tokens.js";
import { parseTokensCss, planTokenChanges, tokensToCss } from "../client/core/tokens.js";

const SHADCN = `
@tailwind base;
@layer base {
  :root {
    --background: 0 0% 100%; /* page */
    --primary: 222 47% 11%;
    --primary-foreground: 210 40% 98%;
    --radius: 0.5rem;
    --sidebar-width: 16rem;
  }
  .dark { --background: 222 47% 11%; --primary: 210 40% 98%; }
}`;
const TAILWIND4 = `
@theme {
  --color-brand: oklch(0.6 0.2 30);
  --color-ink: #1a1a1a;
  --font-sans: "Inter", sans-serif;
  --font-weight-bold: 700;
  --text-sm: 0.875rem;
  --text-primary: #222;
  --spacing: 0.25rem;
  --shadow-sm: 0 1px 2px #0002;
  --radius-md: var(--radius);
  --radius-lg: calc(var(--radius) + 4px);
  --tracking-wide: 0.05em;
}`;

test("the likely theme files come first, and built folders are skipped", () => {
  const picked = pickTokenFiles(["src/components/button.css", "node_modules/x/globals.css", "src/app/globals.css", "dist/app.css", "README.md", "styles/tokens.css", "a.css"]);
  assert.deepEqual(picked, ["styles/tokens.css", "src/app/globals.css", "a.css", "src/components/button.css"]);
  assert.equal(pickTokenFiles(Array.from({ length: 20 }, (_, i) => `s/${i}.css`)).length, 8);
});

test("declarations are found however deep, and the first of a name wins", () => {
  const found = extractDeclarations(SHADCN);
  assert.deepEqual(found.find((d) => d.name === "background"), { name: "background", value: "0 0% 100%" });
  assert.deepEqual(found.find((d) => d.name === "primary"), { name: "primary", value: "222 47% 11%" });
  assert.equal(found.length, 5);
});

test("a repo's variables become the editor's tokens, and what has no kind here is dropped with its reason", () => {
  const { tokens, dropped } = mapToTheme([...extractDeclarations(SHADCN), ...extractDeclarations(TAILWIND4)]);
  const byName = Object.fromEntries(tokens.map((t) => [`${t.type}:${t.name}`, t.value]));
  assert.equal(byName["color:background"], "hsl(0 0% 100%)");
  assert.equal(byName["color:primary-foreground"], "hsl(210 40% 98%)");
  assert.equal(byName["radius:default"], "0.5rem");
  assert.equal(byName["color:brand"], "oklch(0.6 0.2 30)");
  assert.equal(byName["color:ink"], "#1a1a1a");
  assert.equal(byName["fontFamily:sans"], "Inter, sans-serif".replace("Inter", '"Inter"'));
  assert.equal(byName["fontWeight:bold"], "700");
  assert.equal(byName["fontSize:sm"], "0.875rem");
  assert.equal(byName["color:text-primary"], "#222");
  assert.equal(byName["spacing:default"], "0.25rem");
  assert.equal(byName["radius:md"], "var(--radius-default)");
  assert.equal(byName["radius:lg"], "calc(var(--radius-default) + 4px)");
  assert.equal(byName["letterSpacing:wide"], "0.05em");
  assert.deepEqual(dropped.map((d) => d.name), ["sidebar-width", "shadow-sm"]);
  assert.match(dropped[0].reason, /not a token kind/);
  // It reads back as the same tokens through the Theme tab's parser.
  assert.deepEqual(parseTokensCss(tokensToCss(tokens)).tokens, tokens);
});

test("a var() that points at nothing is dropped, and two names on one variable keep the first", () => {
  const { tokens, dropped } = mapToTheme([{ name: "radius-sm", value: "var(--gone)" }, { name: "color-primary", value: "#111" }, { name: "primary", value: "#222" }]);
  assert.deepEqual(tokens, [{ type: "color", name: "primary", value: "#111" }]);
  assert.deepEqual(dropped.map((d) => d.name), ["radius-sm", "primary"]);
});

test("importing adds to the theme without removing what was there", () => {
  const existing = [{ id: "a", type: "color", name: "mine", value: "#000" }, { id: "b", type: "color", name: "brand", value: "#111" }];
  const plan = planTokenChanges(existing, [{ type: "color", name: "brand", value: "#222" }, { type: "radius", name: "md", value: "8px" }], { replace: false });
  assert.deepEqual(plan, { remove: [], update: [{ id: "b", value: "#222" }], add: [{ type: "radius", name: "md", value: "8px" }] });
  assert.equal(planTokenChanges(existing, []).remove.length, 2);
});
