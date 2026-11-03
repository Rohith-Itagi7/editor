// Placing images: choose image files (⇧⌘K), paste them, or drop them on the canvas. Each becomes an element, inside
// the one selected frame or else on the page. An SVG is placed as an image like the others, so it is not editable
// as shapes.
import { toast } from "../ui/toast.js";

const LONGEST_SIDE = 1200; // no placed image is larger than this
const GAP = 24;
const FALLBACK_SIZE = { width: 300, height: 200 }; // for a file the browser cannot measure

const SVG_START = /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i;

/** An SVG pasted as text becomes a file, so it is placed like any other image; null for text that is not an SVG. */
export const svgFile = (text) => (SVG_START.test(text ?? "") ? new File([text], "pasted.svg", { type: "image/svg+xml" }) : null);

/** The size an image file has by itself. */
function measureFile(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    const finish = (size) => { URL.revokeObjectURL(url); resolve(size); };
    image.onload = () => finish({ width: image.naturalWidth || FALLBACK_SIZE.width, height: image.naturalHeight || FALLBACK_SIZE.height });
    image.onerror = () => finish(FALLBACK_SIZE);
    image.src = url;
  });
}

export function mountImages({ store, view, canvas, upload }) {
  /** Uploads image files and puts them in the document. Answers false when none of the files is an image. */
  async function place(files) {
    const images = [...files].filter((file) => file.type.startsWith("image/"));
    if (!images.length) return false;
    if (store.readOnly) return true; // a visitor places nothing, but the paste or drop is still taken
    const placed = [];
    for (const file of images) {
      try {
        const [url, size] = await Promise.all([upload(file), measureFile(file)]);
        const shrink = Math.min(1, LONGEST_SIDE / Math.max(size.width, size.height));
        placed.push({ name: file.name, url, width: Math.round(size.width * shrink), height: Math.round(size.height * shrink) });
      } catch (error) {
        console.error(error);
        toast(`Could not place ${file.name}: ${error.message}`);
      }
    }
    if (placed.length) insert(placed);
    return true;
  }

  /** Elements for images that are already on the server: [{ name, url, width, height }]. */
  function insert(placed) {
    // Into the one selected frame, else side by side on the page, around the center of the view.
    const selected = store.selection().length === 1 ? store.get(store.selection()[0]) : null;
    const frame = selected?.component === "Frame" ? selected : null;
    const rowWidth = placed.reduce((sum, image) => sum + image.width, 0) + GAP * (placed.length - 1);
    const box = canvas.getBoundingClientRect();
    const { panX, panY, zoom } = store.ui;
    let x = Math.round((box.width / 2 - panX) / zoom - rowWidth / 2);
    const y = Math.round((box.height / 2 - panY) / zoom - Math.max(...placed.map((image) => image.height)) / 2);

    const ids = [];
    store.transact(placed.length > 1 ? "Place images" : "Place image", () => {
      for (const image of placed) {
        const element = {
          component: "Rectangle", name: image.name,
          style: { width: `${image.width}px`, height: `${image.height}px`, backgroundImage: `url("${image.url}")`, backgroundSize: "cover", backgroundPosition: "center" },
        };
        ids.push(store.insert(frame ? element : { ...element, x, y }, { parent: frame?.id ?? null }));
        x += image.width + GAP;
      }
    });
    store.select(ids);
  }

  // ⇧⌘K: a file chooser that exists only for this one use.
  function choose() {
    const input = Object.assign(document.createElement("input"), { type: "file", accept: "image/*", multiple: true });
    input.addEventListener("change", () => place(input.files));
    input.click();
  }

  canvas.addEventListener("dragover", (event) => { if (event.dataTransfer?.types.includes("Files")) event.preventDefault(); });
  canvas.addEventListener("drop", (event) => {
    if (!event.dataTransfer?.files.length) return;
    event.preventDefault();
    place(event.dataTransfer.files);
  });

  return { place, insert, choose };
}
