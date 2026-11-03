// Play: runs the selected frame in a sandboxed iframe over the canvas, so media queries and
// vh behave as in a real page. The selected top-level frame is shown as its own page at its own size, in an
// iframe with every permission off. Elements here are flattened to inline styles and carry no scripts,
// so this shows how the frame lays out in a real viewport, not any behaviour.
import { tokenVariables } from "../core/tokens.js";
import { toast } from "../ui/toast.js";

export function mountPlay({ store, canvas }) {
  const overlay = Object.assign(document.createElement("div"), { className: "play", hidden: true });
  overlay.innerHTML = `<div class="play-bar"><span class="play-title"></span><button type="button">Close (Esc)</button></div><div class="play-stage"><iframe title="Preview" sandbox=""></iframe></div>`;
  document.body.append(overlay);
  const frame = overlay.querySelector("iframe");
  const stage = overlay.querySelector(".play-stage");

  const close = () => { overlay.hidden = true; frame.removeAttribute("srcdoc"); };
  overlay.querySelector("button").addEventListener("click", close);
  addEventListener("keydown", (event) => { if (event.key === "Escape" && !overlay.hidden) { event.stopPropagation(); close(); } }, true);

  function fit(width, height) {
    const room = stage.getBoundingClientRect();
    const scale = Math.min(1, room.width / width, room.height / height);
    Object.assign(frame.style, { width: `${width}px`, height: `${height}px`, transform: `scale(${scale})` });
  }

  return {
    play() {
      const selected = store.selection()[0];
      if (!selected) return toast("Select a frame to play");
      const root = store.get(store.rootOf(selected));
      const element = canvas.querySelector(`[data-node-id="${CSS.escape(root.id)}"]`);
      if (!element) return;
      const width = Math.round(element.getBoundingClientRect().width / store.ui.zoom) || 1440;
      const height = Math.round(element.getBoundingClientRect().height / store.ui.zoom) || 900;
      const vars = Object.entries(tokenVariables(store.tokens())).map(([name, value]) => `${name}:${value}`).join(";");
      frame.srcdoc = `<!doctype html><meta charset="utf-8"><style>:root{${vars}}html,body{margin:0}</style>${element.outerHTML}`;
      overlay.querySelector(".play-title").textContent = root.name;
      overlay.hidden = false;
      fit(width, height);
    },
  };
}
