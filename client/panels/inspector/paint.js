// Everything that paints a node: Fill, then
// Outline, Border, Stroke, Shadow, Inner shadow and Selection colors. A section with nothing set
// is a gray title with a +; once set, each row ends with an eye to hide it and a minus.
import { registerSection } from "../../core/sections.js";
import { MIXED, common, edit, h, field, toggleGroup, ghostButton, sized } from "../../ui/controls.js";
import { COLOR_RE, formatGradient, formatShadows, parseColor, parseShadows, readFills, writeFills, formatColor } from "../../core/style-values.js";
import { TEXT_ICONS, colorLine, openPopup } from "./text.js";
import { PANEL_ICONS } from "../../ui/icons/panel.js";
import { MISC_ICONS } from "../../ui/icons/inline.js";

const PLUS = () => sized(PANEL_ICONS.plus, 16);
const MINUS = () => sized(PANEL_ICONS.minus, 16);
const EYE = () => sized(PANEL_ICONS.eye, 16);
const sameJSON = (nodes, read) => common(nodes, (n) => JSON.stringify(read(n)));
const headOf = (body) => body.parentElement.querySelector(".section-title");
const empty = (body) => body.append(h("p", { class: "ins-empty" }));
const mixedRow = (label, onClick) => h("button", { type: "button", class: "sec-mixed", onClick }, `Click to replace mixed ${label}`);

/** A row's eye and minus, on the right. */
const trailing = ({ hidden, onToggle, onRemove, label }) => [
  h("span", { class: "sec-grow" }),
  ghostButton({ icon: EYE(), title: hidden ? `Show ${label}` : `Hide ${label}`, pressed: hidden, onClick: onToggle }),
  ghostButton({ icon: MINUS(), title: `Remove ${label}`, onClick: onRemove }),
];

// ---------- Hiding: a hidden property is kept aside on the node, out of its style ----------

const hiddenOf = (node, prop) => node.hiddenStyle?.[prop];
function hideProps(store, nodes, props, label) {
  const hidden = nodes.every((n) => props.some((p) => hiddenOf(n, p) != null));
  edit(store, nodes, hidden ? `Show ${label}` : `Hide ${label}`, (n) => {
    const aside = { ...n.hiddenStyle };
    const style = {};
    for (const p of props) {
      if (hidden) {
        if (aside[p] != null) style[p] = aside[p];
        delete aside[p];
      } else if (n.style[p] != null) {
        aside[p] = n.style[p];
        style[p] = undefined;
      }
    }
    return { style, hiddenStyle: Object.keys(aside).length ? aside : undefined };
  });
}
const valueOf = (node, prop) => node.style[prop] ?? hiddenOf(node, prop);
const isHidden = (nodes, prop) => common(nodes, (n) => hiddenOf(n, prop) != null) === true;

// ---------- Fill ----------
// Text is filled with its color (or a gradient clipped to the glyphs); everything else with
// its background layers. A hidden fill has no CSS, so the list is kept on the node beside the
// style it produced, and read back while that style is unchanged.

const fillKey = (n, style = n.style) =>
  JSON.stringify(n.component === "Text" ? [style.color, style.background, style.WebkitBackgroundClip] : [style.background, style.backgroundColor, style.backgroundImage, style.backgroundBlendMode]);

function parseFillsOf(n) {
  if (n.component !== "Text") return readFills(n.style);
  if (n.style.WebkitBackgroundClip === "text" || n.style.backgroundClip === "text") return readFills(n.style);
  return n.style.color ? [{ type: "solid", color: n.style.color, blend: "normal" }] : [];
}
const fillsOf = (n) => (n.fillState?.key === fillKey(n) ? structuredClone(n.fillState.list) : parseFillsOf(n));

function fillStyle(node, shown) {
  if (node.component !== "Text") return writeFills(shown);
  const clear = { background: undefined, backgroundClip: undefined, WebkitBackgroundClip: undefined };
  if (!shown.length) return { ...clear, color: undefined };
  if (shown.length === 1 && shown[0].type === "solid") return { ...clear, color: shown[0].color };
  return { ...writeFills(shown), color: "transparent", backgroundClip: "text", WebkitBackgroundClip: "text" };
}

function writeNodeFills(node, fills) {
  const style = fillStyle(node, fills.filter((f) => !f.hidden));
  const merged = { ...node.style, ...style };
  for (const [k, v] of Object.entries(style)) if (v === undefined) delete merged[k];
  return { style, fillState: fills.some((f) => f.hidden) ? { key: fillKey(node, merged), list: fills } : undefined };
}

const FILL_TYPES = () => [
  { value: "solid", title: "Solid", icon: `<span class="sec-type sec-type-solid"></span>` },
  { value: "gradient", title: "Gradient", icon: `<span class="sec-type sec-type-gradient"></span>` },
  { value: "image", title: "Image", icon: sized(TEXT_ICONS.imageTab, 16) },
];

// The stop picked on each node's gradient, so a redraw keeps it.
const pickedStop = new Map();

function switchType(fill, type) {
  const base = fill.type === "solid" ? fill.color : fill.type === "gradient" ? fill.stops[0].color : "#d9d9d9";
  if (type === "solid") return { type, color: base, blend: fill.blend, hidden: fill.hidden };
  if (type === "gradient") return { type, kind: "linear", angle: 90, stops: [{ color: base, at: 0 }, { color: "#bebebe", at: 100 }], blend: fill.blend, hidden: fill.hidden };
  return { type, url: "", size: "cover", blend: fill.blend, hidden: fill.hidden };
}

function fillBlock({ fill, index, node, store, kinds, onChange, onRemove }) {
  const set = (next, live) => onChange(next, live);
  const block = h("div", { class: "sec-fill", "data-hidden": fill.hidden || null });
  const head = h("div", { class: "sec-line" },
    toggleGroup({ label: "Fill type", options: FILL_TYPES().filter((t) => kinds.includes(t.value)), value: fill.type, width: kinds.length * 29, onChange: (t) => set(switchType(fill, t), false) }),
    h("span", { class: "sec-grow" }),
    fill.type === "gradient" ? ghostButton({ icon: sized(TEXT_ICONS.rotate90, 16), title: "Rotate 90°", onClick: () => set({ ...fill, angle: ((fill.angle ?? 180) + 90) % 360 }, false) }) : null,
    ghostButton({ icon: EYE(), title: fill.hidden ? "Show fill" : "Hide fill", pressed: !!fill.hidden, onClick: () => set({ ...fill, hidden: !fill.hidden || undefined }, false) }),
    ghostButton({ icon: MINUS(), title: "Remove fill", onClick: onRemove }),
  );
  block.append(head);
  if (fill.type === "solid") block.append(colorLine({ value: fill.color, store, onChange: (color, live) => set({ ...fill, color }, live) }));
  if (fill.type === "gradient") block.append(...gradientRows({ fill, index, node, store, set }));
  if (fill.type === "image") block.append(imageRow({ fill, set }));
  return block;
}

function gradientRows({ fill, index, node, store, set }) {
  const key = `${node.id}:${index}`;
  const picked = Math.min(pickedStop.get(key) ?? 0, fill.stops.length - 1);
  const stopsCss = [...fill.stops].sort((a, b) => a.at - b.at).map((s) => `${s.color} ${s.at}%`).join(", ");
  const bar = h("div", { class: "sec-grad-bar", style: { "--grad": `linear-gradient(90deg, ${stopsCss})` } });
  fill.stops.forEach((stop, i) => {
    const knob = h("button", { type: "button", class: "sec-grad-stop", title: `Stop ${i + 1}`, "aria-pressed": String(i === picked), style: { left: `${stop.at}%`, "--c": stop.color } });
    knob.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      pickedStop.set(key, i);
      knob.setPointerCapture(e.pointerId);
      const rect = bar.getBoundingClientRect();
      let moved = false;
      const move = (ev) => {
        moved = true;
        const at = Math.round(Math.min(100, Math.max(0, ((ev.clientX - rect.left) / rect.width) * 100)));
        knob.style.left = `${at}%`;
        set({ ...fill, stops: fill.stops.map((s, j) => (j === i ? { ...s, at } : s)) }, true);
      };
      const up = () => {
        knob.removeEventListener("pointermove", move);
        knob.removeEventListener("pointerup", up);
        if (!moved) set({ ...fill }, false);
      };
      knob.addEventListener("pointermove", move);
      knob.addEventListener("pointerup", up);
    });
    bar.append(knob);
  });
  // A press on the bar adds a stop there, in the picked stop's color.
  bar.addEventListener("pointerdown", (e) => {
    if (e.target !== bar) return;
    const rect = bar.getBoundingClientRect();
    const at = Math.round(((e.clientX - rect.left) / rect.width) * 100);
    pickedStop.set(key, fill.stops.length);
    set({ ...fill, stops: [...fill.stops, { color: fill.stops[picked].color, at }] }, false);
  });

  const kind = h("select", { class: "field-control", "aria-label": "Gradient type" },
    ...[["linear", "Linear"], ["radial", "Radial"], ["conic", "Conic"]].map(([v, label]) => h("option", { value: v, selected: v === fill.kind }, label)));
  kind.addEventListener("change", () => set({ ...fill, kind: kind.value }, false));
  const settings = ghostButton({ icon: sized(TEXT_ICONS.textSettings, 16), title: "Gradient settings" });
  settings.dataset.opensPopup = "";
  settings.addEventListener("click", () =>
    openPopup(settings, {
      title: "Gradient",
      width: 240,
      content: [
        h("div", { class: "sec-popup-row" }, h("label", {}, "Angle"), field({ icon: sized(PANEL_ICONS.angle, 16), title: "Angle", value: `${Math.round(fill.angle ?? 180)}°`, unit: "deg", width: 80, onChange: (v, { live }) => set({ ...fill, angle: parseFloat(v) || 0 }, live) })),
        h("div", { class: "sec-popup-row" }, h("label", {}, "Stops"), h("button", { type: "button", class: "sec-popup-action", onClick: () => set({ ...fill, stops: fill.stops.map((s) => ({ ...s, at: 100 - s.at })) }, false) }, "Flip")),
      ],
    }));
  const typeRow = h("div", { class: "sec-line" },
    h("div", { class: "field-root sec-select" }, h("div", { class: "field-icon sec-grad-icon", style: { "--grad": formatGradient({ ...fill, kind: "linear", angle: 90 }) } }), kind, h("span", { class: "field-caret", html: sized(PANEL_ICONS.chevronDown, 10) })),
    settings,
    ghostButton({ icon: PLUS(), title: "Add stop", onClick: () => (pickedStop.set(key, fill.stops.length), set({ ...fill, stops: [...fill.stops, { color: fill.stops[picked].color, at: 50 }] }, false)) }),
  );
  const stopRows = fill.stops.map((stop, i) => {
    const row = colorLine({
      value: stop.color,
      store,
      onChange: (color, live) => set({ ...fill, stops: fill.stops.map((s, j) => (j === i ? { ...s, color } : s)) }, live),
      trailing: ghostButton({ icon: MINUS(), title: "Remove stop", disabled: fill.stops.length <= 2, onClick: () => set({ ...fill, stops: fill.stops.filter((_, j) => j !== i) }, false) }),
    });
    row.classList.toggle("sec-stop-picked", i === picked);
    row.addEventListener("pointerdown", () => pickedStop.set(key, i), true);
    return row;
  });
  return [bar, typeRow, ...stopRows];
}

function imageRow({ fill, set }) {
  const upload = h("input", { type: "file", accept: "image/*", hidden: true });
  upload.addEventListener("change", () => {
    const file = upload.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => set({ ...fill, url: reader.result, name: file.name }, false);
    reader.readAsDataURL(file);
  });
  const thumb = h("button", { type: "button", class: "sec-image-thumb", title: "Choose an image", style: { backgroundImage: fill.url ? `url("${fill.url}")` : "none" }, onClick: () => upload.click() });
  const dims = h("span", { class: "sec-image-dims" }, fill.url ? "" : "No image");
  if (fill.url) {
    const img = new Image();
    img.onload = () => (dims.textContent = `${img.naturalWidth}×${img.naturalHeight}`);
    img.src = fill.url;
  }
  const size = h("select", { class: "sec-image-size", "aria-label": "Image size" },
    ...[["cover", "Fill"], ["contain", "Fit"], ["tile", "Tile"]].map(([v, label]) => h("option", { value: v, selected: v === fill.size }, label)));
  size.addEventListener("change", () => set({ ...fill, size: size.value }, false));
  const name = fill.name ?? (fill.url && !fill.url.startsWith("data:") ? fill.url.split("/").pop() : "Image");
  return h("div", { class: "sec-image" }, thumb, h("div", { class: "sec-image-text" }, h("span", { class: "truncate" }, name), dims), size, upload);
}

registerSection({
  id: "fill",
  title: "Fill",
  order: 40,
  appliesTo: (nodes) => nodes.every((n) => n.component !== "Vector"),
  render(body, nodes, store) {
    const same = sameJSON(nodes, fillsOf);
    const fills = fillsOf(nodes[0]);
    const save = (next, live, key) => edit(store, nodes, "Fill", (n) => writeNodeFills(n, next), live && key);
    const isText = nodes[0].component === "Text";
    headOf(body).append(ghostButton({ icon: PLUS(), title: "Add fill", onClick: () => save([{ type: "solid", color: isText ? "#000000" : "#ffffff", blend: "normal" }, ...(same === MIXED ? [] : fills)], false) }));
    if (same === MIXED) return body.append(mixedRow("fills", () => save(fills, false)));
    if (!fills.length) return empty(body);
    fills.forEach((fill, index) =>
      body.append(
        fillBlock({
          fill,
          index,
          node: nodes[0],
          store,
          kinds: ["solid", "gradient", "image"],
          onChange: (next, live) => save(fills.map((f, i) => (i === index ? next : f)), live, `fill${index}`),
          onRemove: () => save(fills.filter((_, i) => i !== index), false),
        }),
      ),
    );
  },
});

// ---------- Outline ----------

function readLine(text) {
  if (!text || text === "none") return null;
  const parts = text.split(/\s+(?![^(]*\))/);
  const styles = ["solid", "dashed", "dotted", "double"];
  return {
    width: parts.find((p) => /^\d/.test(p)) ?? "1px",
    style: parts.find((p) => styles.includes(p)) ?? "solid",
    color: parts.find((p) => !/^\d/.test(p) && !styles.includes(p)) ?? "#000000",
  };
}
const lineCss = (l) => `${l.width} ${l.style} ${l.color}`;
const LINE_STYLES = [["solid", "Solid"], ["dashed", "Dashed"], ["dotted", "Dotted"]];

function styleSelect(value, onChange) {
  const select = h("select", { class: "field-control", "aria-label": "Style" }, ...LINE_STYLES.map(([v, label]) => h("option", { value: v, selected: v === value }, label)));
  select.addEventListener("change", () => onChange(select.value));
  return h("div", { class: "field-root sec-select", style: { flex: "0 0 100px" } }, select, h("span", { class: "field-caret", html: sized(PANEL_ICONS.chevronDown, 10) }));
}

registerSection({
  id: "outline",
  title: "Outline",
  order: 42,
  appliesTo: (nodes) => nodes.every((n) => (n.text == null || n.component !== "Text") && n.component !== "Vector"),
  render(body, nodes, store) {
    const read = (n) => {
      const l = readLine(valueOf(n, "outline"));
      return l && { ...l, offset: valueOf(n, "outlineOffset") ?? "0px" };
    };
    const same = sameJSON(nodes, read);
    const outline = read(nodes[0]);
    const hidden = isHidden(nodes, "outline");
    const save = (next, live, key) =>
      edit(store, nodes, "Outline", (n) => {
        const style = next ? { outline: lineCss(next), outlineOffset: next.offset === "0px" ? undefined : next.offset } : { outline: undefined, outlineOffset: undefined };
        if (hiddenOf(n, "outline") == null) return { style };
        return { hiddenStyle: { ...n.hiddenStyle, outline: style.outline, outlineOffset: style.outlineOffset } };
      }, live && key);
    if (same === MIXED) return body.append(mixedRow("outlines", () => save(outline, false)));
    if (!outline) {
      headOf(body).append(ghostButton({ icon: PLUS(), title: "Add outline", onClick: () => save({ width: "1px", style: "solid", color: "#000000", offset: "0px" }, false) }));
      return empty(body);
    }
    body.append(
      h("div", { class: "sec-line" },
        field({ icon: sized(TEXT_ICONS.thickness, 16), title: "Width", value: `${parseFloat(outline.width)}`, min: 0, width: 100, onChange: (v, { live }) => save({ ...outline, width: v }, live, "ow") }),
        field({ icon: sized(TEXT_ICONS.offset, 16), title: "Offset", value: `${parseFloat(outline.offset)}`, width: 100, onChange: (v, { live }) => save({ ...outline, offset: v }, live, "oo") }),
        ...trailing({ hidden, label: "outline", onToggle: () => hideProps(store, nodes, ["outline", "outlineOffset"], "outline"), onRemove: () => save(null, false) }),
      ),
      colorLine({ value: outline.color, store, onChange: (color, live) => save({ ...outline, color }, live, "oc") }),
    );
  },
});

// ---------- Border: width, style and sides ----------

const SIDES = ["Top", "Right", "Bottom", "Left"];
function readBorder(n) {
  const side = SIDES.find((s) => valueOf(n, `border${s}`));
  const l = readLine(side ? valueOf(n, `border${side}`) : valueOf(n, "border"));
  return l && { ...l, side: side ?? "all" };
}
function borderStyle(border) {
  const clear = { border: undefined, borderTop: undefined, borderRight: undefined, borderBottom: undefined, borderLeft: undefined, borderWidth: undefined, borderStyle: undefined, borderColor: undefined };
  return border ? { ...clear, [border.side === "all" ? "border" : `border${border.side}`]: lineCss(border) } : clear;
}

registerSection({
  id: "border",
  title: "Border",
  order: 43,
  appliesTo: (nodes) => nodes.every((n) => n.component !== "Text" && n.component !== "Vector"),
  render(body, nodes, store) {
    const same = sameJSON(nodes, readBorder);
    const border = readBorder(nodes[0]);
    const props = ["border", ...SIDES.map((s) => `border${s}`)];
    const hidden = common(nodes, (n) => props.some((p) => hiddenOf(n, p) != null)) === true;
    const save = (next, live, key) =>
      edit(store, nodes, "Border", (n) => {
        const style = borderStyle(next);
        if (!props.some((p) => hiddenOf(n, p) != null)) return { style };
        const aside = { ...n.hiddenStyle };
        for (const p of props) aside[p] = style[p];
        return { hiddenStyle: aside };
      }, live && key);
    if (same === MIXED) return body.append(mixedRow("borders", () => save(border, false)));
    if (!border) {
      headOf(body).append(ghostButton({ icon: PLUS(), title: "Add border", onClick: () => save({ side: "all", width: "1px", style: "solid", color: "#000000" }, false) }));
      return empty(body);
    }
    body.append(
      h("div", { class: "sec-line" },
        field({ icon: sized(TEXT_ICONS.thickness, 16), title: "Width", value: `${parseFloat(border.width)}`, min: 0, width: 100, onChange: (v, { live }) => save({ ...border, width: v }, live, "bw") }),
        styleSelect(border.style, (v) => save({ ...border, style: v }, false)),
        ...trailing({ hidden, label: "border", onToggle: () => hideProps(store, nodes, props, "border"), onRemove: () => save(null, false) }),
      ),
      colorLine({ value: border.color, store, onChange: (color, live) => save({ ...border, color }, live, "bc") }),
      toggleGroup({
        label: "Sides",
        options: [["all", "All"], ...SIDES.map((s) => [s, s])].map(([value, label]) => ({ value, label, title: value === "all" ? "All sides" : `${label} only` })),
        value: border.side,
        onChange: (side) => save({ ...border, side }, false),
      }),
    );
  },
});

// ---------- Stroke: the outline of text's glyphs ----------

registerSection({
  id: "stroke",
  title: "Stroke",
  order: 44,
  appliesTo: (nodes) => nodes.every((n) => n.component === "Text"),
  render(body, nodes, store) {
    const read = (n) => {
      const text = valueOf(n, "WebkitTextStroke");
      if (!text) return null;
      const [width = "1px", ...rest] = text.split(/\s+(?![^(]*\))/);
      return { width, color: rest.join(" ") || "#000000", under: valueOf(n, "paintOrder") === "stroke fill" };
    };
    const same = sameJSON(nodes, read);
    const stroke = read(nodes[0]);
    const hidden = isHidden(nodes, "WebkitTextStroke");
    const save = (next, live, key) =>
      edit(store, nodes, "Stroke", () => ({ hiddenStyle: undefined, style: next ? { WebkitTextStroke: `${next.width} ${next.color}`, paintOrder: next.under ? "stroke fill" : undefined } : { WebkitTextStroke: undefined, paintOrder: undefined } }), live && key);
    if (same === MIXED) return body.append(mixedRow("strokes", () => save(stroke, false)));
    if (!stroke) {
      headOf(body).append(ghostButton({ icon: PLUS(), title: "Add stroke", onClick: () => save({ width: "1px", color: "#000000", under: false }, false) }));
      return empty(body);
    }
    body.append(
      h("div", { class: "sec-line" },
        field({ icon: sized(TEXT_ICONS.thickness, 16), title: "Width", value: `${parseFloat(stroke.width)}`, min: 0, step: 0.5, width: 100, onChange: (v, { live }) => save({ ...stroke, width: v }, live, "sw") }),
        toggleGroup({ label: "Stroke position", width: 100, options: [{ value: "over", label: "Over", title: "Over the fill" }, { value: "under", label: "Under", title: "Under the fill" }], value: stroke.under ? "under" : "over", onChange: (v) => save({ ...stroke, under: v === "under" }, false) }),
        ...trailing({ hidden, label: "stroke", onToggle: () => hideProps(store, nodes, ["WebkitTextStroke", "paintOrder"], "stroke"), onRemove: () => save(null, false) }),
      ),
      colorLine({ value: stroke.color, store, onChange: (color, live) => save({ ...stroke, color }, live, "sc") }),
    );
  },
});

// ---------- Shadow and Inner shadow ----------

function shadowSection({ id, title, order, inner }) {
  registerSection({
    id,
    title,
    order,
    appliesTo: (nodes) => nodes.every((n) => n.component !== "Vector") && (!inner || nodes.every((n) => n.component !== "Text")) && (nodes.every((n) => n.component === "Text") || nodes.every((n) => n.component !== "Text")),
    render(body, nodes, store) {
      const text = nodes[0].component === "Text";
      const prop = text ? "textShadow" : "boxShadow";
      const all = (n) => parseShadows(valueOf(n, prop));
      const mine = (n) => all(n).filter((s) => !!s.inset === inner);
      const same = sameJSON(nodes, mine);
      const list = mine(nodes[0]);
      const hidden = isHidden(nodes, prop);
      // The other kind of shadow shares the property, so it is kept as it is.
      const save = (next, live, key) =>
        edit(store, nodes, title, (n) => {
          const css = formatShadows([...all(n).filter((s) => !!s.inset !== inner), ...next], { spread: !text }) || undefined;
          return hiddenOf(n, prop) != null ? { hiddenStyle: { ...n.hiddenStyle, [prop]: css } } : { style: { [prop]: css } };
        }, live && key);
      const fresh = { inset: inner, x: "0px", y: inner ? "2px" : "4px", blur: inner ? "4px" : "12px", spread: "0px", color: inner ? "#00000026" : "#00000040" };
      headOf(body).append(ghostButton({ icon: PLUS(), title: `Add ${title.toLowerCase()}`, onClick: () => save([...(same === MIXED ? [] : list), fresh], false) }));
      if (same === MIXED) return body.append(mixedRow(title.toLowerCase(), () => save(list, false)));
      if (!list.length) return empty(body);
      list.forEach((shadow, index) => {
        const put = (patch, live, key) => save(list.map((s, i) => (i === index ? { ...s, ...patch } : s)), live, `${key}${index}`);
        body.append(
          h("div", { class: "sec-shadow" },
            h("div", { class: "p-row" },
              field({ icon: "X", title: "X", value: `${parseFloat(shadow.x)}`, onChange: (v, { live }) => put({ x: v }, live, "x") }),
              field({ icon: "Y", title: "Y", value: `${parseFloat(shadow.y)}`, onChange: (v, { live }) => put({ y: v }, live, "y") }),
              field({ icon: "B", title: "Blur", value: `${parseFloat(shadow.blur)}`, min: 0, onChange: (v, { live }) => put({ blur: v }, live, "blur") }),
            ),
            h("div", { class: "sec-line" },
              text ? h("span") : field({ icon: "S", title: "Spread", value: `${parseFloat(shadow.spread)}`, width: 80, onChange: (v, { live }) => put({ spread: v }, live, "spread") }),
              ...trailing({ hidden, label: title.toLowerCase(), onToggle: () => hideProps(store, nodes, [prop], title.toLowerCase()), onRemove: () => save(list.filter((_, i) => i !== index), false) }),
            ),
            colorLine({ value: shadow.color, store, onChange: (color, live) => put({ color }, live, "color") }),
          ),
        );
      });
    },
  });
}
shadowSection({ id: "shadows", title: "Shadow", order: 45, inner: false });
shadowSection({ id: "inner-shadows", title: "Inner shadow", order: 46, inner: true });

// ---------- Selection colors: every color in the selection, to change at once ----------

registerSection({
  id: "selection-colors",
  title: "Selection colors",
  order: 80,
  appliesTo: (nodes, store) => nodes.length > 1 || store.children(nodes[0].id).length > 0,
  render(body, nodes, store) {
    const tree = [...new Set(nodes.flatMap((n) => store.subtree(n.id)))].filter(Boolean);
    const found = new Map();
    for (const node of tree) {
      for (const value of Object.values(node.style)) {
        for (const match of String(value).match(COLOR_RE) ?? []) {
          const c = parseColor(match);
          if (!c) continue;
          const key = formatColor(c);
          if (!found.has(key)) found.set(key, { spellings: new Set(), nodes: new Set() });
          found.get(key).spellings.add(match);
          found.get(key).nodes.add(node.id);
        }
      }
    }
    if (!found.size) return empty(body);
    for (const [key, { spellings, nodes: users }] of found) {
      const replace = (color, live) =>
        store.transact("Replace color", () => {
          for (const node of tree) {
            const style = {};
            for (const [prop, value] of Object.entries(node.style)) {
              let next = String(value);
              for (const spelling of spellings) next = next.split(spelling).join(color);
              if (next !== value) style[prop] = next;
            }
            if (Object.keys(style).length) store.updateStyle(node.id, style);
          }
          spellings.clear();
          spellings.add(color);
        }, live ? { merge: `colors:${key}` } : undefined);
      // The count selects the layers that use the color.
      const count = h("button", { type: "button", class: "sec-color-count", title: "Select the layers using this color", onClick: () => store.select([...users]) },
        h("span", { html: sized(MISC_ICONS.radiusTarget, 16) }), String(users.size));
      body.append(colorLine({ value: key, store, onChange: replace, trailing: count }));
    }
  },
});
