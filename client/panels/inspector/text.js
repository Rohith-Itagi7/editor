// Text and Underline: the font and its
// style as two menu fields, size, line height and letter spacing, then horizontal and vertical
// alignment. Case, wrap, keep words and truncation sit in the Formatting popup behind the
// header's settings button; underline, overline and strikethrough are their own section.
import { registerSection } from "../../core/sections.js";
import { MIXED, common, setStyle, edit, h, field, toggleGroup, ghostButton, swatchField, sized } from "../../ui/controls.js";
import { openPicker } from "./picker.js";
import { parseColor, formatColor } from "../../core/style-values.js";
import { PANEL_ICONS } from "../../ui/icons/panel.js";
import { TEXT_ICONS } from "../../ui/icons/inline.js";

// The Text section's own icons.
export { TEXT_ICONS };

const icon = (name, w, hgt = w) => sized(TEXT_ICONS[name] ?? PANEL_ICONS[name], w, hgt);
const CARET = () => sized(PANEL_ICONS.chevronDown, 10);

// ---------- Popups: small windows that open beside the panel ----------

let openPopupEl = null;
export function closePopup() {
  openPopupEl?.remove();
  openPopupEl = null;
}
document.addEventListener("pointerdown", (e) => openPopupEl && !openPopupEl.contains(e.target) && !e.target.closest?.("[data-opens-popup]") && closePopup());
document.addEventListener("keydown", (e) => e.key === "Escape" && openPopupEl && closePopup());

/** A popup with one tab and a close button, its right edge on the panel's left edge. */
export function openPopup(anchor, { title, width = 300, content }) {
  closePopup();
  const close = h("button", { type: "button", class: "popup-header-button", "aria-label": "Close", html: sized(TEXT_ICONS.close, 10), onClick: closePopup });
  const pop = h("div", { class: "sec-popup", role: "dialog", "aria-label": title, style: { width: `${width}px` } },
    h("div", { class: "sec-popup-header" }, h("div", { class: "sec-popup-tab" }, title), h("span", { class: "sec-grow" }), close),
    h("div", { class: "sec-popup-body" }, content),
  );
  openPopupEl = pop;
  document.body.append(pop);
  const panel = anchor.closest(".side")?.getBoundingClientRect() ?? anchor.getBoundingClientRect();
  const a = anchor.getBoundingClientRect();
  pop.style.left = `${Math.max(8, panel.left - width)}px`;
  pop.style.top = `${Math.max(8, Math.min(window.innerHeight - pop.offsetHeight - 8, a.top))}px`;
  return pop;
}

/** A searchable list in a popup: Fonts, Styles. items: [{ value, label, style }] */
function openListPopup(anchor, { title, placeholder, items, current, onPick, footer }) {
  const search = h("input", { class: "sec-search", placeholder, spellcheck: "false", "aria-label": placeholder });
  const list = h("div", { class: "sec-list", role: "listbox" });
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    list.replaceChildren(
      ...items
        .filter((item) => item.label.toLowerCase().includes(q))
        .map((item) =>
          h("div", { class: "sec-list-item", role: "option", "aria-selected": String(item.value === current), style: item.style, onClick: () => (onPick(item.value), closePopup()) }, item.label),
        ),
    );
  };
  search.addEventListener("input", draw);
  draw();
  openPopup(anchor, { title, width: 300, content: [h("div", { class: "sec-search-wrap" }, search), list, footer] });
  search.focus();
}

/** A field that opens a menu, with an icon on the left and a caret on the right. */
function menuField({ iconSvg, label, title, onOpen, family }) {
  const button = h("button", { type: "button", class: "field-control", "aria-label": title, "data-opens-popup": "", style: family ? { fontFamily: family } : undefined }, h("span", { class: "truncate" }, label));
  button.addEventListener("click", () => onOpen(button));
  return h("div", { class: "field-root sec-menu-field" },
    h("div", { class: "field-icon", html: iconSvg }),
    button,
    h("button", { type: "button", class: "field-caret", tabindex: "-1", "aria-hidden": "true", html: CARET(), onClick: () => button.click() }),
  );
}

// ---------- Text ----------

const FONTS = [
  ["Courier New", "Courier New"],
  ["Georgia", "Georgia"],
  ["Impact", "Impact"],
  ["Inter", "Inter"],
  ["Inter Tight", "Inter Tight"],
  ["Noto Sans", "Noto Sans"],
  ["System Monospace", "ui-monospace"],
  ["System Sans-Serif", "system-ui"],
];
let localFonts = [];

const STYLES = {
  default: [["100", "Thin"], ["200", "Extra Light"], ["300", "Light"], ["400", "Regular"], ["500", "Medium"], ["600", "Semibold"], ["700", "Bold"], ["800", "Extra Bold"], ["900", "Black"]],
};
const familyOf = (n) => (n.style.fontFamily ?? "system-ui").split(",")[0].replace(/["']/g, "").trim();
const fontLabel = (family) => FONTS.find(([, css]) => css === family)?.[0] ?? family;
const stylesFor = (family) => STYLES[family] ?? STYLES.default;
const styleName = (family, weight, italic) => {
  const list = stylesFor(family);
  const near = list.reduce((best, s) => (Math.abs(s[0] - weight) < Math.abs(best[0] - weight) ? s : best), list[0]);
  return `${near[1]}${italic ? " Italic" : ""}`;
};

const num = (value) => {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
};
const sizeOf = (n) => num(n.style.fontSize) ?? 16;
/** Line height in pixels; null when it follows the font. */
function lineHeightPx(n) {
  const v = n.style.lineHeight;
  if (!v || v === "normal") return null;
  if (/px$/.test(v)) return num(v);
  if (/%$/.test(v)) return (num(v) / 100) * sizeOf(n);
  return num(v) * sizeOf(n);
}
/** Letter spacing as a percent of the font size. */
function letterSpacingPct(n) {
  const v = n.style.letterSpacing;
  if (!v || v === "normal") return 0;
  if (/em$/.test(v)) return num(v) * 100;
  if (/px$/.test(v)) return (num(v) / sizeOf(n)) * 100;
  return num(v) ?? 0;
}
const round = (n) => Math.round(n * 100) / 100;

const ALIGN = () => [
  { value: "left", title: "Align left", icon: icon("alignLeft", 16) },
  { value: "center", title: "Align center", icon: icon("alignCenter", 16) },
  { value: "right", title: "Align right", icon: icon("alignRight", 16) },
];
const VALIGN = () => [
  { value: "flex-start", title: "Align top", icon: icon("alignTop", 16) },
  { value: "center", title: "Align middle", icon: icon("alignMiddle", 16) },
  { value: "flex-end", title: "Align bottom", icon: icon("alignBottom", 16) },
];

registerSection({
  id: "text",
  title: "Text",
  order: 41,
  appliesTo: (nodes) => nodes.every((n) => n.text != null),
  render(body, nodes, store) {
    const set = (label, style, live, key) => setStyle(store, nodes, label, style, live && key);
    const settings = ghostButton({ icon: icon("textSettings", 16), title: "Text settings" });
    settings.dataset.opensPopup = "";
    settings.addEventListener("click", () => openFormatting(settings, nodes, store));
    body.parentElement.querySelector(".section-title").append(settings);

    const family = common(nodes, familyOf);
    const weight = common(nodes, (n) => String(n.style.fontWeight ?? "400"));
    const italic = common(nodes, (n) => n.style.fontStyle === "italic");

    body.append(
      menuField({
        iconSvg: icon("font", 16),
        title: "Font family",
        label: family === MIXED ? "Mixed" : fontLabel(family),
        onOpen: (anchor) =>
          openListPopup(anchor, {
            title: "Fonts",
            placeholder: "Search fonts",
            current: family,
            items: [...FONTS, ...localFonts.map((f) => [f, f])].map(([label, css]) => ({ value: css, label, style: { fontFamily: `"${css}", ${css}` } })),
            onPick: (css) => set("Font", { fontFamily: css }),
            footer:
              "queryLocalFonts" in window && !localFonts.length
                ? h("button", { type: "button", class: "sec-list-footer", onClick: async () => {
                    try {
                      localFonts = [...new Set((await window.queryLocalFonts()).map((f) => f.family))].sort();
                    } catch {}
                    closePopup();
                  } }, "Show local fonts")
                : null,
          }),
      }),
      menuField({
        iconSvg: icon("weight", 16),
        title: "Font style",
        label: family === MIXED || weight === MIXED || italic === MIXED ? "Mixed" : styleName(family, Number(weight), italic),
        onOpen: (anchor) =>
          openListPopup(anchor, {
            title: "Styles",
            placeholder: "Search font styles",
            current: weight === MIXED ? null : `${weight}${italic === true ? "i" : ""}`,
            items: stylesFor(family === MIXED ? "default" : family).flatMap(([w, name]) => [
              { value: w, label: name, style: { fontWeight: w } },
              { value: `${w}i`, label: `${name} Italic`, style: { fontWeight: w, fontStyle: "italic" } },
            ]),
            onPick: (value) => set("Font style", { fontWeight: value.replace("i", ""), fontStyle: value.endsWith("i") ? "italic" : undefined }),
          }),
      }),
    );

    const size = common(nodes, (n) => `${sizeOf(n)}`);
    const lh = common(nodes, (n) => lineHeightPx(n));
    const ls = common(nodes, (n) => round(letterSpacingPct(n)));
    body.append(
      h("div", { class: "p-row" },
        field({ icon: icon("size", 16), title: "Font size", value: size, min: 1, onChange: (v, { live }) => set("Font size", { fontSize: v }, live, "size") }),
        field({
          icon: icon("lineHeight", 16),
          title: "Line height",
          value: lh === MIXED ? MIXED : lh == null ? "" : `${round(lh)}`,
          placeholder: lh == null ? `${Math.round(sizeOf(nodes[0]) * 1.2)}` : "",
          min: 0,
          onChange: (v, { live }) => set("Line height", { lineHeight: v }, live, "lh"),
        }),
        field({
          icon: icon("letterSpacing", 16),
          title: "Letter spacing",
          value: ls === MIXED ? MIXED : `${ls}%`,
          unit: "%",
          step: 0.5,
          onChange: (v, { live }) => {
            const pct = parseFloat(v) || 0;
            set("Letter spacing", { letterSpacing: pct ? `${round(pct / 100)}em` : undefined }, live, "ls");
          },
        }),
      ),
      h("div", { class: "sec-aligns" },
        toggleGroup({
          label: "Horizontal alignment",
          options: ALIGN(),
          value: common(nodes, (n) => n.style.textAlign ?? "left"),
          onChange: (v) => set("Text align", { textAlign: v === "left" ? undefined : v }),
        }),
        toggleGroup({
          label: "Vertical alignment",
          options: VALIGN(),
          value: common(nodes, (n) => (n.style.display === "flex" ? n.style.justifyContent ?? "flex-start" : "flex-start")),
          // Text sits at the top of its box; any other place makes the box a column to move it in.
          onChange: (v) => set("Vertical align", v === "flex-start" ? { display: undefined, flexDirection: undefined, justifyContent: undefined } : { display: "flex", flexDirection: "column", justifyContent: v }),
        }),
      ),
    );
  },
});

// ---------- Formatting popup: alignment, case, wrap, keep words, truncation ----------

function openFormatting(anchor, nodes, store) {
  const pick = () => nodes.map((n) => store.get(n.id)).filter(Boolean);
  const set = (label, style) => setStyle(store, pick(), label, style);
  const value = (read) => common(pick(), read);
  const preview = h("div", { class: "sec-preview" }, h("span", {}, "Lorem ipsum"));
  const paintPreview = () => {
    const s = pick()[0]?.style ?? {};
    Object.assign(preview.firstChild.style, { textTransform: s.textTransform ?? "", fontFamily: s.fontFamily ?? "" });
    preview.style.justifyContent = { center: "center", right: "flex-end" }[s.textAlign] ?? (s.textAlign === "left" || !s.textAlign ? "flex-start" : "center");
  };
  const line = (label, control) => h("div", { class: "sec-popup-row" }, h("label", {}, label), control);
  const clamp = (lines) =>
    lines > 0
      ? { display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: String(lines), overflow: "hidden" }
      : { display: undefined, WebkitBoxOrient: undefined, WebkitLineClamp: undefined, overflow: undefined };
  let body;
  const redraw = () => {
    body.replaceChildren(...content());
    paintPreview();
  };
  const content = () => {
    const truncated = value((n) => Number(n.style.WebkitLineClamp) > 0);
    const rows = [
      preview,
      line("Alignment", toggleGroup({
        label: "Alignment", width: 160,
        options: [...ALIGN(), { value: "justify", title: "Justify", icon: icon("alignJustify", 16) }],
        value: value((n) => n.style.textAlign ?? "left"),
        onChange: (v) => (set("Text align", { textAlign: v === "left" ? undefined : v }), redraw()),
      })),
      line("Case", toggleGroup({
        label: "Case", width: 160,
        options: [
          { value: "none", title: "As typed", icon: icon("caseNone", 16) },
          { value: "uppercase", title: "Uppercase", label: "AA" },
          { value: "lowercase", title: "Lowercase", label: "aa" },
          { value: "capitalize", title: "Title case", label: "Aa" },
        ],
        value: value((n) => n.style.textTransform ?? "none"),
        onChange: (v) => (set("Case", { textTransform: v === "none" ? undefined : v }), redraw()),
      })),
      line("Wrap", wrapSelect(value((n) => n.style.textWrap ?? "auto"), (v) => (set("Wrap", { textWrap: v === "auto" ? undefined : v }), redraw()))),
      line("Keep words", toggleGroup({
        label: "Keep words", width: 80,
        options: [{ value: "off", label: "Off", title: "Off" }, { value: "on", label: "On", title: "On" }],
        value: value((n) => (n.style.wordBreak === "keep-all" ? "on" : "off")),
        onChange: (v) => (set("Keep words", { wordBreak: v === "on" ? "keep-all" : undefined }), redraw()),
      })),
      line("Truncation", toggleGroup({
        label: "Truncation", width: 80,
        options: [{ value: "off", label: "Off", title: "Off" }, { value: "on", label: "On", title: "On" }],
        value: truncated === true ? "on" : "off",
        onChange: (v) => (set("Truncation", clamp(v === "on" ? 1 : 0)), redraw()),
      })),
    ];
    if (truncated === true) {
      rows.push(line("Max lines", field({
        title: "Max lines", value: value((n) => String(n.style.WebkitLineClamp)), unit: "", min: 1, width: 80,
        onChange: (v) => (set("Max lines", clamp(Math.max(1, Math.round(parseFloat(v) || 1)))), redraw()),
      })));
    }
    return rows;
  };
  const pop = openPopup(anchor, { title: "Formatting", content: content() });
  body = pop.querySelector(".sec-popup-body");
  paintPreview();
}

function wrapSelect(value, onChange) {
  const select = h("select", { class: "field-control", "aria-label": "Wrap" },
    ...[["auto", "Normal"], ["pretty", "Pretty"], ["balance", "Balance"]].map(([v, label]) => h("option", { value: v, selected: v === value }, label)));
  if (value === MIXED) select.prepend(h("option", { value: "", selected: true, disabled: true }, "Mixed"));
  select.addEventListener("change", () => onChange(select.value));
  return h("div", { class: "field-root sec-select", style: { flex: "0 0 160px" } }, h("div", { class: "field-icon", html: icon("wrap", 16) }), select, h("span", { class: "field-caret", html: CARET() }));
}

// ---------- Underline: thickness, offset, color; shape and placement behind settings ----------

const decorationOf = (n) => {
  const line = n.style.textDecorationLine ?? /(underline|overline|line-through)/.exec(n.style.textDecoration ?? "")?.[1];
  return line && line !== "none" ? line : n.decorationHidden ?? null;
};

registerSection({
  id: "underline",
  title: "Underline",
  order: 41.5,
  appliesTo: (nodes) => nodes.every((n) => n.text != null),
  render(body, nodes, store) {
    const head = body.parentElement.querySelector(".section-title");
    const set = (label, style, live, key) => setStyle(store, nodes, label, style, live && key);
    const present = common(nodes, (n) => decorationOf(n) != null);
    if (present !== true) {
      head.append(ghostButton({ icon: sized(PANEL_ICONS.plus, 16), title: "Add underline", onClick: () => edit(store, nodes, "Add underline", { decorationHidden: undefined, style: { textDecoration: undefined, textDecorationLine: "underline", textDecorationThickness: "1px" } }) }));
      body.append(h("p", { class: "ins-empty" }));
      return;
    }
    const settings = ghostButton({ icon: icon("textSettings", 16), title: "Underline settings" });
    settings.dataset.opensPopup = "";
    settings.addEventListener("click", () => openDecorationSettings(settings, nodes, store));
    head.append(settings);

    const hidden = common(nodes, (n) => !!n.decorationHidden);
    const toggleHidden = () =>
      edit(store, nodes, hidden === true ? "Show underline" : "Hide underline", (n) =>
        hidden === true
          ? { decorationHidden: undefined, style: { textDecorationLine: n.decorationHidden } }
          : { decorationHidden: decorationOf(n), style: { textDecorationLine: "none" } });
    const remove = () =>
      edit(store, nodes, "Remove underline", {
        decorationHidden: undefined,
        style: { textDecoration: undefined, textDecorationLine: undefined, textDecorationThickness: undefined, textUnderlineOffset: undefined, textDecorationColor: undefined, textDecorationStyle: undefined, textDecorationSkipInk: undefined },
      });
    const thickness = common(nodes, (n) => n.style.textDecorationThickness ?? "1px");
    const offset = common(nodes, (n) => n.style.textUnderlineOffset ?? "");
    body.append(
      h("div", { class: "sec-line" },
        field({ icon: icon("thickness", 16), title: "Thickness", value: thickness === MIXED ? MIXED : `${num(thickness) ?? 1}`, min: 0, step: 0.5, width: 100, onChange: (v, { live }) => set("Underline thickness", { textDecorationThickness: v }, live, "ut") }),
        field({ icon: icon("offset", 16), title: "Offset", value: offset === MIXED ? MIXED : offset ? `${num(offset)}` : "", placeholder: "Auto", width: 100, onChange: (v, { live }) => set("Underline offset", { textUnderlineOffset: v }, live, "uo") }),
        h("span", { class: "sec-grow" }),
        ghostButton({ icon: sized(PANEL_ICONS.eye, 16), title: hidden === true ? "Show underline" : "Hide underline", pressed: hidden === true, onClick: toggleHidden }),
        ghostButton({ icon: sized(PANEL_ICONS.minus, 16), title: "Remove underline", onClick: remove }),
      ),
    );
    // The line takes the text's color until it is given its own.
    const colorOf = (n) => n.style.textDecorationColor ?? n.style.color ?? "#000000";
    body.append(colorLine({ value: common(nodes, colorOf), store, onChange: (css, live) => set("Underline color", { textDecorationColor: css }, live, "uc") }));
  },
});

function openDecorationSettings(anchor, nodes, store) {
  const pick = () => nodes.map((n) => store.get(n.id)).filter(Boolean);
  const set = (label, style) => setStyle(store, pick(), label, style);
  const value = (read) => common(pick(), read);
  const line = (label, control) => h("div", { class: "sec-popup-row" }, h("label", {}, label), control);
  let body;
  const redraw = () => body.replaceChildren(...content());
  const choice = (label, options, current, onChange) =>
    line(label, toggleGroup({ label, width: 200, options: options.map(([v, text]) => ({ value: v, label: text, title: text })), value: current, onChange: (v) => (onChange(v), redraw()) }));
  const content = () => [
    choice("Shape", [["solid", "Solid"], ["dashed", "Dashed"], ["dotted", "Dotted"], ["wavy", "Wavy"]], value((n) => n.style.textDecorationStyle ?? "solid"), (v) => set("Underline shape", { textDecorationStyle: v === "solid" ? undefined : v })),
    choice("Placement", [["underline", "Under"], ["overline", "Over"], ["line-through", "Through"]], value((n) => decorationOf(n) ?? "underline"), (v) => set("Underline placement", { textDecoration: undefined, textDecorationLine: v })),
    choice("Overlap", [["auto", "Skip ink"], ["none", "Draw over"]], value((n) => n.style.textDecorationSkipInk ?? "auto"), (v) => set("Underline overlap", { textDecorationSkipInk: v === "auto" ? undefined : v })),
    h("div", { class: "sec-popup-row" }, h("span"), h("button", { type: "button", class: "sec-popup-action", onClick: () => (set("Reset underline color", { textDecorationColor: undefined }), redraw()) }, "Reset color")),
  ];
  const pop = openPopup(anchor, { title: "Underline", content: content() });
  body = pop.querySelector(".sec-popup-body");
}

// ---------- A color row, shared with Fill: swatch, hex and alpha, tokens, eyedropper ----------

/** Every distinct color in the document, standing in for color tokens. */
export function documentColors(store) {
  const seen = new Set();
  for (const node of store.all()) {
    for (const value of Object.values(node.style)) {
      for (const match of String(value).match(/#[0-9a-f]{3,8}\b|(?:rgba?|hsla?|oklch)\([^()]*\)/gi) ?? []) {
        const c = parseColor(match);
        if (c) seen.add(formatColor(c));
      }
    }
  }
  return [...seen];
}

export function openColorTokens(anchor, store, onPick) {
  const grid = h("div", { class: "sec-tokens" },
    documentColors(store).map((color) => h("button", { type: "button", class: "sec-token", title: color.toUpperCase(), style: { "--c": color }, onClick: () => (onPick(color), closePopup()) })));
  openPopup(anchor, { title: "Colors", width: 240, content: [h("p", { class: "sec-popup-note" }, "Colors in this file"), grid] });
}

export async function pickFromScreen(onPick) {
  if (!("EyeDropper" in window)) return;
  try {
    const { sRGBHex } = await new window.EyeDropper().open();
    onPick(sRGBHex);
  } catch {}
}

/** value: any CSS color or MIXED; onChange(css, live) gets hex, with alpha when below 100%. */
export function colorLine({ value, onChange, store, trailing }) {
  const c = value === MIXED ? null : parseColor(value) ?? { r: 0, g: 0, b: 0, a: 1 };
  const write = (rgb, a, live) => onChange(formatColor({ ...rgb, a: a / 100 }), live);
  const alpha = c ? Math.round((c.a ?? 1) * 100) : 100;
  const tokens = ghostButton({ icon: sized(PANEL_ICONS.tokens, 16), title: "Color tokens" });
  tokens.dataset.opensPopup = "";
  tokens.addEventListener("click", () => openColorTokens(tokens, store, (css) => onChange(css, false)));
  return h("div", { class: "sec-line" },
    swatchField({
      color: c ? formatColor({ ...c, a: 1 }) : MIXED,
      alpha,
      onOpen: (anchor) => openPicker(anchor, { fill: { type: "solid", color: c ? formatColor(c) : "#000000" }, kinds: ["solid"], blend: false, onChange: (fill) => onChange(fill.color, true) }),
      onHex: (next) => write(parseColor(next), alpha, false),
      onAlpha: (n, { live }) => c && write(c, n, live),
    }),
    tokens,
    trailing ?? ghostButton({ icon: sized(PANEL_ICONS.eyedropper, 16), title: "Pick a color", onClick: () => pickFromScreen((css) => onChange(css, false)) }),
  );
}
