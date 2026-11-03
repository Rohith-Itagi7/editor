// The color picker, a popover next to the panel with up to three kinds of fill: Solid, Gradient and Image. A solid
// color is picked on a square of saturation and brightness with sliders for hue and alpha, and is written back in
// the format chosen (Hex, RGB, HSL or OKLCH). The file's color tokens can be picked here too.
import { h, select, numberField, iconButton, ICON, sized } from "../../ui/controls.js";
import { MISC_ICONS } from "../../ui/icons/inline.js";
import { BLEND_MODES, formatColor, formatOf, parseColor, rgbToHsv, hsvToRgb, formatGradient } from "../../core/style-values.js";
import { tokenHost, tokenOf, tokenRef } from "../../core/tokens.js";

const ALL_KINDS = ["solid", "gradient", "image"];
const NEUTRAL_GRAY = "#d9d9d9"; // what a gradient or an image starts from when the fill has no color
const POPOVER_WIDTH = 248;
const EDGE_GAP = 8;

const clamp = (n, low, high) => Math.min(high, Math.max(low, n));
const titleCase = (text) => text[0].toUpperCase() + text.slice(1);

// ---------- One popover at a time ----------
let shown = null;

export function closePicker() {
  shown?.remove();
  shown = null;
}

// A press outside the popover (and not on something that opens it) closes it, and so does Escape.
document.addEventListener("pointerdown", (event) => {
  if (shown && !shown.contains(event.target) && !event.target.closest?.("[data-opens-picker]")) closePicker();
});
document.addEventListener("keydown", (event) => event.key === "Escape" && closePicker());

/**
 * Opens next to `anchor`. `fill` is { type, ... } as the style code reads it, `onChange(fill, live)` hears every
 * change (live while something is being dragged), and `kinds` limits the tabs.
 */
export function openPicker(anchor, { fill, onChange, kinds = ALL_KINDS, blend = true }) {
  closePicker();
  let current = structuredClone(fill);
  let stopIndex = 0; // which gradient stop is being edited
  const popover = h("div", { class: "ins-pop", role: "dialog", "aria-label": "Color" });
  shown = popover;

  const emit = (live) => onChange(structuredClone(current), live);

  /** Changes the kind of fill, carrying the color over where there is one. */
  function switchKind(kind) {
    if (kind === current.type) return;
    const carried = current.type === "solid" ? current.color : current.type === "gradient" ? current.stops[0].color : NEUTRAL_GRAY;
    if (kind === "solid") current = { type: "solid", color: carried, blend: current.blend };
    if (kind === "gradient") current = { type: "gradient", kind: "linear", angle: 180, stops: [{ color: carried, at: 0 }, { color: "#ffffff", at: 100 }], blend: current.blend };
    if (kind === "image") current = { type: "image", url: current.url ?? "", size: "cover", blend: current.blend };
    stopIndex = 0;
    emit(false);
    render();
  }

  // ---------- The panes ----------
  function gradientPane() {
    const gradient = current;
    const wrap = h("div", { class: "ins-gradient" });
    const bar = h("div", { class: "ins-stops" });
    const paintBar = () => {
      const ordered = [...gradient.stops].sort((a, b) => a.at - b.at).map((s) => `${s.color} ${s.at}%`).join(", ");
      bar.style.background = `linear-gradient(90deg, ${ordered}), var(--ins-checker)`;
      bar.querySelectorAll(".ins-stop").forEach((knob, i) => {
        knob.style.left = `${gradient.stops[i].at}%`;
        knob.style.setProperty("--c", gradient.stops[i].color);
        knob.setAttribute("aria-pressed", String(i === stopIndex));
      });
    };

    // A knob for each stop: pressing selects it, dragging moves it along the bar.
    gradient.stops.forEach((stop, i) => {
      const knob = h("button", { type: "button", class: "ins-stop", title: `Stop ${i + 1}` });
      knob.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
        stopIndex = i;
        paintBar();
        knob.setPointerCapture(event.pointerId);
        const box = bar.getBoundingClientRect();
        const drag = (e) => {
          stop.at = Math.round(clamp(((e.clientX - box.left) / box.width) * 100, 0, 100));
          paintBar();
          emit(true);
        };
        const release = () => {
          knob.removeEventListener("pointermove", drag);
          knob.removeEventListener("pointerup", release);
          render();
        };
        knob.addEventListener("pointermove", drag);
        knob.addEventListener("pointerup", release);
      });
      bar.append(knob);
    });
    // A press on the bar itself adds a stop there.
    bar.addEventListener("pointerdown", (event) => {
      if (event.target !== bar) return;
      const box = bar.getBoundingClientRect();
      gradient.stops.push({ color: gradient.stops[stopIndex]?.color ?? "#888888", at: Math.round(((event.clientX - box.left) / box.width) * 100) });
      stopIndex = gradient.stops.length - 1;
      emit(false);
      render();
    });
    paintBar();

    const stop = gradient.stops[stopIndex];
    const controls = h("div", { class: "ins-row" },
      select({ label: "Gradient type", options: [["linear", "Linear"], ["radial", "Radial"], ["conic", "Conic"]], value: gradient.kind, onChange: (v) => ((gradient.kind = v), emit(false), render()) }),
      gradient.kind !== "radial" ? numberField({ label: "∠", title: "Angle", value: `${gradient.angle}deg`, unit: "deg", onChange: (v) => ((gradient.angle = parseFloat(v) || 0), emit(true)) }) : null,
      iconButton({ icon: ICON.rotate, title: "Rotate 90°", onClick: () => ((gradient.angle = (gradient.angle + 90) % 360), emit(false), render()) }),
      iconButton({ icon: ICON.swap, title: "Flip", onClick: () => (gradient.stops.forEach((s) => (s.at = 100 - s.at)), emit(false), render()) }),
      gradient.stops.length > 2 ? iconButton({ icon: ICON.minus, title: "Remove stop", onClick: () => (gradient.stops.splice(stopIndex, 1), (stopIndex = 0), emit(false), render()) }) : null,
    );
    wrap.append(bar, controls,
      h("div", { class: "ins-row" }, numberField({ label: "%", title: "Stop position", value: `${stop.at}`, unit: "", min: 0, max: 100, onChange: (v) => ((stop.at = parseFloat(v) || 0), emit(true), paintBar()) })),
      colorPane(stop.color, (color, live) => ((stop.color = color), paintBar(), emit(live))),
      h("code", { class: "ins-code" }, formatGradient(gradient)),
    );
    return wrap;
  }

  function imagePane() {
    const image = current;
    const preview = h("div", { class: "ins-image", style: { backgroundImage: image.url ? `url("${image.url}")` : "none" } }, image.url ? "" : "No image");
    // An uploaded picture is kept as a data: URL, which is too long to show in the field.
    const urlField = h("input", { class: "ins-input", placeholder: "https://… or upload", value: image.url?.startsWith("data:") ? "" : image.url ?? "" });
    urlField.addEventListener("change", () => ((image.url = urlField.value.trim()), emit(false), render()));
    const fileField = h("input", { type: "file", accept: "image/*", hidden: true });
    fileField.addEventListener("change", () => {
      const chosen = fileField.files?.[0];
      if (!chosen) return;
      const reader = new FileReader();
      reader.onload = () => ((image.url = reader.result), emit(false), render());
      reader.readAsDataURL(chosen);
    });
    return h("div", { class: "ins-gradient" }, preview,
      h("div", { class: "ins-row" }, urlField, h("button", { type: "button", class: "ins-btn", onClick: () => fileField.click() }, "Upload"), fileField),
      h("div", { class: "ins-row" }, h("span", { class: "ins-label" }, "Size"),
        select({ label: "Image size", options: [["cover", "Fill"], ["contain", "Fit"], ["tile", "Tile"]], value: image.size, onChange: (v) => ((image.size = v), emit(false)) })));
  }

  // ---------- Drawing and placing ----------
  function draw() {
    popover.innerHTML = "";
    if (kinds.length > 1) {
      const tabs = kinds.map((kind) => h("button", { type: "button", "aria-pressed": String(current.type === kind), onClick: () => switchKind(kind) }, titleCase(kind)));
      popover.append(h("div", { class: "ins-tabs" }, tabs));
    }
    if (current.type === "solid") popover.append(colorPane(current.color, (color, live) => ((current.color = color), emit(live))));
    if (current.type === "gradient") popover.append(gradientPane());
    if (current.type === "image") popover.append(imagePane());
    if (blend) {
      const modes = BLEND_MODES.map((mode) => [mode, titleCase(mode.replace(/-/g, " "))]);
      popover.append(
        h("div", { class: "ins-row" }, h("span", { class: "ins-label" }, "Blend"),
          select({ label: "Blend mode", options: modes, value: current.blend ?? "normal", onChange: (v) => ((current.blend = v), emit(false)) })),
      );
    }
  }

  const anchorBox = anchor.getBoundingClientRect();
  // Beside the panel, and moved up whenever a tab change makes it taller.
  function place() {
    popover.style.left = `${Math.max(EDGE_GAP, anchorBox.left - POPOVER_WIDTH - 12)}px`;
    popover.style.top = `${Math.max(EDGE_GAP, Math.min(window.innerHeight - popover.offsetHeight - EDGE_GAP, anchorBox.top - 40))}px`;
  }
  function render() {
    draw();
    place();
  }

  document.body.append(popover);
  render();
}

// ---------- Solid colors ----------
/** The square, the hue and alpha sliders, and the value in the chosen format; `onChange(color, live)` hears each change. */
export function colorPane(value, onChange) {
  const parsed = parseColor(value) ?? { r: 0, g: 0, b: 0, a: 1 };
  let format = formatOf(value);
  let hsv = rgbToHsv(parsed);
  let alpha = parsed.a ?? 1;
  const written = () => formatColor({ ...hsvToRgb(hsv.h, hsv.s, hsv.v), a: alpha }, format);

  const square = h("div", { class: "ins-sv" }, h("i"));
  const hueSlider = h("input", { type: "range", class: "ins-hue", min: 0, max: 360, step: 1, "aria-label": "Hue" });
  const alphaSlider = h("input", { type: "range", class: "ins-alpha", min: 0, max: 100, step: 1, "aria-label": "Alpha" });
  const valueField = h("input", { class: "ins-input", spellcheck: "false", "aria-label": "Color value" });
  const alphaField = h("input", { class: "ins-input ins-narrow", "aria-label": "Alpha %" });

  // Everything shows what hsv, alpha and format say; a field being typed in is left alone.
  function paint() {
    const rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
    square.style.background = `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))`;
    square.firstChild.style.left = `${hsv.s * 100}%`;
    square.firstChild.style.top = `${(1 - hsv.v) * 100}%`;
    square.firstChild.style.background = formatColor(rgb);
    hueSlider.value = hsv.h;
    alphaSlider.value = Math.round(alpha * 100);
    alphaSlider.style.setProperty("--c", formatColor(rgb));
    if (document.activeElement !== valueField) valueField.value = written();
    if (document.activeElement !== alphaField) alphaField.value = `${Math.round(alpha * 100)}%`;
  }
  const report = (live) => onChange(written(), live);

  square.addEventListener("pointerdown", (event) => {
    square.setPointerCapture(event.pointerId);
    const box = square.getBoundingClientRect();
    const drag = (e) => {
      hsv = { ...hsv, s: clamp((e.clientX - box.left) / box.width, 0, 1), v: 1 - clamp((e.clientY - box.top) / box.height, 0, 1) };
      paint();
      report(true);
    };
    drag(event);
    const release = () => {
      square.removeEventListener("pointermove", drag);
      square.removeEventListener("pointerup", release);
      report(false);
    };
    square.addEventListener("pointermove", drag);
    square.addEventListener("pointerup", release);
  });
  hueSlider.addEventListener("input", () => ((hsv = { ...hsv, h: Number(hueSlider.value) }), paint(), report(true)));
  alphaSlider.addEventListener("input", () => ((alpha = Number(alphaSlider.value) / 100), paint(), report(true)));
  valueField.addEventListener("change", () => {
    const typed = parseColor(valueField.value);
    if (!typed) return paint(); // not a color: the field goes back to the current one
    format = formatOf(valueField.value);
    hsv = rgbToHsv(typed);
    alpha = typed.a ?? 1;
    paint();
    report(false);
  });
  alphaField.addEventListener("change", () => {
    const percent = parseFloat(alphaField.value);
    if (!Number.isNaN(percent)) alpha = clamp(percent / 100, 0, 1);
    paint();
    report(false);
  });
  const formatSelect = select({ label: "Color format", options: [["hex", "Hex"], ["rgb", "RGB"], ["hsl", "HSL"], ["oklch", "OKLCH"]], value: format, onChange: (v) => ((format = v), paint(), report(false)) });

  const dropper = "EyeDropper" in window
    ? iconButton({
      icon: sized(MISC_ICONS.pencil, 16),
      title: "Pick a color",
      onClick: async () => {
        try {
          const { sRGBHex } = await new window.EyeDropper().open();
          hsv = rgbToHsv(parseColor(sRGBHex));
          paint();
          report(false);
        } catch {} // the person closed the dropper
      },
    })
    : null;
  paint();

  // The file's color tokens: pick one and the color becomes var(--color-x), so it follows the token;
  // "+ Token" makes one from this color.
  const tokenRow = h("div", { class: "ins-tokens" });
  let boundTo = tokenOf(value)?.id ?? null;
  function paintTokens() {
    const colors = tokenHost.tokens().filter((t) => t.type === "color");
    const use = (token) => { boundTo = token.id; onChange(tokenRef(token), false); paintTokens(); };
    tokenRow.replaceChildren(
      ...colors.map((token) => h("button", { type: "button", class: "ins-token", title: `${token.name}: ${token.value}`, "aria-pressed": String(token.id === boundTo), onClick: () => use(token) }, h("i", { style: { background: token.value } }), token.name)),
      h("button", { type: "button", class: "ins-token ins-token-new", title: "Make a token from this color", onClick: () => { const made = tokenHost.createFromColor(written()); if (made) use(made); } }, "+ Token"),
    );
  }
  paintTokens();

  return h("div", { class: "ins-color" }, square,
    h("div", { class: "ins-row" }, dropper, h("div", { class: "ins-sliders" }, hueSlider, alphaSlider)),
    h("div", { class: "ins-row" }, formatSelect, valueField, alphaField),
    tokenRow);
}
