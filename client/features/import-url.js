// Import URL: the server fetches the
// page (server.mjs, /api/proxy) and it goes through the same path as pasted HTML, so what comes in
// is the page laid out at 1440px and flattened to elements, with no scripts. A pasted URL stays text,
// so this is a command (the canvas menu), not something ⌘V does.
import { pasteHtml } from "./import-html.js";
import { toast } from "../ui/toast.js";

export function mountImportUrl({ store, view }) {
  const dialog = Object.assign(document.createElement("form"), { className: "url-dialog", hidden: true });
  dialog.innerHTML = `<label>Import a web page<input type="text" inputmode="url" placeholder="https://example.com" aria-label="Page address" autocomplete="off"></label>
    <div class="url-actions"><button type="button" data-cancel>Cancel</button><button type="submit" class="primary">Import</button></div>`;
  document.body.append(dialog);
  const input = dialog.querySelector("input");
  const submit = dialog.querySelector('[type="submit"]');

  const close = () => { dialog.hidden = true; };
  dialog.querySelector("[data-cancel]").addEventListener("click", close);
  dialog.addEventListener("keydown", (event) => { event.stopPropagation(); if (event.key === "Escape") close(); });

  dialog.addEventListener("submit", async (event) => {
    event.preventDefault();
    let address = input.value.trim();
    if (!address) return;
    // No scheme: a site on this machine or a bare IP is http, as a browser's address bar takes it, any other https.
    if (!/^https?:\/\//i.test(address)) address = `${/^(localhost|\[::1\]|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/|$)/i.test(address) ? "http" : "https"}://${address}`;
    try {
      new URL(address);
    } catch {
      return toast("That is not a web address");
    }
    submit.disabled = true;
    submit.textContent = "Importing…";
    try {
      const response = await fetch(`/api/proxy?url=${encodeURIComponent(address)}`);
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? `The page answered ${response.status}`);
      if (!(response.headers.get("content-type") ?? "").includes("text/html")) throw new Error("That address is not a web page");
      const made = await pasteHtml(store, view, await response.text());
      if (!made) throw new Error("Nothing on that page could be imported");
      close();
      input.value = "";
    } catch (error) {
      console.error(error);
      toast(`Could not import: ${error.message}`);
    } finally {
      submit.disabled = false;
      submit.textContent = "Import";
    }
  });

  return {
    open() {
      if (store.readOnly) return;
      dialog.hidden = false;
      input.focus();
      input.select();
    },
  };
}
