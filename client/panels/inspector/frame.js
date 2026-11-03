// Layout, Flex, Radius and Blending: the size and box of a node, as the top of the panel.
import { registerSection } from "../../core/sections.js";
import { MIXED, common, edit, setStyle, h, row, select, sectionHead, parseNumber, field, ghostButton, slider, sized, toggleGroup } from "../../ui/controls.js";
import { BLEND_MODES, fourSides, joinSides } from "../../core/style-values.js";
import { PANEL_ICONS } from "../../ui/icons/panel.js";
import { MISC_ICONS } from "../../ui/icons/inline.js";
import { FRAME_PRESETS } from "./frame-presets.js";

const domOf = (id) => document.querySelector(`.canvas [data-node-id="${CSS.escape(id)}"]`);
const measured = (node, axis) => {
  const el = domOf(node.id);
  return el ? Math.round(axis === "width" ? el.offsetWidth : el.offsetHeight) : parseNumber(node.style[axis])?.n ?? 0;
};

// ---------- Frame: size mode, size, position, rotation ----------

function parentFlex(store, node) {
  const parent = node.parent != null ? store.get(node.parent) : null;
  if (!parent || parent.style.display !== "flex") return null;
  return parent.style.flexDirection === "column" ? "column" : "row";
}

function sizeMode(store, node, axis) {
  const s = node.style;
  const value = s[axis];
  const direction = parentFlex(store, node);
  const main = direction && (direction === "row") === (axis === "width");
  if (main && (parseFloat(s.flexGrow) >= 1 || /^\s*[1-9]/.test(s.flex ?? ""))) return "Fill";
  if (direction && !main && s.alignSelf === "stretch") return "Fill";
  if (value === "100%") return "Fill";
  if (value?.endsWith("%")) return "Relative";
  if (!value || value === "auto" || value === "fit-content" || value === "max-content") return "Fit";
  return "Fixed";
}

function setSizeMode(store, nodes, axis, mode) {
  edit(store, nodes, `${axis === "width" ? "Width" : "Height"}: ${mode}`, (node) => {
    const direction = parentFlex(store, node);
    const main = direction && (direction === "row") === (axis === "width");
    const size = measured(node, axis);
    const clearMain = main ? { flex: undefined, flexGrow: undefined, flexBasis: undefined } : {};
    const clearCross = direction && !main ? { alignSelf: undefined } : {};
    if (mode === "Fixed") return { style: { ...clearMain, ...clearCross, [axis]: `${size}px` } };
    if (mode === "Fit") return { style: { ...clearMain, ...clearCross, [axis]: "fit-content" } };
    if (mode === "Relative") {
      const parent = domOf(node.parent);
      const of = parent ? (axis === "width" ? parent.clientWidth : parent.clientHeight) : size;
      return { style: { ...clearMain, ...clearCross, [axis]: `${Math.round((size / (of || 1)) * 100)}%` } };
    }
    if (main) return { style: { [axis]: undefined, flex: "1 1 0px" } };
    if (direction) return { style: { [axis]: undefined, alignSelf: "stretch" } };
    return { style: { [axis]: "100%" } };
  });
}

// Rotation and flips live together in `transform`, written back in one order.
function transformOf(node) {
  const t = node.style.transform ?? "";
  return {
    rotate: Number(t.match(/rotate\((-?[\d.]+)deg\)/)?.[1] ?? 0),
    flipX: /scaleX\(-1\)/.test(t),
    flipY: /scaleY\(-1\)/.test(t),
    rest: t.replace(/\s*(rotate\([^)]*\)|scaleX\(-1\)|scaleY\(-1\))/g, "").trim(),
  };
}
function writeTransform({ rotate, flipX, flipY, rest }) {
  const deg = ((rotate % 360) + 360) % 360;
  return [rest, deg ? `rotate(${Math.round(deg * 100) / 100}deg)` : "", flipX ? "scaleX(-1)" : "", flipY ? "scaleY(-1)" : ""].filter(Boolean).join(" ") || undefined;
}
const rotationOf = (node) => transformOf(node).rotate;

/** Where a node sits on its artboard, in document pixels, which is what X and Y show. */
function positionOf(store, node) {
  if (node.parent == null) return { x: node.x ?? 0, y: node.y ?? 0 };
  let root = node;
  while (root.parent != null) root = store.get(root.parent);
  const el = domOf(node.id);
  const rootEl = domOf(root.id);
  if (!el || !rootEl) return { x: 0, y: 0 };
  const zoom = store.ui.zoom || 1;
  const a = el.getBoundingClientRect();
  const b = rootEl.getBoundingClientRect();
  return { x: Math.round((a.left - b.left) / zoom), y: Math.round((a.top - b.top) / zoom) };
}

/** Moves along one axis: an artboard by its place on the canvas, a child by a relative offset. */
function moveTo(store, nodes, axis, value, live) {
  edit(store, nodes, "Move", (n) => {
    if (n.parent == null) return { [axis]: value };
    const side = axis === "x" ? "left" : "top";
    const delta = value - positionOf(store, n)[axis];
    return { style: { position: "relative", [side]: `${(parseFloat(n.style[side]) || 0) + delta}px` } };
  }, live && `move-${axis}`);
}

let sizeMenu = null;
function closeSizeMenu() {
  sizeMenu?.remove();
  sizeMenu = null;
}
document.addEventListener("pointerdown", (e) => sizeMenu && !sizeMenu.contains(e.target) && !e.target.closest?.(".field-caret, .p-title-menu") && closeSizeMenu());

/** The Layout title's menu on frames: the preset groups, each opening its sizes to the left. */
function openPresetMenu(anchor, onPick) {
  closeSizeMenu();
  const sub = h("div", { class: "p-menu p-submenu", role: "menu", hidden: true });
  const groups = FRAME_PRESETS.map((group) => {
    const row = h("button", { type: "button", role: "menuitem", "aria-haspopup": "menu" }, h("span", { class: "p-menu-check" }), group.label, h("span", { class: "p-menu-more", html: sized(PANEL_ICONS.chevronRight, 10) }));
    row.addEventListener("pointerenter", () => {
      sub.replaceChildren(...group.presets.map((p) => h("button", { type: "button", role: "menuitem", onClick: () => (closeSizeMenu(), onPick(p)) }, p.label, h("span", { class: "p-menu-caption" }, `${p.width} × ${p.height}`))));
      sub.hidden = false;
      const r = row.getBoundingClientRect();
      sub.style.top = `${r.top - 4}px`;
      sub.style.left = `${sizeMenu.getBoundingClientRect().left - sub.offsetWidth - 4}px`;
    });
    return row;
  });
  sizeMenu = h("div", { class: "p-menu", role: "menu" }, h("div", { class: "p-menu-label" }, "Frame"), ...groups, sub);
  document.body.append(sizeMenu);
  const r = anchor.getBoundingClientRect();
  sizeMenu.style.left = `${Math.max(8, r.left + r.width / 2 - sizeMenu.offsetWidth / 2)}px`;
  sizeMenu.style.top = `${r.bottom + 12}px`;
}


// A frame with children or a text can hug its
// content, and anything in a flex parent can fill it, unless it already does on both axes.
const canFit = (store, n) => (n.component === "Text" || (n.component === "Frame" && store.children(n.id).length > 0)) && ["width", "height"].some((axis) => sizeMode(store, n, axis) !== "Fit");
const canFill = (store, n) => parentFlex(store, n) != null && ["width", "height"].some((axis) => sizeMode(store, n, axis) !== "Fill");

function resizeAll(store, nodes, label, mode) {
  store.transact(label, () => ["width", "height"].forEach((axis) => setSizeMode(store, nodes, axis, mode)));
}

/** Hotkeys for the Layout header buttons: Alt Shift Mod R to fit, F to fill. */
export function bindLayoutHotkeys(store) {
  addEventListener("keydown", (e) => {
    if (!(e.altKey && e.shiftKey && (e.metaKey || e.ctrlKey))) return;
    const nodes = store.selectedNodes();
    const fit = nodes.filter((n) => canFit(store, n));
    const fill = nodes.filter((n) => canFill(store, n));
    if (e.code === "KeyR" && fit.length) {
      e.preventDefault();
      resizeAll(store, fit, "Resize to fit", "Fit");
    }
    if (e.code === "KeyF" && fill.length) {
      e.preventDefault();
      resizeAll(store, fill, "Resize to fill", "Fill");
    }
  });
}
document.addEventListener("keydown", (e) => e.key === "Escape" && closeSizeMenu());

/** The W and H caret: Fixed, Fit or Fill, with the current one checked. */
function openSizeMenu(anchor, current, onPick) {
  closeSizeMenu();
  const items = [["Fixed", "Fixed"], ["Fit", "Fit content"], ["Fill", "Fill container"], ["Relative", "Relative %"]];
  sizeMenu = h("div", { class: "p-menu", role: "menu" },
    items.map(([mode, label]) => h("button", { type: "button", role: "menuitemradio", "aria-checked": String(mode === current), onClick: () => (closeSizeMenu(), onPick(mode)) },
      h("span", { class: "p-menu-check", html: mode === current ? sized(PANEL_ICONS.check, 12) : "" }), label)),
  );
  document.body.append(sizeMenu);
  const r = anchor.closest(".field-root").getBoundingClientRect();
  sizeMenu.style.left = `${r.left}px`;
  sizeMenu.style.top = `${r.bottom + 4}px`;
}

registerSection({
  id: "frame",
  title: "Layout",
  order: 10,
  appliesTo: () => true,
  render(body, nodes, store) {
    const positions = nodes.map((n) => positionOf(store, n));
    const at = (axis) => common(positions, (p) => String(p[axis]));
    const head = body.parentElement.querySelector(".section-title");
    if (nodes.every((n) => n.component === "Frame")) {
      const menu = h("button", { type: "button", class: "p-title-menu", "aria-haspopup": "menu" }, "Layout", h("span", { html: sized(PANEL_ICONS.chevronDown, 10) }));
      menu.addEventListener("click", () => openPresetMenu(menu, (p) => setStyle(store, nodes, p.label, { width: `${p.width}px`, height: `${p.height}px` })));
      head.querySelector("span").replaceChildren(menu);
    }
    const fit = nodes.filter((n) => canFit(store, n));
    const fill = nodes.filter((n) => canFill(store, n));
    if (fit.length) head.append(ghostButton({ icon: sized(MISC_ICONS.resizeToFit, 16), title: "Resize to fit (Alt Shift Mod R)", onClick: () => resizeAll(store, fit, "Resize to fit", "Fit") }));
    if (fill.length) head.append(ghostButton({ icon: sized(MISC_ICONS.resizeToFill, 16), title: "Resize to fill (Alt Shift Mod F)", onClick: () => resizeAll(store, fill, "Resize to fill", "Fill") }));

    const transforms = nodes.map(transformOf);
    const setTransform = (label, change, live) => edit(store, nodes, label, (n) => ({ style: { transform: writeTransform(change(transformOf(n))) } }), live && "transform");

    body.append(
      h("div", { class: "p-row" },
        field({ icon: "X", title: "X", value: at("x"), unit: "", onChange: (v, { live }) => moveTo(store, nodes, "x", parseFloat(v) || 0, live) }),
        field({ icon: "Y", title: "Y", value: at("y"), unit: "", onChange: (v, { live }) => moveTo(store, nodes, "y", parseFloat(v) || 0, live) }),
        field({ icon: sized(PANEL_ICONS.angle, 16), title: "Rotation", value: common(transforms, (t) => `${t.rotate}deg`), unit: "deg", onChange: (v, { live }) => setTransform("Rotate", (t) => ({ ...t, rotate: parseFloat(v) || 0 }), live) }),
      ),
    );

    const sizeFields = ["width", "height"].map((axis) => {
      const mode = common(nodes, (n) => sizeMode(store, n, axis));
      const px = common(nodes, (n) => `${measured(n, axis)}`);
      const shown = mode === "Fit" || mode === "Fill" ? mode : mode === "Relative" ? common(nodes, (n) => n.style[axis]) : px;
      return field({
        icon: axis === "width" ? "W" : "H",
        title: axis === "width" ? "Width" : "Height",
        value: shown,
        unit: mode === "Relative" ? "%" : "px",
        placeholder: px === MIXED ? "" : px,
        min: 0,
        caret: { title: `${axis === "width" ? "Width" : "Height"} settings`, onClick: (anchor) => openSizeMenu(anchor, mode, (m) => setSizeMode(store, nodes, axis, m)) },
        onChange: (v, { live }) => setStyle(store, nodes, "Resize", mode === "Fixed" || mode === "Relative" ? { [axis]: v } : { [axis]: v, flex: undefined, flexGrow: undefined, alignSelf: undefined }, live && axis),
      });
    });
    const flipped = (key) => common(transforms, (t) => t[key]) === true;
    body.append(
      h("div", { class: "p-row" },
        ...sizeFields,
        h("div", { class: "p-buttons" },
          h("button", { type: "button", title: "Rotate 90°", "aria-label": "Rotate 90°", html: sized(PANEL_ICONS.rotate, 16), onClick: () => setTransform("Rotate 90°", (t) => ({ ...t, rotate: t.rotate + 90 })) }),
          h("button", { type: "button", title: "Flip horizontal (Shift H)", "aria-label": "Flip horizontal", "aria-pressed": String(flipped("flipX")), html: sized(PANEL_ICONS.flipH, 16), onClick: () => setTransform("Flip horizontal", (t) => ({ ...t, flipX: !t.flipX })) }),
          h("button", { type: "button", title: "Flip vertical (Shift V)", "aria-label": "Flip vertical", "aria-pressed": String(flipped("flipY")), html: sized(PANEL_ICONS.flipV, 16), style: { transform: "rotate(90deg)" }, onClick: () => setTransform("Flip vertical", (t) => ({ ...t, flipY: !t.flipY })) }),
        ),
      ),
    );

    // A frame gains flex from its Flex section; anything else is wrapped in a new flex frame.
    if (nodes.every((n) => n.component !== "Frame")) {
      const wrapInFlex = () => store.transact("Wrap in flex", () => {
        const first = nodes[0];
        const index = store.children(first.parent).findIndex((n) => n.id === first.id);
        const frame = store.insert({ component: "Frame", name: "Frame", style: { display: "flex", flexDirection: "column", gap: "8px" }, ...(first.parent == null ? { x: first.x, y: first.y } : {}) }, { parent: first.parent, index });
        nodes.forEach((n) => store.move(n.id, { parent: frame }));
        store.select(frame);
      });
      body.append(h("button", { type: "button", class: "p-wide-button", onClick: wrapInFlex }, "Wrap in flex", h("span", { class: "p-hotkey" }, "⇧A")));
    }

    // Clip content comes last in the Flex block; without flex it closes Layout instead.
    if (nodes.every((n) => n.component === "Frame") && !nodes.every(isFlex)) body.append(clipToggle(store, nodes));
  },
});

function clipToggle(store, nodes) {
  const clip = common(nodes, (n) => n.style.overflow === "hidden");
  return h("label", { class: "p-check" },
    h("input", { type: "checkbox", checked: clip === true, onChange: (e) => setStyle(store, nodes, "Clip content", { overflow: e.target.checked ? "hidden" : undefined }) }),
    "Clip content", h("span", { class: "p-hotkey" }, "⌥C"),
  );
}

// ---------- Layout: flex direction, alignment grid, wrap, gap, padding ----------

const isFlex = (n) => n.style.display === "flex" || n.style.display === "inline-flex";
const ALIGN = ["flex-start", "center", "flex-end"];
const alignIndex = (v) => Math.max(0, ALIGN.indexOf(v === "start" ? "flex-start" : v === "end" ? "flex-end" : v ?? "flex-start"));

registerSection({
  id: "layout",
  title: "Flex",
  order: 20,
  appliesTo: (nodes) => nodes.every((n) => n.component === "Frame"),
  render(body, nodes, store) {
    const flex = nodes.every(isFlex);
    if (!flex) {
      sectionHead(body, { onAdd: () => setStyle(store, nodes, "Add flex layout", { display: "flex", flexDirection: "row", gap: "8px" }), addTitle: "Add flex layout (Shift A)" });
      body.append(h("p", { class: "ins-empty" }, nodes.some(isFlex) ? "Mixed layouts" : "Children are placed freely"));
      return;
    }
    sectionHead(body, {
      extra: ghostButton({ icon: sized(PANEL_ICONS.minus, 16), title: "Remove flex (Alt Shift A)", onClick: () => setStyle(store, nodes, "Remove flex", { display: undefined, flexDirection: undefined, flexWrap: undefined, justifyContent: undefined, alignItems: undefined, gap: undefined }) }),
    });
    const direction = common(nodes, (n) => (n.style.flexDirection === "column" ? "column" : "row"));
    const wrap = common(nodes, (n) => n.style.flexWrap === "wrap");
    const between = common(nodes, (n) => n.style.justifyContent === "space-between");

    // The 3×3 grid: rows are the vertical position, columns the horizontal, whatever the direction.
    const first = nodes[0].style;
    const vertical = direction === "column" ? alignIndex(first.justifyContent) : alignIndex(first.alignItems);
    const horizontal = direction === "column" ? alignIndex(first.alignItems) : alignIndex(first.justifyContent);
    const grid = h("div", { class: "p-align", role: "grid", "aria-label": "Alignment", "data-direction": direction === "column" ? "column" : "row" });
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const on = r === vertical && (between === true || c === horizontal);
        grid.append(
          h("button", {
            type: "button",
            title: `${["Top", "Middle", "Bottom"][r]} ${["left", "center", "right"][c]}`,
            "aria-pressed": String(on),
            onClick: () => {
              // With space between, only the cross axis can move.
              const cross = direction === "column" ? ALIGN[c] : ALIGN[r];
              const style = between === true ? { alignItems: cross } : direction === "column" ? { justifyContent: ALIGN[r], alignItems: ALIGN[c] } : { justifyContent: ALIGN[c], alignItems: ALIGN[r] };
              setStyle(store, nodes, "Align", style);
            },
          }, on ? h("span", { class: "p-align-bars" }, h("i"), h("i"), h("i")) : h("i")),
        );
      }
    }

    const gap = field({ icon: sized(PANEL_ICONS.gap, 16), title: "Gap", value: between === true ? "Auto" : common(nodes, (n) => n.style.gap ?? "0px"), placeholder: "0", min: 0, onChange: (v, { live }) => setStyle(store, nodes, "Gap", between === true ? { gap: v, justifyContent: undefined } : { gap: v }, live && "gap") });
    body.append(
      h("div", { class: "p-flex" },
        grid,
        h("div", { class: "p-flex-side" },
          h("div", { class: "p-row" },
            toggleGroup({
              label: "Direction",
              value: direction,
              // Vertical is listed first, since the horizontal arrow is turned a quarter.
              options: [{ value: "column", title: "Vertical", icon: `<span style="display:grid;rotate:90deg">${sized(PANEL_ICONS.flexRight, 16)}</span>` }, { value: "row", title: "Horizontal", icon: sized(PANEL_ICONS.flexRight, 16) }],
              onChange: (v) => setStyle(store, nodes, "Direction", { flexDirection: v }),
            }),
            ghostButton({ icon: sized(PANEL_ICONS.wrap, 16), title: "Wrap", pressed: wrap === true, onClick: () => setStyle(store, nodes, "Wrap", { flexWrap: wrap === true ? undefined : "wrap" }) }),
          ),
          h("div", { class: "p-row" },
            gap,
            ghostButton({ icon: sized(PANEL_ICONS.flexSettings, 16), title: between === true ? "Fixed gap" : "Space between", pressed: between === true, onClick: () => setStyle(store, nodes, "Space between", { justifyContent: between === true ? undefined : "space-between" }) }),
          ),
        ),
      ),
      paddingFields(nodes, store),
      clipToggle(store, nodes),
    );
  },
});

let paddingPerSide = false;
function paddingFields(nodes, store) {
  const sides = nodes.map((n) => fourSides(n.style.padding ?? "0px"));
  const side = (i) => common(sides, (s) => s[i]);
  const write = (fn, live, key) =>
    edit(store, nodes, "Padding", (n) => {
      const next = fourSides(n.style.padding ?? "0px");
      fn(next);
      return { style: { padding: joinSides(next) === "0px" ? undefined : joinSides(next) } };
    }, live && key);
  const wrap = h("div", { class: "p-padding" });
  const toggle = ghostButton({ icon: sized(PANEL_ICONS.paddingSides, 16), title: "Padding per side", pressed: paddingPerSide, onClick: () => ((paddingPerSide = !paddingPerSide), wrap.replaceWith(paddingFields(nodes, store))) });
  if (!paddingPerSide) {
    const horizontal = side(1) === side(3) ? side(1) : MIXED;
    const vertical = side(0) === side(2) ? side(0) : MIXED;
    wrap.append(h("div", { class: "p-row p-pair" },
      field({ icon: sized(PANEL_ICONS.paddingH, 16), title: "Horizontal padding", value: horizontal, min: 0, onChange: (v, { live }) => write((p) => (p[1] = p[3] = v), live, "ph") }),
      field({ icon: sized(PANEL_ICONS.paddingV, 16), title: "Vertical padding", value: vertical, min: 0, onChange: (v, { live }) => write((p) => (p[0] = p[2] = v), live, "pv") }),
      toggle,
    ));
  } else {
    const names = ["Top", "Right", "Bottom", "Left"];
    const sideField = (i) => field({ icon: names[i][0], title: `Padding ${names[i].toLowerCase()}`, value: side(i), min: 0, onChange: (v, { live }) => write((p) => (p[i] = v), live, `p${i}`) });
    wrap.append(
      h("div", { class: "p-row p-pair" }, sideField(0), sideField(1), toggle),
      h("div", { class: "p-row p-pair" }, sideField(2), sideField(3)),
    );
  }
  return wrap;
}

// ---------- Radius: one value, or per corner ----------

let radiusPerCorner = false;
registerSection({
  id: "radius",
  title: "Radius",
  order: 30,
  appliesTo: (nodes) => nodes.every((n) => n.component !== "Text" && n.component !== "Vector"),
  render(body, nodes, store) {
    const corners = nodes.map((n) => fourSides(n.style.borderRadius ?? "0px"));
    const corner = (i) => common(corners, (c) => c[i]);
    const write = (fn, live, key) =>
      edit(store, nodes, "Radius", (n) => {
        const next = fourSides(n.style.borderRadius ?? "0px");
        fn(next);
        const joined = joinSides(next);
        return { style: { borderRadius: joined === "0px" ? undefined : joined } };
      }, live && key);
    // The header button: two small corners, drawn rather than an icon.
    const cornersIcon = `<span class="p-corners"><i></i><i></i></span>`;
    sectionHead(body, { extra: ghostButton({ icon: cornersIcon, title: "Radius per corner", pressed: radiusPerCorner, onClick: () => ((radiusPerCorner = !radiusPerCorner), body.replaceChildren(), body.parentElement.querySelector(".section-title .icon-button-ghost")?.remove(), this.render(body, nodes, store)) }) });
    if (!radiusPerCorner) {
      const all = [0, 1, 2, 3].every((i) => corner(i) === corner(0)) ? corner(0) : MIXED;
      const n = all === MIXED ? MIXED : parseNumber(all)?.n ?? 0;
      const valueField = field({ title: "Radius", value: all === MIXED ? MIXED : `${n}px`, min: 0, width: 80, onChange: (v, { live }) => write((c) => c.fill(v || "0px"), live, "r") });
      const range = slider({ label: "Radius", value: n, min: 0, max: 100, onChange: (v) => {
        valueField.querySelector("input").value = String(v);
        write((c) => c.fill(`${v}px`), true, "r");
      } });
      body.append(h("div", { class: "p-row" }, range, valueField));
      return;
    }
    const corners4 = [["Top left", 0], ["Top right", 1], ["Bottom left", 3], ["Bottom right", 2]];
    const cornerField = ([title, i]) => field({ icon: `<span class="p-corner p-corner-${i}"></span>`, title, value: corner(i), min: 0, onChange: (v, { live }) => write((c) => (c[i] = v || "0px"), live, `r${i}`) });
    body.append(
      h("div", { class: "p-row" }, ...corners4.slice(0, 2).map(cornerField)),
      h("div", { class: "p-row" }, ...corners4.slice(2).map(cornerField)),
    );
  },
});

// ---------- Layer: opacity, blending, clip ----------

registerSection({
  id: "layer",
  title: "Blending",
  order: 35,
  appliesTo: () => true,
  render(body, nodes, store) {
    const hidden = common(nodes, (n) => n.hidden === true);
    sectionHead(body, { extra: ghostButton({ icon: sized(hidden === true ? PANEL_ICONS.eyeRow : PANEL_ICONS.eye, 16), title: hidden === true ? "Show (Shift Mod H)" : "Hide (Shift Mod H)", onClick: () => edit(store, nodes, hidden === true ? "Show" : "Hide", { hidden: hidden !== true }) }) });

    const opacity = common(nodes, (n) => `${Math.round(parseFloat(n.style.opacity ?? "1") * 100)}%`);
    const blend = common(nodes, (n) => n.style.mixBlendMode ?? "normal");
    const blendSelect = h("select", { class: "field-control p-select", "aria-label": "Blend mode" });
    if (blend === MIXED) blendSelect.append(h("option", { value: "", disabled: true, selected: true }, "Mixed"));
    for (const mode of BLEND_MODES) blendSelect.append(h("option", { value: mode, selected: mode === blend }, mode.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase())));
    blendSelect.addEventListener("change", () => setStyle(store, nodes, "Blend mode", { mixBlendMode: blendSelect.value === "normal" ? undefined : blendSelect.value }));
    body.append(
      h("div", { class: "p-row p-halves" },
        field({ icon: sized(PANEL_ICONS.opacity, 16), title: "Opacity", value: opacity, unit: "%", min: 0, max: 100, onChange: (v, { live }) => setStyle(store, nodes, "Opacity", { opacity: parseFloat(v) >= 100 ? undefined : String(parseFloat(v) / 100) }, live && "opacity") }),
        h("div", { class: "field-root" }, h("div", { class: "field-icon", html: sized(PANEL_ICONS.blend, 16) }), blendSelect, h("span", { class: "field-caret", html: sized(PANEL_ICONS.chevronDown, 10) })),
      ),
    );
  },
});
