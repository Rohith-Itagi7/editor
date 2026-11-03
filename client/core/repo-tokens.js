// The theme of a connected repo, out of its CSS: which files to read, the custom properties in them, and those as
// the editor's tokens. Only what has a kind here (colors, radii, spacing, type) becomes a token; the rest is
// reported as dropped. Pure functions: the page reads the files, this decides what they mean.
import { TOKEN_TYPES, cssName, slug } from "./tokens.js";

const MAX_FILES = 8;
const SKIP = /(^|\/)(node_modules|dist|build|\.next|out|coverage|storybook-static)\//;
const LIKELY = /(^|\/)(globals?|theme|tokens|variables|app|index|styles?|main)\.css$/;

/** The CSS files of a repo worth reading for its theme, the likeliest first: at most eight. */
export function pickTokenFiles(paths) {
  return paths
    .filter((p) => p.endsWith(".css") && !SKIP.test(p))
    .sort((a, b) => Number(LIKELY.test(b)) - Number(LIKELY.test(a)) || a.length - b.length || a.localeCompare(b))
    .slice(0, MAX_FILES);
}

/**
 * Every `--name: value;` in the text, in any block however deep (`:root`, `@theme`, `@layer base { :root {} }`),
 * as { name, value } without the dashes. The first of a name wins, so a light theme written before `.dark` is the
 * one that counts.
 */
export function extractDeclarations(css) {
  const seen = new Map();
  const text = String(css ?? "").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const [, name, value] of text.matchAll(/(?:^|[{;\s])--([\w-]+)\s*:\s*([^;{}]+?)\s*(?=;|})/g)) {
    if (!seen.has(name)) seen.set(name, value.trim());
  }
  return [...seen].map(([name, value]) => ({ name, value }));
}

// ---------- What a variable is ----------
const COLOR_VALUE = /^(#[0-9a-f]{3,8}|(rgba?|hsla?|oklch|oklab|lab|lch|color)\(.*\)|transparent|currentcolor)$/i;
const HSL_TRIPLE = /^\d+(\.\d+)?(deg)?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%$/;
const NUMBER_FIRST = /^-?\d/;
// A family name's prefix in the repo, and the kind it is here. Longest prefixes first, so "font-weight" is not "font".
const BY_PREFIX = [
  ["letter-spacing", "letterSpacing"], ["line-height", "lineHeight"], ["font-weight", "fontWeight"], ["font-family", "fontFamily"],
  ["font-size", "fontSize"], ["breakpoint", "breakpoint"], ["container", "container"], ["tracking", "letterSpacing"],
  ["leading", "lineHeight"], ["spacing", "spacing"], ["opacity", "opacity"], ["radius", "radius"], ["color", "color"],
  ["space", "spacing"], ["font", "fontFamily"], ["text", "fontSize"],
];
const BARE = { radius: "radius", spacing: "spacing", space: "spacing" };

/** The kind and token name of a repo variable, or null: "radius-md" is a radius named "md", "radius" alone is "default". */
function kindOf(name, value) {
  if (BARE[name]) return { type: BARE[name], name: "default" };
  for (const [prefix, type] of BY_PREFIX) {
    if (!name.startsWith(`${prefix}-`) || name.length === prefix.length + 1) continue;
    const rest = name.slice(prefix.length + 1);
    if (type === "fontSize" && prefix === "text" && !NUMBER_FIRST.test(value)) continue; // --text-primary is a color, not a size
    return { type, name: rest };
  }
  if (name === "font-sans" || name === "font-serif" || name === "font-mono") return { type: "fontFamily", name: name.slice(5) };
  return null;
}

/**
 * The declarations as the editor's tokens, { tokens: [{ type, name, value }], dropped: [{ name, reason }] }.
 * A Tailwind namespace keeps its kind; any other variable that holds a color (shadcn's `--primary: 222 47% 11%`
 * included, written as hsl()) becomes a color named after it; a var() points at the mapped name of its target.
 */
export function mapToTheme(declarations) {
  const mapped = new Map(); // repo name -> token
  const dropped = [];
  const pending = [];
  for (const { name, value } of declarations) {
    const ref = /^(?:calc\()?\s*var\(--([\w-]+)\)/.exec(value);
    if (ref) { pending.push({ name, value, target: ref[1] }); continue; }
    let token = kindOf(name, value);
    if (!token && HSL_TRIPLE.test(value)) token = { type: "color", name };
    else if (!token && COLOR_VALUE.test(value)) token = { type: "color", name };
    if (!token) { dropped.push({ name, reason: "not a token kind the editor has" }); continue; }
    let out = value;
    if (token.type === "color" && HSL_TRIPLE.test(value)) out = `hsl(${value.replace(/deg/, "")})`;
    if (token.type === "fontFamily" && /^(["']).*\1$/.test(out)) out = out.slice(1, -1);
    mapped.set(name, { ...token, value: out });
  }
  // A variable that points at another takes the kind of what it points at, once that one is known.
  for (const { name, value, target } of pending) {
    const to = mapped.get(target);
    const kind = kindOf(name, value) ?? (to ? { type: to.type, name } : null);
    if (!to || !kind) { dropped.push({ name, reason: `points at --${target}, which did not become a token` }); continue; }
    mapped.set(name, { ...kind, value: value.replace(`var(--${target})`, `var(${cssName(to)})`) });
  }
  // Two repo names can land on one variable here ("--color-primary" and shadcn's "--primary"): the first stays.
  const byCss = new Map();
  for (const [name, token] of mapped) {
    const css = cssName(token);
    if (byCss.has(css)) dropped.push({ name, reason: `the same as ${css}` });
    else byCss.set(css, { ...token, name: slug(token.name) });
  }
  const order = TOKEN_TYPES.map((t) => t.type);
  const tokens = [...byCss.values()].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  return { tokens, dropped };
}
