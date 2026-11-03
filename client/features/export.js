// Turning nodes into things that leave the editor: Tailwind classes, React with inline styles, and a PNG drawn
// from what the canvas shows. The panel section that offers them is panels/inspector/export.js.
import { fourSides, parseColor, splitTop } from "../core/style-values.js";

// ---------- Tailwind ----------

const kebab = (prop) => prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).replace(/^webkit/, "-webkit");
const arb = (value) => String(value).trim().replace(/\s*,\s*/g, ",").replace(/\s+/g, "_");
const px = (value) => (/^-?\d*\.?\d+px$/.test(value) ? parseFloat(value) : null);

/** Tailwind's spacing scale where a value lands on it (4px steps), an arbitrary value otherwise. */
function space(prefix, value) {
  const n = px(value);
  if (n === 0) return `${prefix}-0`;
  if (n != null && n % 2 === 0 && n > 0) return `${prefix}-${n / 4}`;
  return `${prefix}-[${arb(value)}]`;
}

function sides(prefixes, text) {
  const [t, r, b, l] = fourSides(text);
  const [all, x, y, top, right, bottom, left] = prefixes;
  if (t === r && r === b && b === l) return [space(all, t)];
  if (t === b && r === l) return [space(x, r), space(y, t)];
  return [space(top, t), space(right, r), space(bottom, b), space(left, l)];
}

const WEIGHT = { 100: "thin", 200: "extralight", 300: "light", 400: "normal", 500: "medium", 600: "semibold", 700: "bold", 800: "extrabold", 900: "black" };
const JUSTIFY = { "flex-start": "start", start: "start", center: "center", "flex-end": "end", end: "end", "space-between": "between", "space-around": "around", "space-evenly": "evenly" };
const ITEMS = { "flex-start": "start", start: "start", center: "center", "flex-end": "end", end: "end", stretch: "stretch", baseline: "baseline" };
const color = (prefix, value) => `${prefix}-[${arb(value)}]`;

function sizeClass(prefix, value) {
  if (value === "100%") return `${prefix}-full`;
  if (value === "fit-content") return `${prefix}-fit`;
  if (value === "auto") return `${prefix}-auto`;
  return `${prefix}-[${arb(value)}]`;
}

function borderClasses(value, side = "") {
  const parts = value.split(/\s+(?![^(]*\))/);
  const width = parts.find((p) => /^\d/.test(p)) ?? "1px";
  const style = parts.find((p) => ["dashed", "dotted", "double"].includes(p));
  const c = parts.find((p) => parseColor(p) && !/^\d/.test(p));
  const s = side ? `-${side}` : "";
  return [px(width) === 1 ? `border${s}` : `border${s}-[${width}]`, style && `border-${style}`, c && color(`border${s}`, c)];
}

export function tailwindClasses(style) {
  const out = [];
  for (const [prop, value] of Object.entries(style)) {
    if (value == null || value === "") continue;
    switch (prop) {
      case "width": out.push(sizeClass("w", value)); break;
      case "height": out.push(sizeClass("h", value)); break;
      case "minWidth": out.push(sizeClass("min-w", value)); break;
      case "maxWidth": out.push(sizeClass("max-w", value)); break;
      case "display": out.push(value === "flex" ? "flex" : value === "none" ? "hidden" : value === "grid" ? "grid" : value === "block" ? "block" : `[display:${value}]`); break;
      case "flexDirection": if (value !== "row") out.push(value === "column" ? "flex-col" : `flex-${value}`); break;
      case "flexWrap": if (value === "wrap") out.push("flex-wrap"); break;
      case "justifyContent": out.push(`justify-${JUSTIFY[value] ?? `[${value}]`}`); break;
      case "alignItems": out.push(`items-${ITEMS[value] ?? `[${value}]`}`); break;
      case "alignSelf": out.push(`self-${ITEMS[value] ?? `[${value}]`}`); break;
      case "flex": out.push(/^1( 1 0(px|%)?)?$/.test(value) ? "flex-1" : `flex-[${arb(value)}]`); break;
      case "flexGrow": out.push(value === "1" ? "grow" : `grow-[${value}]`); break;
      case "gap": out.push(space("gap", value)); break;
      case "padding": out.push(...sides(["p", "px", "py", "pt", "pr", "pb", "pl"], value)); break;
      case "margin": if (value !== "0" && value !== "0px") out.push(...sides(["m", "mx", "my", "mt", "mr", "mb", "ml"], value)); break;
      case "background": {
        const layers = splitTop(value);
        if (layers.length === 1 && parseColor(value)) out.push(value === "transparent" ? "bg-transparent" : color("bg", value));
        else out.push(`bg-[${arb(value)}]`);
        break;
      }
      case "backgroundColor": out.push(color("bg", value)); break;
      case "backgroundBlendMode": out.push(`bg-blend-${value.split(",")[0].trim()}`); break;
      case "color": out.push(value === "transparent" ? "text-transparent" : color("text", value)); break;
      case "backgroundClip": case "WebkitBackgroundClip": if (value === "text" && !out.includes("bg-clip-text")) out.push("bg-clip-text"); break;
      case "fontFamily": out.push(`font-['${value.split(",")[0].replace(/["']/g, "").trim().replace(/\s+/g, "_")}']`); break;
      case "fontSize": out.push(`text-[${value}]`); break;
      case "fontWeight": out.push(`font-${WEIGHT[value] ?? `[${value}]`}`); break;
      case "fontStyle": if (value === "italic") out.push("italic"); break;
      case "lineHeight": out.push(`leading-[${arb(value)}]`); break;
      case "letterSpacing": if (parseFloat(value) !== 0) out.push(`tracking-[${value}]`); break;
      case "textAlign": out.push(`text-${value}`); break;
      case "textTransform": out.push(value === "none" ? "normal-case" : value); break;
      case "textWrap": out.push(`text-${value}`); break;
      case "whiteSpace": out.push(`whitespace-${value}`); break;
      case "textDecorationLine": out.push(value === "line-through" ? "line-through" : value); break;
      case "textDecorationStyle": out.push(`decoration-${value}`); break;
      case "textUnderlineOffset": out.push(`underline-offset-[${value}]`); break;
      case "borderRadius": {
        const [tl, tr, br, bl] = fourSides(value);
        if (tl === tr && tr === br && br === bl) out.push(value === "9999px" ? "rounded-full" : `rounded-[${tl}]`);
        else out.push(`rounded-tl-[${tl}]`, `rounded-tr-[${tr}]`, `rounded-br-[${br}]`, `rounded-bl-[${bl}]`);
        break;
      }
      case "border": out.push(...borderClasses(value)); break;
      case "borderTop": out.push(...borderClasses(value, "t")); break;
      case "borderRight": out.push(...borderClasses(value, "r")); break;
      case "borderBottom": out.push(...borderClasses(value, "b")); break;
      case "borderLeft": out.push(...borderClasses(value, "l")); break;
      case "outline": out.push(...borderClasses(value).map((c) => c?.replace(/^border/, "outline"))); break;
      case "outlineOffset": out.push(`outline-offset-[${value}]`); break;
      case "boxShadow": out.push(`shadow-[${arb(value)}]`); break;
      case "textShadow": out.push(`[text-shadow:${arb(value)}]`); break;
      case "opacity": out.push(`opacity-[${value}]`); break;
      case "mixBlendMode": out.push(`mix-blend-${value}`); break;
      case "overflow": out.push(`overflow-${value}`); break;
      case "transform": {
        const deg = value.match(/rotate\((-?[\d.]+)deg\)/)?.[1];
        out.push(deg && value.trim() === `rotate(${deg}deg)` ? `rotate-[${deg}deg]` : `[transform:${arb(value)}]`);
        break;
      }
      case "position": out.push(value); break;
      case "left": case "top": case "right": case "bottom": out.push(`${prop}-[${value}]`); break;
      default: out.push(`[${kebab(prop)}:${arb(value)}]`);
    }
  }
  return out.filter(Boolean);
}

// ---------- JSX ----------

const jsxText = (text) => String(text).replace(/[{}<>]/g, (c) => `{"${c}"}`);
const tagOf = (node) => (node.component === "Text" ? "p" : "div");

function toJsx(store, node, depth, attrs) {
  const pad = "  ".repeat(depth);
  const kids = store.children(node.id).filter((c) => !c.hidden);
  // A layer's name rides along as a comment, except on the top element, where JSX allows none.
  const comment = depth > 2 && node.name && node.name !== node.text ? `${pad}{/* ${node.name.replace(/\*\//g, "")} */}\n` : "";
  const open = `<${tagOf(node)} ${attrs(node)}`;
  if (!kids.length && node.text == null) return `${comment}${pad}${open} />`;
  if (!kids.length) return `${comment}${pad}${open}>${jsxText(node.text)}</${tagOf(node)}>`;
  const inner = [node.text != null ? `${pad}  ${jsxText(node.text)}` : null, ...kids.map((c) => toJsx(store, c, depth + 1, attrs))].filter(Boolean);
  return `${comment}${pad}${open}>\n${inner.join("\n")}\n${pad}</${tagOf(node)}>`;
}

/** The JSX of one node and its descendants, as get_jsx gives it: inline styles or Tailwind classes, with the node's ID as an id when asked. */
export function jsxOf(store, node, { format = "inline-styles", includeNodeIds = true, includeRootPositioning = false } = {}) {
  const POSITION = new Set(["position", "top", "left", "right", "bottom"]);
  const styleOf = (n) => (n.id === node.id && !includeRootPositioning ? Object.fromEntries(Object.entries(n.style).filter(([k]) => !POSITION.has(k))) : n.style);
  const attrs = (n) => {
    const id = includeNodeIds ? `id="${n.id}" ` : "";
    if (format === "tailwind") return `${id}className="${tailwindClasses(styleOf(n)).join(" ")}"`;
    const entries = Object.entries(styleOf(n)).filter(([, v]) => v != null && v !== "");
    return `${id}style={{ ${entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ")} }}`;
  };
  return toJsx(store, node, 0, attrs);
}

const componentName = (name) => (name.replace(/[^a-z0-9]+(.)?/gi, (_, c) => (c ? c.toUpperCase() : "")).replace(/^./, (c) => c.toUpperCase()) || "Component").replace(/^\d/, "C$&");

export function asTailwind(store, nodes) {
  const attrs = (node) => `className="${tailwindClasses(node.style).join(" ")}"`;
  const body = nodes.map((n) => toJsx(store, n, 2, attrs)).join("\n");
  return `export function ${componentName(nodes[0].name)}() {\n  return (\n${nodes.length > 1 ? `    <>\n${body.replace(/^/gm, "  ")}\n    </>` : body}\n  );\n}\n`;
}

export function asReactCss(store, nodes) {
  const attrs = (node) => {
    const entries = Object.entries(node.style).filter(([, v]) => v != null && v !== "");
    return `style={{ ${entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ")} }}`;
  };
  const body = nodes.map((n) => toJsx(store, n, 2, attrs)).join("\n");
  return `export function ${componentName(nodes[0].name)}() {\n  return (\n${nodes.length > 1 ? `    <>\n${body.replace(/^/gm, "  ")}\n    </>` : body}\n  );\n}\n`;
}

// ---------- PNG ----------

// A picture is drawn apart from the page, so it cannot use the page's Google fonts: the latin part of each
// is fetched once and put into the picture as data. (System fonts need nothing.)
const GOOGLE_FONTS = document.querySelector('link[href^="https://fonts.googleapis.com/css2"]')?.href;
let embedded = null;
function embeddedFonts() {
  if (!GOOGLE_FONTS) return Promise.resolve("");
  embedded ??= (async () => {
    const css = await (await fetch(GOOGLE_FONTS)).text();
    const faces = [...css.matchAll(/\/\* latin \*\/\s*(@font-face\s*\{[^}]*\})/g)].map((m) => m[1]);
    const inline = (blob) => new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob); });
    return (await Promise.all(faces.map(async (face) => {
      const href = /url\(([^)]+)\)/.exec(face)?.[1];
      return href ? face.replace(href, await inline(await (await fetch(href)).blob())) : "";
    }))).join("\n");
  })().catch(() => { embedded = null; return ""; }); // offline: the picture falls back, as the page does
  return embedded;
}

/** The node as the canvas draws it, at `scale`, as a PNG blob. */
export async function nodePng(node, scale = 2) {
  const el = document.querySelector(`.canvas [data-node-id="${CSS.escape(node.id)}"]`);
  if (!el) throw new Error("The node is not on the canvas.");
  const width = el.offsetWidth, height = el.offsetHeight;
  const clone = el.cloneNode(true);
  Object.assign(clone.style, { position: "static", left: "0", top: "0", margin: "0", transform: node.style.transform ?? "" });
  clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  const html = new XMLSerializer().serializeToString(clone);
  // The theme tokens live on the canvas's world element (canvas.js); the picture is drawn apart from it, so they come along.
  const world = el.closest(".world") ?? el.parentElement;
  const tokens = [...(world?.style ?? [])].filter((name) => name.startsWith("--")).map((name) => `${name}:${world.style.getPropertyValue(name)}`).join(";");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><style>${await embeddedFonts()} * { box-sizing: border-box; }</style><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="font-family: system-ui; width:${width}px; height:${height}px; ${tokens}">${html}</div></foreignObject></svg>`;
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const canvas = Object.assign(document.createElement("canvas"), { width: width * scale, height: height * scale });
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.drawImage(image, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The PNG could not be made."))), "image/png"));
}
