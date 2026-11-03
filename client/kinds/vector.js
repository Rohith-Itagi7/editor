// The Vector node kind: what the Pen tool makes. The element draws a network (core/vector.js) as an SVG that
// stretches with its box, and the panel gets a section for its fill and stroke.
import { nodeRenderers } from "../canvas/canvas.js";
import { registerSection } from "../core/sections.js";
import { defaultStroke, num, pathData } from "../core/vector.js";

nodeRenderers.Vector = {
  create(node) {
    const el = document.createElement("div");
    const { fill, fillRule = "nonzero", stroke = defaultStroke } = node.vector;
    const w = parseFloat(node.style.width) || 1;
    const h = parseFloat(node.style.height) || 1;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    // The box is the path's own, so the path scales with it; the stroke keeps its width.
    for (const [k, v] of Object.entries({ width: "100%", height: "100%", viewBox: `0 0 ${num(w)} ${num(h)}`, preserveAspectRatio: "none" })) svg.setAttribute(k, v);
    svg.style.overflow = "visible";
    svg.style.display = "block";
    const draw = (attrs) => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      for (const [k, v] of Object.entries(attrs)) path.setAttribute(k, v);
      svg.append(path);
    };
    // The regions first, under the lines.
    if (fill) draw({ d: pathData(node.vector, { loopsOnly: true }), fill, "fill-rule": fillRule, stroke: "none" });
    draw({ d: pathData(node.vector), fill: "none", stroke: stroke.color, "stroke-width": stroke.width, "stroke-linecap": stroke.cap, "stroke-linejoin": stroke.join, "vector-effect": "non-scaling-stroke" });
    el.append(svg);
    return el;
  },
};

// The panel: the fill and stroke of the network, in place of the box fills the other elements have.
registerSection({
  id: "vector",
  title: "Path",
  order: 20,
  appliesTo: (nodes) => nodes.length === 1 && nodes[0].component === "Vector",
  render(container, [node], store) {
    const { fill, fillRule = "nonzero", stroke = defaultStroke } = node.vector;
    const set = (patch, merge) => store.transact("Edit path", () => store.update(node.id, { vector: { ...node.vector, ...patch } }), merge ? { merge: `${node.id}-${merge}` } : {});
    container.innerHTML = `
      <div class="row" style="grid-template-columns:1fr 1fr"><label class="field"><span>Fill</span><input data-k="fill" value="${fill ?? ""}" placeholder="none" spellcheck="false"></label><input type="color" data-k="fill-pick" value="${/^#[0-9a-f]{6}$/i.test(fill ?? "") ? fill : "#000000"}" aria-label="Fill color"></div>
      <div class="row" style="grid-template-columns:1fr 1fr"><label class="field"><span>Stroke</span><input data-k="color" value="${stroke.color}" spellcheck="false"></label><input type="color" data-k="color-pick" value="${/^#[0-9a-f]{6}$/i.test(stroke.color) ? stroke.color : "#000000"}" aria-label="Stroke color"></div>
      <div class="row" style="grid-template-columns:1fr 1fr"><label class="field"><span>W</span><input data-k="width" value="${stroke.width}" inputmode="decimal"></label>
        <label class="field"><span>End</span><select data-k="cap">${["butt", "round", "square"].map((v) => `<option ${v === stroke.cap ? "selected" : ""}>${v}</option>`).join("")}</select></label></div>
      <div class="row" style="grid-template-columns:1fr 1fr"><label class="field"><span>Join</span><select data-k="join">${["miter", "round", "bevel"].map((v) => `<option ${v === stroke.join ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        <label class="field"><span>Fill</span><select data-k="rule">${[["nonzero", "Non-zero"], ["evenodd", "Even-odd"]].map(([v, l]) => `<option value="${v}" ${v === fillRule ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>`;
    const at = (k) => container.querySelector(`[data-k="${k}"]`);
    const stroked = (patch) => set({ stroke: { ...stroke, ...patch } });
    at("fill").addEventListener("change", (e) => set({ fill: e.target.value.trim() || null }));
    at("fill-pick").addEventListener("input", (e) => set({ fill: e.target.value }, "fill"));
    at("color").addEventListener("change", (e) => stroked({ color: e.target.value.trim() || defaultStroke.color }));
    at("color-pick").addEventListener("input", (e) => store.transact("Edit path", () => store.update(node.id, { vector: { ...node.vector, stroke: { ...stroke, color: e.target.value } } }), { merge: `${node.id}-stroke` }));
    at("width").addEventListener("change", (e) => { const w = parseFloat(e.target.value); if (w >= 0) stroked({ width: w }); });
    at("cap").addEventListener("change", (e) => stroked({ cap: e.target.value }));
    at("join").addEventListener("change", (e) => stroked({ join: e.target.value }));
    at("rule").addEventListener("change", (e) => set({ fillRule: e.target.value }));
  },
});
