// The design panel (Inspector): a header naming the selection, then every registered section
// that applies to it, in order. The sections live beside this file, one module per group, as
// The panel is one component per section.
import { sectionsFor } from "../../core/sections.js";
import { TOKEN_TYPES, cssName } from "../../core/tokens.js";
import { closePicker } from "./picker.js";
import { h } from "../../ui/controls.js";
import { toast } from "../../ui/toast.js";
import { bindLayoutHotkeys } from "./frame.js";
import "./text.js";
import "./paint.js";
import "./export.js";

// With nothing selected the panel is the page's: its tokens, a section per kind. A row copies the token's var().
function tokenSections(store) {
  const tokens = store.tokens();
  return TOKEN_TYPES.map(({ type, title }) => [title, tokens.filter((t) => t.type === type)]).filter(([, list]) => list.length).map(([title, list]) =>
    h("section", { class: "section", "data-section": "tokens" },
      h("div", { class: "section-title" }, h("span", {}, title)),
      h("div", { class: "section-body" }, ...list.map((t) => {
        const ref = `var(${cssName(t)})`;
        return h("button", { type: "button", class: "token-row", title: `Copy ${ref}`, onClick: () => navigator.clipboard?.writeText(ref).then(() => toast(`Copied ${ref}`), () => {}) },
          t.type === "color" ? h("i", { class: "token-swatch", style: { background: t.value } }) : null,
          h("span", { class: "token-name" }, t.name),
          h("span", { class: "token-value" }, t.value));
      }))));
}

export function mountInspector(root, store) {
  root.classList.add("ins");
  bindLayoutHotkeys(store);
  let shownFor = "";

  function render() {
    const nodes = store.selectedNodes();
    const key = nodes.map((n) => n.id).join(",");
    // A new selection closes a picker left open for the old one.
    if (key !== shownFor) closePicker();
    shownFor = key;
    const scroll = root.scrollTop;
    root.innerHTML = "";
    if (!nodes.length) {
      root.append(h("div", { class: "ins-title" }, h("b", {}, "Page")), h("p", { class: "ins-empty ins-pad" }, "Select something on the canvas or in Layers to edit it."), ...tokenSections(store));
      root.scrollTop = scroll;
      return;
    }
    const kinds = [...new Set(nodes.map((n) => n.component))];
    root.append(
      h("div", { class: "ins-title" },
        h("b", {}, nodes.length === 1 ? nodes[0].name : `${nodes.length} selected`),
        h("span", {}, nodes.length === 1 ? (nodes[0].parent == null && nodes[0].component === "Frame" ? "Artboard" : nodes[0].component) : kinds.join(", ")),
      ),
    );
    for (const section of sectionsFor(nodes, store)) {
      const body = h("div", { class: "section-body" });
      const wrap = h("section", { class: "section", "data-section": section.id }, h("div", { class: "section-title" }, h("span", {}, section.title)), body);
      root.append(wrap);
      section.render(body, nodes, store);
      // A section with nothing set shows as a lighter title with a +, and no body.
      const placeholders = body.querySelectorAll(":scope > .ins-empty");
      if (body.children.length === placeholders.length) {
        placeholders.forEach((p) => p.remove());
        wrap.dataset.empty = "";
      }
    }
    root.scrollTop = scroll;
  }

  // Re-rendering while a field has focus would steal it; the field's own change already shows.
  store.subscribe((reason) => {
    if (reason === "ui") return;
    if (reason === "document" && root.contains(document.activeElement) && document.activeElement.matches("input, select, textarea")) return;
    // A drag on a number field blurs it, and the panel would be rebuilt under the hand on every step: wait for the end.
    if (reason === "document" && document.documentElement.hasAttribute("data-scrubbing")) return;
    render();
  });
  document.addEventListener("scrubend", render);
  render();
}
