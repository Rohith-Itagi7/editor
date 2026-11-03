// The design panel's building blocks: number fields that scrub, segmented buttons, selects,
// swatches, and the helpers that read a value across a multi-selection ("Mixed") and write it
// as one undo step.
import { CONTROL_ICONS } from "./icons/inline.js";
import { PANEL_ICONS } from "./icons/panel.js";

export const MIXED = Symbol("mixed");

/** One value shared by every node, or MIXED. */
export function common(nodes, read) {
  const values = nodes.map(read);
  return values.every((v) => v === values[0]) ? values[0] : MIXED;
}

/** Writes to every node in one history step; `merge` folds a drag or typing into one. */
export function edit(store, nodes, label, patch, merge) {
  const ids = nodes.map((n) => n.id);
  store.transact(label, () => store.update(ids, patch), merge ? { merge: `${merge}:${ids.join(",")}` } : undefined);
}

export function setStyle(store, nodes, label, style, merge) {
  edit(store, nodes, label, { style }, merge);
}

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "style") for (const [prop, v] of Object.entries(value)) prop.startsWith("--") ? el.style.setProperty(prop, v) : (el.style[prop] = v);
    else if (key.startsWith("on")) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "html") el.innerHTML = value;
    else el.setAttribute(key, value === true ? "" : value);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

export const row = (...children) => h("div", { class: "ins-row" }, ...children);

export function parseNumber(value) {
  const match = String(value ?? "").trim().match(/^(-?\d*\.?\d+)\s*([a-z%]*)$/i);
  return match ? { n: Number(match[1]), unit: match[2] } : null;
}

const round = (n) => Math.round(n * 100) / 100;

/**
 * A number with a label to scrub: drag the label sideways, or use the arrow keys (Shift for
 * tens). `value` is a CSS string or MIXED; `onChange(css, { live })` gets the new string.
 */
export function numberField({ label, title, value, unit = "px", min, max, step = 1, onChange, placeholder, width }) {
  const input = h("input", { class: "ins-input", spellcheck: "false", "aria-label": title ?? label });
  const show = (v) => {
    input.value = v === MIXED ? "" : v == null ? "" : String(v).replace(/px$/, "");
    input.placeholder = v === MIXED ? "Mixed" : placeholder ?? "";
  };
  show(value);
  const clamp = (n) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  const toCss = (text) => {
    const trimmed = text.trim();
    if (trimmed === "") return "";
    const parsed = parseNumber(trimmed);
    if (!parsed) return trimmed;
    return `${round(clamp(parsed.n))}${parsed.unit || unit}`;
  };
  const current = () => parseNumber(input.value) ?? { n: parseNumber(placeholder)?.n ?? 0, unit: "" };
  input.addEventListener("change", () => onChange(toCss(input.value), { live: false }));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") input.blur();
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const { n, unit: u } = current();
    const next = clamp(n + (event.key === "ArrowUp" ? 1 : -1) * step * (event.shiftKey ? 10 : 1));
    input.value = `${round(next)}${u && u !== "px" ? u : ""}`;
    onChange(`${round(next)}${u || unit}`, { live: true });
  });
  const scrub = h("span", { class: "ins-scrub", title: title ?? label }, label);
  scrub.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    scrub.setPointerCapture(event.pointerId);
    const start = event.clientX;
    const { n, unit: u } = current();
    const move = (e) => {
      const next = clamp(n + Math.round((e.clientX - start) / 2) * step * (e.shiftKey ? 10 : 1));
      input.value = `${round(next)}${u && u !== "px" ? u : ""}`;
      onChange(`${round(next)}${u || unit}`, { live: true });
    };
    const up = () => {
      scrub.removeEventListener("pointermove", move);
      scrub.removeEventListener("pointerup", up);
    };
    scrub.addEventListener("pointermove", move);
    scrub.addEventListener("pointerup", up);
  });
  return h("label", { class: "ins-field", style: width ? { flex: `0 0 ${width}` } : undefined }, label != null ? scrub : null, input);
}

/** A text field that writes on change. */
export function textField({ label, value, onChange, placeholder }) {
  const input = h("input", { class: "ins-input", spellcheck: "false", "aria-label": label });
  input.value = value === MIXED ? "" : value ?? "";
  input.placeholder = value === MIXED ? "Mixed" : placeholder ?? "";
  input.addEventListener("change", () => onChange(input.value.trim()));
  input.addEventListener("keydown", (event) => event.key === "Enter" && input.blur());
  return h("label", { class: "ins-field" }, label ? h("span", { class: "ins-scrub" }, label) : null, input);
}

/** Buttons where one is on. options: [{ value, label, title }] */
export function segmented({ options, value, onChange, label }) {
  return h(
    "div",
    { class: "ins-seg", role: "radiogroup", "aria-label": label },
    options.map((option) =>
      h(
        "button",
        {
          type: "button",
          role: "radio",
          title: option.title ?? option.value,
          "aria-checked": String(value === option.value),
          onClick: () => onChange(option.value),
          html: option.icon,
        },
        option.icon ? null : option.label ?? option.value,
      ),
    ),
  );
}

export function select({ options, value, onChange, label }) {
  const el = h("select", { class: "ins-select", "aria-label": label });
  if (value === MIXED) el.append(h("option", { value: "", disabled: true, selected: true }, "Mixed"));
  for (const option of options) {
    const [v, text] = Array.isArray(option) ? option : [option, option];
    el.append(h("option", { value: v, selected: v === value }, text));
  }
  el.addEventListener("change", () => onChange(el.value));
  return el;
}

export function iconButton({ icon, title, onClick, pressed }) {
  return h("button", { type: "button", class: "ins-icon", title, "aria-label": title, "aria-pressed": pressed == null ? null : String(pressed), onClick, html: icon });
}

/** A section's title with an optional + on the right, */
export function sectionHead(body, { onAdd, addTitle, extra } = {}) {
  const head = body.parentElement?.querySelector(".section-title");
  if (!head) return;
  head.classList.add("ins-head");
  if (extra) head.append(extra);
  if (onAdd) head.append(iconButton({ icon: ICON.plus, title: addTitle ?? "Add", onClick: onAdd }));
}

export const ICON = Object.fromEntries(Object.entries(CONTROL_ICONS).map(([name, svg]) => [name, sized(svg, 16)]));

// ---------- controls: field, toggle group, ghost button, swatch field, slider ----------

/** Gives an icon its drawn size, since the icon SVGs carry only a viewBox. */
export function sized(svg, width, height = width) {
  return svg.replace("<svg ", `<svg width="${width}" height="${height}" `);
}

const SCRUB_PER_PIXEL = 0.25;
const UNITS_SHOWN = new Set(["%", "°", "em", "rem", "deg"]);
const CARET = PANEL_ICONS.chevronDown;

/** "100+20", "50*2", "-4/2": the arithmetic number fields accept. */
function evaluate(text) {
  const clean = String(text).replace(/,/g, ".").replace(/\s+/g, "");
  if (!/^[-+*/().\d]+$/.test(clean)) return null;
  try {
    const n = Function(`"use strict"; return (${clean});`)();
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Splits "12px", "0°", "100%" into the number and its unit. */
function split(value) {
  const match = String(value ?? "").trim().match(/^(-?\d*\.?\d+(?:e-?\d+)?)\s*([a-z%°]*)$/i);
  return match ? { n: Number(match[1]), unit: match[2] } : null;
}

/**
 * Locks the pointer and turns sideways motion into steps: a quarter step per pixel, ten at a
 * time with Shift. The real cursor hides while the pointer is locked, so the scrub cursor is ours: it
 * starts where the drag began, follows the motion, and wraps at the window's edges so a drag never runs out of room.
 */
function scrub(event, { onStep, onEnd }) {
  event.preventDefault();
  event.stopPropagation();
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  let carry = 0, x = event.clientX, y = event.clientY;
  const cursor = h("div", { class: "scrub-cursor" });
  const place = () => ((cursor.style.left = `${x - 16}px`), (cursor.style.top = `${y - 16}px`));
  const wrap = (value, size) => ((value % size) + size) % size;
  place();
  document.body.append(cursor);
  document.documentElement.setAttribute("data-scrubbing", "");
  const move = (e) => {
    x = wrap(x + e.movementX, innerWidth);
    y = wrap(y + e.movementY, innerHeight);
    place();
    carry += e.movementX * SCRUB_PER_PIXEL;
    const steps = carry > 0 ? Math.floor(carry) : Math.ceil(carry);
    if (!steps) return;
    carry -= steps;
    onStep(steps, e.shiftKey);
  };
  const block = (e) => (e.preventDefault(), e.stopPropagation());
  const end = () => {
    cursor.remove();
    if (document.pointerLockElement) document.exitPointerLock();
    removeEventListener("pointermove", move);
    removeEventListener("pointerup", end);
    removeEventListener("pointercancel", end);
    removeEventListener("keydown", block, true);
    document.documentElement.removeAttribute("data-scrubbing");
    document.dispatchEvent(new Event("scrubend"));
    onEnd?.();
  };
  addEventListener("pointermove", move);
  addEventListener("pointerup", end);
  addEventListener("pointercancel", end);
  addEventListener("keydown", block, true);
  try {
    document.body.requestPointerLock()?.catch?.(() => {});
  } catch {}
}

/**
 * Number field: an icon or letter to scrub, the value with its unit, arrow keys (Shift
 * for tens), arithmetic, Escape to revert, and Alt-drag over the value itself. `caret` adds the
 * small menu button on the right. `onChange(css, { live })` gets "12px", "45deg", "50%"...
 */
export function field({ icon, label, value, unit = "px", shown, min, max, step = 1, title, onChange, caret, width, placeholder, align }) {
  const showUnit = shown ?? (UNITS_SHOWN.has(unit) ? (unit === "deg" ? "°" : unit) : "");
  const input = h("input", { class: "field-control", spellcheck: "false", autocomplete: "off", "aria-label": title ?? label, "data-align": align });
  const root = h("div", { class: "field-root", title, style: width ? { flex: `0 0 ${width}px`, width: `${width}px` } : undefined });
  const clamp = (n) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  const round = (n) => Math.round(n * 100) / 100;
  let current = value === MIXED ? null : split(value)?.n ?? null;
  const render = () => {
    input.value = current == null ? (value === MIXED ? "" : value ?? "") : `${round(current)}${showUnit}`;
    input.placeholder = value === MIXED ? "Mixed" : placeholder ?? "";
  };
  const emit = (live) => onChange(`${round(current)}${unit}`, { live });
  const stepBy = (steps, large) => {
    current = clamp((current ?? split(placeholder)?.n ?? 0) + steps * step * (large ? 10 : 1));
    render();
    emit(true);
  };
  render();

  if (icon != null) {
    const svg = String(icon).startsWith("<");
    const iconEl = h("div", { class: "field-icon", "data-scrub-area": "", html: svg ? icon : null }, svg ? null : icon);
    iconEl.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      root.setAttribute("data-scrubbing", "");
      scrub(e, { onStep: stepBy, onEnd: () => root.removeAttribute("data-scrubbing") });
    });
    root.append(iconEl);
  }
  root.append(input);
  if (caret) {
    const button = h("button", { type: "button", class: "field-caret", "aria-label": caret.title, html: sized(CARET, 10) });
    button.addEventListener("click", () => caret.onClick(button));
    root.append(button);
  }

  input.addEventListener("pointerdown", (e) => e.altKey && e.button === 0 && scrub(e, { onStep: stepBy }));
  input.addEventListener("pointermove", (e) => input.toggleAttribute("data-scrubbable", e.altKey));
  input.addEventListener("pointerleave", () => input.removeAttribute("data-scrubbable"));
  input.addEventListener("focus", () => input.select());
  input.addEventListener("change", () => {
    const text = input.value.trim();
    if (text === "") return render();
    const n = evaluate(text.replace(/[a-z%°]+$/i, ""));
    if (n == null) return render();
    current = clamp(n);
    render();
    emit(false);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      input.dispatchEvent(new Event("change"));
      return input.select();
    }
    if (e.key === "Escape") return render(), input.blur();
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    stepBy(e.key === "ArrowUp" ? 1 : -1, e.shiftKey);
    input.select();
  });
  return root;
}

/** Segmented control: one pressed item on a faint track. options: [{ value, title, icon | label }] */
export function toggleGroup({ options, value, onChange, label, width }) {
  return h(
    "div",
    { class: "toggle-group-root", role: "radiogroup", "aria-label": label, style: width ? { flex: `0 0 ${width}px` } : undefined },
    options.map((option) =>
      h("button", {
        type: "button",
        class: "toggle-group-item",
        role: "radio",
        title: option.title,
        "aria-label": option.title,
        "aria-checked": String(value === option.value),
        "data-pressed": value === option.value,
        onClick: () => value !== option.value && onChange(option.value),
        html: option.icon,
      }, option.icon ? null : option.label),
    ),
  );
}

/** A 24px icon button with no fill until hovered, as in every section header. */
export function ghostButton({ icon, title, onClick, pressed, disabled }) {
  return h("button", { type: "button", class: "icon-button-ghost", title, "aria-label": title, "aria-pressed": pressed == null ? null : String(pressed), "data-pressed": pressed === true, disabled, onClick, html: icon });
}

/**
 * The fill row: a swatch that opens the picker, the hex, and the opacity at the end of the
 * same field. `color` is "#rrggbb" or MIXED; `alpha` 0-100.
 */
export function swatchField({ color, alpha = 100, onOpen, onHex, onAlpha, width }) {
  const mixed = color === MIXED;
  const shownHex = () => (mixed ? "" : color.replace("#", "").toUpperCase());
  const swatch = h("button", { type: "button", class: "field-swatch", "data-opens-picker": "", "aria-label": "Color", style: { "--swatch": mixed ? "transparent" : color, "--swatch-alpha": alpha / 100 } });
  swatch.addEventListener("click", () => onOpen?.(swatch));
  const hex = h("input", { class: "field-control", spellcheck: "false", autocomplete: "off", "aria-label": "Hex" });
  hex.value = shownHex();
  hex.placeholder = mixed ? "Mixed" : "";
  hex.addEventListener("focus", () => hex.select());
  hex.addEventListener("change", () => {
    const raw = hex.value.trim().replace(/^#/, "");
    const full = /^[0-9a-f]{3}$/i.test(raw) ? raw.replace(/./g, "$&$&") : /^[0-9a-f]{1,2}$/i.test(raw) ? raw.padStart(2, raw).repeat(3) : raw;
    if (/^[0-9a-f]{6}$/i.test(full)) onHex(`#${full.toLowerCase()}`);
    else hex.value = shownHex();
  });
  hex.addEventListener("keydown", (e) => e.key === "Enter" && hex.dispatchEvent(new Event("change")));
  const opacity = field({ value: `${Math.round(alpha)}%`, unit: "%", min: 0, max: 100, title: "Opacity", onChange: (v, meta) => onAlpha(parseFloat(v), meta) });
  opacity.classList.add("field-aside");
  return h("div", { class: "field-root field-swatch-root", style: width ? { flex: `0 0 ${width}px` } : undefined }, swatch, hex, opacity);
}

/** Slider: a 12px track, a 20×12 thumb, the filled part darker. */
export function slider({ value, min = 0, max = 100, step = 1, onChange, label }) {
  const thumb = h("div", { class: "slider-thumb", role: "slider", tabindex: "0", "aria-label": label, "aria-valuemin": min, "aria-valuemax": max });
  const indicator = h("div", { class: "slider-indicator" });
  const track = h("div", { class: "slider-track" }, indicator, thumb);
  const root = h("div", { class: "slider-root" }, h("div", { class: "slider-control" }, h("div", { class: "slider-range" }), track));
  let current = value === MIXED ? min : Number(value) || 0;
  const place = () => {
    const t = (Math.min(max, Math.max(min, current)) - min) / (max - min || 1);
    thumb.style.left = `calc(${t * 100}% - 10px)`;
    indicator.style.width = `${t * 100}%`;
    thumb.setAttribute("aria-valuenow", current);
  };
  const set = (n, live) => {
    current = Math.round(Math.min(max, Math.max(min, n)) / step) * step;
    place();
    onChange(current, { live });
  };
  root.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    root.setPointerCapture(e.pointerId);
    const at = (ev) => {
      const r = track.getBoundingClientRect();
      set(min + ((ev.clientX - r.left) / (r.width || 1)) * (max - min), true);
    };
    at(e);
    const up = () => (root.removeEventListener("pointermove", at), root.removeEventListener("pointerup", up));
    root.addEventListener("pointermove", at);
    root.addEventListener("pointerup", up);
  });
  thumb.addEventListener("keydown", (e) => {
    const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    set(current + d * step * (e.shiftKey ? 10 : 1), true);
  });
  place();
  return root;
}
