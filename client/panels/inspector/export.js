// The Export section of the design panel: copy the selection as Tailwind or React, or save it as a PNG.
import { registerSection } from "../../core/sections.js";
import { h, row } from "../../ui/controls.js";
import { asReactCss, asTailwind, nodePng } from "../../features/export.js";

let format = "tailwind";
registerSection({
  id: "export",
  title: "Export",
  order: 90,
  appliesTo: () => true,
  render(body, nodes, store) {
    const code = () => (format === "tailwind" ? asTailwind(store, nodes) : asReactCss(store, nodes));
    const status = h("span", { class: "ins-hint", role: "status" });
    const say = (text) => {
      status.textContent = text;
      setTimeout(() => status.textContent === text && (status.textContent = ""), 2000);
    };
    const copyText = async (text, what) => {
      try {
        await navigator.clipboard.writeText(text);
        say(`Copied ${what}`);
      } catch {
        say("The clipboard refused");
      }
    };
    const pre = h("pre", { class: "ins-code ins-export" }, code());
    const tabs = h("div", { class: "ins-tabs" },
      ...[["tailwind", "Tailwind"], ["react", "React CSS"]].map(([value, label]) =>
        h("button", { type: "button", "aria-pressed": String(format === value), onClick: () => ((format = value), body.replaceChildren(), this.render(body, nodes, store)) }, label)));
    const scale = h("select", { class: "ins-select", "aria-label": "Scale" }, ...[1, 2, 3].map((s) => h("option", { value: s, selected: s === 2 }, `${s}x`)));
    body.append(
      tabs,
      pre,
      row(
        h("button", { type: "button", class: "ins-btn", title: "Copy as Tailwind (Alt T)", onClick: () => copyText(asTailwind(store, nodes), "Tailwind") }, "Copy Tailwind"),
        h("button", { type: "button", class: "ins-btn", onClick: () => copyText(asReactCss(store, nodes), "React CSS") }, "Copy React CSS"),
      ),
      row(
        scale,
        h("button", { type: "button", class: "ins-btn", title: "Copy as PNG (Mod Shift C)", onClick: async () => {
          try {
            const blob = await nodePng(nodes[0], Number(scale.value));
            await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
            say("Copied PNG");
          } catch (error) {
            say(error.message);
          }
        } }, "Copy PNG"),
        h("button", { type: "button", class: "ins-btn", onClick: async () => {
          try {
            for (const node of nodes) {
              const blob = await nodePng(node, Number(scale.value));
              const a = h("a", { href: URL.createObjectURL(blob), download: `${node.name}@${scale.value}x.png` });
              a.click();
              setTimeout(() => URL.revokeObjectURL(a.href), 1000);
            }
            say("Saved");
          } catch (error) {
            say(error.message);
          }
        } }, "Export"),
      ),
      status,
    );
  },
});
