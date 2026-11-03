// Theme tokens: eleven kinds, each named by the user ("Untitled", then "Untitled 2" for another). A token is written
// out as a CSS custom property in Tailwind's namespaces, in an @theme block or in :root, and that text can be read
// back into tokens.

// The kinds in the order they are listed: the title of their section, the namespace of their variables, and the
// value a new token starts with.
export const TOKEN_TYPES = [
  { type: "color", title: "Colors", prefix: "color", fallback: "#DDDDDD" },
  { type: "opacity", title: "Opacity", prefix: "opacity", fallback: "0.6" },
  { type: "radius", title: "Radius", prefix: "radius", fallback: "4px" },
  { type: "spacing", title: "Spacing", prefix: "spacing", fallback: "16px" },
  { type: "container", title: "Container", prefix: "container", fallback: "1200px" },
  { type: "breakpoint", title: "Breakpoint", prefix: "breakpoint", fallback: "768px" },
  { type: "fontFamily", title: "Font family", prefix: "font", fallback: "Inter" },
  { type: "fontWeight", title: "Font weight", prefix: "font-weight", fallback: "400" },
  { type: "fontSize", title: "Font size", prefix: "text", fallback: "16px" },
  { type: "lineHeight", title: "Line height", prefix: "leading", fallback: "24px" },
  { type: "letterSpacing", title: "Letter spacing", prefix: "tracking", fallback: "0em" },
];
export const typeInfo = (type) => TOKEN_TYPES.find((kind) => kind.type === type);

// ---------- Names ----------
/** "Brand blue" -> "brand-blue": the part of a variable's name that comes from the token's own name. */
export const slug = (name) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "token";

/** A token's CSS custom property: --color-brand-blue. */
export const cssName = (token) => `--${typeInfo(token.type).prefix}-${slug(token.name)}`;

/** Names a token inside a CSS value: var(--color-brand). */
export const tokenRef = (token) => `var(${cssName(token)})`;

/** The variable named by "var(--x)" or "var(--x, fallback)", else null. */
export const varName = (text) => /^\s*var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)\s*$/.exec(String(text ?? ""))?.[1] ?? null;

// ---------- Writing ----------
// A font family with spaces and no quotes or commas needs quotes to be one CSS value.
const valueOf = (token) => {
  const needsQuotes = token.type === "fontFamily" && /\s/.test(token.value) && !/["',]/.test(token.value);
  return needsQuotes ? `"${token.value}"` : token.value;
};

/** The tokens as CSS text, grouped by kind: `@theme { ... }` for Tailwind, or `:root { ... }`. */
export function tokensToCss(tokens, format = "tailwind") {
  const declarations = [];
  for (const { type } of TOKEN_TYPES) {
    for (const token of tokens) if (token.type === type) declarations.push(`  ${cssName(token)}: ${valueOf(token)};`);
  }
  const head = format === "tailwind" ? "@theme" : ":root";
  return `${head} {\n${declarations.join("\n")}${declarations.length ? "\n" : ""}}\n`;
}

/** The tokens as a { --name: value } map, for element.style.setProperty. */
export const tokenVariables = (tokens) => Object.fromEntries(tokens.map((token) => [cssName(token), valueOf(token)]));

// ---------- Ordering ----------
/**
 * The tokens with those in `ids` moved within their own kind: "up" or "down" one place, or to the "top" or the
 * "bottom". Several selected tokens move as a block. The kinds stay where they were in the list.
 */
export function moveWithinKind(tokens, ids, where) {
  let result = tokens;
  for (const { type } of TOKEN_TYPES) {
    const group = result.filter((token) => token.type === type);
    const chosen = group.flatMap((token, position) => (ids.includes(token.id) ? [position] : []));
    if (!chosen.length) continue;
    const wanted = where === "top" ? 0 : where === "bottom" ? group.length : where === "up" ? chosen[0] - 1 : chosen.at(-1) + 2;
    const target = Math.max(0, Math.min(group.length, wanted));
    const others = group.filter((token) => !ids.includes(token.id));
    const slot = target - chosen.filter((position) => position < target).length;
    const reordered = [...others.slice(0, slot), ...chosen.map((position) => group[position]), ...others.slice(slot)];
    let next = 0;
    result = result.map((token) => (token.type === type ? reordered[next++] : token));
  }
  return result;
}

// ---------- Reading ----------
/**
 * The editor wires this once at startup, so the color fields and the color picker can read and make tokens without
 * knowing about the store.
 */
export const tokenHost = { tokens: () => [], createFromColor: () => null };

/** The token a CSS value points at, or null. */
export function tokenOf(text) {
  const name = varName(text);
  return name ? tokenHost.tokens().find((token) => cssName(token) === name) ?? null : null;
}

// Longest prefix first, so "--font-weight-bold" is a font weight and not a font family called "weight-bold".
const KINDS_BY_PREFIX = [...TOKEN_TYPES].sort((a, b) => b.prefix.length - a.prefix.length);

/** The kind a variable name belongs to: its prefix, and at least one character after it. */
const kindOfVariable = (variable) => KINDS_BY_PREFIX.find(({ prefix }) => variable.toLowerCase().startsWith(`--${prefix}-`) && variable.length > prefix.length + 3);

/**
 * The text of the Theme tab as tokens: `@theme { --color-brand: #16a36a; ... }` or `:root { ... }`.
 * Answers { tokens: [{ type, name, value }] }, with the kind taken from the variable's prefix and the name from the
 * rest of it ("--color-brand-blue" is a color named "brand-blue"), or { error } for text that is not one block of
 * variables. A variable written twice keeps its last value.
 */
export function parseTokensCss(text) {
  const css = String(text ?? "").replace(/\/\*[\s\S]*?\*\//g, "");
  const open = css.indexOf("{"), close = css.lastIndexOf("}");
  if (open === -1 || close < open) return { error: "Expected @theme { ... } or :root { ... }" };
  const head = css.slice(0, open), tail = css.slice(close + 1);
  if (!/^\s*(@theme(\s+\w+)*|:root)\s*$/.test(head) || tail.trim()) return { error: "Start with @theme { or :root { and end with }" };
  const body = css.slice(open + 1, close);
  if (body.includes("{")) return { error: "Nested blocks are not supported" };

  const found = new Map();
  for (const piece of body.split(";")) {
    const declaration = piece.trim();
    if (!declaration) continue;
    const parts = /^(--[\w-]+)\s*:\s*([\s\S]+)$/.exec(declaration);
    if (!parts) return { error: `Cannot read "${declaration.slice(0, 40)}"` };
    const [, variable, rawValue] = parts;
    let value = rawValue.trim();
    if (/(^|\s)--[\w-]+\s*:/.test(value)) return { error: `Missing ";" after ${variable}` };
    const kind = kindOfVariable(variable);
    if (!kind) return { error: `${variable}: unknown kind (start with ${TOKEN_TYPES.map((t) => `--${t.prefix}-`).join(", ")})` };
    if (kind.type === "fontFamily" && /^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    const token = { type: kind.type, name: variable.slice(kind.prefix.length + 3), value };
    found.set(cssName(token), token);
  }
  return { tokens: [...found.values()] };
}
