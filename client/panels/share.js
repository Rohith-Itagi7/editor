// Share: a popup under the Share button with a select for who can open the file, and a Copy link button that
// also answers to ⌘L (Ctrl+L). There are no teams, so the choices are "Anyone with the link" and "Only you".
// The link is /f/<id>.
import { PANEL_ICONS } from "../ui/icons/panel.js";
import { toast } from "../ui/toast.js";

const CHOICES = [["link", "Anyone with the link can access"], ["private", "Only you can access"]];

export function mountShare(button, { link, access, setAccess }) {
  let chosen = access;

  const popup = document.createElement("div");
  popup.className = "share-popup";
  popup.hidden = true;
  popup.innerHTML = `
    <label class="share-field"><span class="share-lock"></span>
      <select aria-label="Who can open this file">${CHOICES.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select>
    </label>
    <button type="button" class="share-copy">Copy link<span>⌘L</span></button>`;
  document.body.append(popup);
  const select = popup.querySelector("select");
  const lock = popup.querySelector(".share-lock");

  // A lock shows when only the owner can open the file.
  function showChoice() {
    select.value = chosen;
    lock.innerHTML = chosen === "private" ? PANEL_ICONS.lock : "";
  }
  showChoice();

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      toast("Link copied to clipboard");
    } catch (error) {
      toast("Could not copy the link");
      console.error(error);
    }
  }
  popup.querySelector(".share-copy").addEventListener("click", copyLink);

  // The new choice shows at once and goes to the server; if that fails the old one comes back.
  select.addEventListener("change", async () => {
    const previous = chosen;
    chosen = select.value;
    showChoice();
    try {
      await setAccess(chosen);
    } catch (error) {
      chosen = previous;
      showChoice();
      toast("Could not change who can open the file");
      console.error(error);
    }
  });

  // ---------- Opening and closing ----------
  const close = () => { popup.hidden = true; };
  button.addEventListener("click", () => {
    if (!popup.hidden) return close();
    const box = button.getBoundingClientRect();
    popup.style.top = `${box.bottom + 6}px`;
    popup.style.right = `${innerWidth - box.right - 8}px`;
    popup.hidden = false;
  });
  addEventListener("pointerdown", (event) => {
    const outside = !popup.contains(event.target) && !button.contains(event.target);
    if (!popup.hidden && outside) close();
  });
  addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !popup.hidden) return close();
    const isCopyShortcut = (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "l";
    if (isCopyShortcut) {
      event.preventDefault();
      copyLink();
    }
  });
}
