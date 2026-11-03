// A short message at the bottom of the window, ("Link copied to clipboard").
export function toast(text) {
  const el = Object.assign(document.createElement("div"), { className: "toast", textContent: text });
  document.body.append(el);
  setTimeout(() => el.remove(), 2200);
}
