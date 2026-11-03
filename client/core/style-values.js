// Reading and writing the CSS the nodes keep: colors in every format the picker offers,
// shorthands split into sides, shadow lists, gradients and stacked backgrounds.

import { tokenOf, varName } from "./tokens.js";

// ---------- Colors ----------
// A color is { r, g, b, a }, sRGB channels from 0 to 1.

const clamp01 = (n) => Math.min(1, Math.max(0, n));
const ctx = document.createElement("canvas").getContext("2d");

export function parseColor(text) {
  if (text == null) return null;
  const s = String(text).trim().toLowerCase();
  if (!s || s === "none") return null;
  // A token's color: follow the variable to its value, or to the fallback written in var().
  if (varName(s)) {
    const token = tokenOf(s);
    if (token) return parseColor(token.value);
    const fallback = /,\s*(.+)\)\s*$/.exec(s)?.[1];
    return fallback ? parseColor(fallback) : null;
  }
  if (s === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let hex = m[1];
    if (hex.length <= 4) hex = [...hex].map((c) => c + c).join("");
    const n = (i) => parseInt(hex.slice(i, i + 2), 16) / 255;
    return { r: n(0), g: n(2), b: n(4), a: hex.length === 8 ? n(6) : 1 };
  }
  m = s.match(/^(rgba?|hsla?|oklch)\((.*)\)$/);
  if (m) {
    const parts = m[2].replace(/,/g, " ").replace("/", " / ").split(/\s+/).filter(Boolean);
    const slash = parts.indexOf("/");
    const channels = slash >= 0 ? parts.slice(0, slash) : parts.slice(0, 3);
    const alphaText = slash >= 0 ? parts[slash + 1] : parts[3];
    const a = alphaText == null ? 1 : alphaText.endsWith("%") ? parseFloat(alphaText) / 100 : parseFloat(alphaText);
    const num = (v, scale) => (v.endsWith("%") ? (parseFloat(v) / 100) * scale : parseFloat(v));
    if (m[1].startsWith("rgb")) return { r: num(channels[0], 255) / 255, g: num(channels[1], 255) / 255, b: num(channels[2], 255) / 255, a };
    if (m[1].startsWith("hsl")) return { ...hslToRgb(parseFloat(channels[0]), num(channels[1], 100) / 100, num(channels[2], 100) / 100), a };
    const l = channels[0].endsWith("%") ? parseFloat(channels[0]) / 100 : parseFloat(channels[0]);
    const c = channels[1].endsWith("%") ? (parseFloat(channels[1]) / 100) * 0.4 : parseFloat(channels[1]);
    return { ...oklchToRgb(l, c, parseFloat(channels[2]) || 0), a };
  }
  // Named colors and anything else the browser knows.
  ctx.fillStyle = "#010203";
  ctx.fillStyle = s;
  return ctx.fillStyle === "#010203" && s !== "#010203" ? null : parseColor(ctx.fillStyle);
}

export function hslToRgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return { r: f(0), g: f(8), b: f(4) };
}

export function rgbToHsl({ r, g, b }) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

export function rgbToHsv({ r, g, b }) {
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  const h = !d ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}

export function hsvToRgb(h, s, v) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return { r: f(5), g: f(3), b: f(1) };
}

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function rgbToOklch({ r, g, b }) {
  const [lr, lg, lb] = [r, g, b].map(toLinear);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.hypot(A, B), h: (Math.atan2(B, A) * 180) / Math.PI + (B < 0 ? 360 : 0) };
}

export function oklchToRgb(L, C, H) {
  const A = C * Math.cos((H * Math.PI) / 180), B = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return {
    r: clamp01(toGamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    g: clamp01(toGamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    b: clamp01(toGamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
  };
}

const hex2 = (n) => Math.round(clamp01(n) * 255).toString(16).padStart(2, "0");
const r1 = (n, d = 1) => Number(n.toFixed(d));

export function formatColor(color, format = "hex") {
  const { r, g, b, a = 1 } = color;
  const alpha = a < 1 ? ` / ${r1(a, 2)}` : "";
  if (format === "rgb") return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)}${alpha})`;
  if (format === "hsl") {
    const { h, s, l } = rgbToHsl(color);
    return `hsl(${r1(h)} ${r1(s * 100)}% ${r1(l * 100)}%${alpha})`;
  }
  if (format === "oklch") {
    const { l, c, h } = rgbToOklch(color);
    return `oklch(${r1(l * 100)}% ${r1(c, 3)} ${r1(c < 0.0005 ? 0 : h)}${alpha})`;
  }
  return `#${hex2(r)}${hex2(g)}${hex2(b)}${a < 1 ? hex2(a) : ""}`;
}

/** The format a string is written in, so an edit keeps it. */
export function formatOf(text) {
  const s = String(text ?? "").trim().toLowerCase();
  if (s.startsWith("rgb")) return "rgb";
  if (s.startsWith("hsl")) return "hsl";
  if (s.startsWith("oklch")) return "oklch";
  return "hex";
}

export const COLOR_RE = /#[0-9a-f]{3,8}\b|(?:rgba?|hsla?|oklch)\([^()]*\)/gi;

// ---------- Lists and shorthands ----------

/** Splits on commas (or spaces) that are not inside parentheses. */
export function splitTop(text, separator = ",") {
  const out = [];
  let depth = 0, start = 0;
  const s = String(text ?? "");
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") depth--;
    else if (depth === 0 && (separator === " " ? /\s/.test(s[i]) : s[i] === separator)) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out.map((p) => p.trim()).filter(Boolean);
}

/** padding / border-radius shorthand to four values: top right bottom left (or tl tr br bl). */
export function fourSides(text) {
  const p = splitTop(text, " ");
  if (!p.length) return ["0px", "0px", "0px", "0px"];
  const [a, b = a, c = a, d = b] = p;
  return [a, b, c, d];
}

export function joinSides([a, b, c, d]) {
  if (a === b && b === c && c === d) return a;
  if (a === c && b === d) return `${a} ${b}`;
  return `${a} ${b} ${c} ${d}`;
}

// ---------- Shadows ----------
// { inset, x, y, blur, spread, color }

export function parseShadows(text) {
  if (!text || text === "none") return [];
  return splitTop(text).map((part) => {
    const tokens = splitTop(part, " ");
    const shadow = { inset: false, x: "0px", y: "0px", blur: "0px", spread: "0px", color: "#000000" };
    const lengths = [];
    for (const token of tokens) {
      if (token === "inset") shadow.inset = true;
      else if (/^-?\d*\.?\d+[a-z]*$/i.test(token)) lengths.push(/^-?\d*\.?\d+$/.test(token) ? `${token}px` : token);
      else shadow.color = token;
    }
    [shadow.x = "0px", shadow.y = "0px", shadow.blur = "0px", shadow.spread = "0px"] = lengths;
    return shadow;
  });
}

export function formatShadows(list, { spread = true } = {}) {
  if (!list.length) return "";
  return list.map((s) => [s.inset && "inset", s.x, s.y, s.blur, spread && s.spread, s.color].filter(Boolean).join(" ")).join(", ");
}

/** A stroke is kept as an inset, zero-blur shadow first in box-shadow: inside, over the fill. */
export const isStroke = (s) => s.inset && parseFloat(s.x) === 0 && parseFloat(s.y) === 0 && parseFloat(s.blur) === 0 && parseFloat(s.spread) > 0;

// ---------- Fills: background layers ----------
// { type: "solid", color } | { type: "gradient", kind, angle, stops: [{ color, at }] }
//   | { type: "image", url, size }   plus { blend } per layer.

export function parseGradient(text) {
  const m = String(text).match(/^(repeating-)?(linear|radial|conic)-gradient\((.*)\)$/is);
  if (!m) return null;
  const kind = m[2];
  const parts = splitTop(m[3]);
  let angle = kind === "linear" ? 180 : 0;
  let shape = kind === "radial" ? "circle" : undefined;
  const first = parts[0] ?? "";
  if (kind === "linear" && /deg|turn|^to /.test(first)) {
    angle = first.startsWith("to ") ? { "to top": 0, "to right": 90, "to bottom": 180, "to left": 270 }[first] ?? 180 : parseFloat(first) * (first.endsWith("turn") ? 360 : 1);
    parts.shift();
  } else if (kind === "conic" && first.startsWith("from")) {
    angle = parseFloat(first.slice(4)) || 0;
    parts.shift();
  } else if (kind === "radial" && !parseColor(splitTop(first, " ")[0])) {
    shape = first;
    parts.shift();
  }
  const stops = parts.map((part, index) => {
    const tokens = splitTop(part, " ");
    const color = tokens[0];
    const at = tokens[1] != null ? parseFloat(tokens[1]) : (index / Math.max(1, parts.length - 1)) * 100;
    return { color, at };
  });
  return { type: "gradient", kind, angle, shape, stops };
}

export function formatGradient(g) {
  const stops = [...g.stops].sort((a, b) => a.at - b.at).map((s) => `${s.color} ${Math.round(s.at * 10) / 10}%`).join(", ");
  if (g.kind === "radial") return `radial-gradient(${g.shape ?? "circle"}, ${stops})`;
  if (g.kind === "conic") return `conic-gradient(from ${Math.round(g.angle)}deg, ${stops})`;
  return `linear-gradient(${Math.round(g.angle)}deg, ${stops})`;
}

/** Background layers, top first. */
export function readFills(style) {
  const text = style.background ?? [style.backgroundImage, style.backgroundColor].filter((v) => v && v !== "none").join(", ");
  const blends = splitTop(style.backgroundBlendMode ?? "");
  return splitTop(text).map((layer, index) => {
    const blend = blends[index] ?? "normal";
    const gradient = parseGradient(layer);
    if (gradient) {
      const solid = gradient.kind === "linear" && gradient.stops.length === 2 && gradient.stops[0].color === gradient.stops[1].color;
      return solid ? { type: "solid", color: gradient.stops[0].color, blend } : { ...gradient, blend };
    }
    const url = layer.match(/url\((['"]?)(.*?)\1\)/);
    if (url) return { type: "image", url: url[2], size: /contain/.test(layer) ? "contain" : /repeat(?!-)/.test(layer) && !/no-repeat/.test(layer) ? "tile" : "cover", blend };
    return { type: "solid", color: layer, blend };
  }).filter((fill) => !(fill.type === "solid" && fill.color === "transparent"));
}

/** Style that draws `fills`; CSS only lets the bottom layer be a plain color. */
export function writeFills(fills) {
  if (!fills.length) return { background: "transparent", backgroundBlendMode: undefined, backgroundColor: undefined, backgroundImage: undefined };
  const layers = fills.map((fill, index) => {
    if (fill.type === "gradient") return formatGradient(fill);
    if (fill.type === "image") {
      const size = fill.size === "tile" ? "auto repeat" : `${fill.size ?? "cover"} no-repeat`;
      const [s, repeat] = size.split(" ");
      return `url("${fill.url}") center / ${s} ${repeat}`;
    }
    return index === fills.length - 1 ? fill.color : `linear-gradient(${fill.color}, ${fill.color})`;
  });
  const blends = fills.map((f) => f.blend ?? "normal");
  return {
    background: layers.join(", "),
    backgroundBlendMode: blends.every((b) => b === "normal") ? undefined : blends.join(", "),
    backgroundColor: undefined,
    backgroundImage: undefined,
  };
}

/** A small preview of a fill, for a swatch. */
export function fillPreview(fill) {
  if (fill.type === "gradient") return formatGradient({ ...fill, kind: fill.kind === "conic" ? "conic" : fill.kind });
  if (fill.type === "image") return `url("${fill.url}") center / cover`;
  return `linear-gradient(${fill.color}, ${fill.color})`;
}

export const BLEND_MODES = ["normal", "darken", "multiply", "color-burn", "lighten", "screen", "plus-lighter", "color-dodge", "overlay", "soft-light", "hard-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"];
