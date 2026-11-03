// A PDF of pictures, one to a page: what export_combined_pdf makes (each node is held as a JPEG at its
// own size, not as vector shapes). No library: the file is a catalog,
// a list of pages, and for each page a picture and the line that draws it. Plain data in, bytes out, so
// it runs in the page and in a test.
const encoder = new TextEncoder();

/** pages: [{ width, height, jpeg: Uint8Array, pixelWidth?, pixelHeight? }] -> the PDF as a Uint8Array. Sizes are in px, taken as points. */
export function makePdf(pages) {
  if (!pages.length) throw new Error("A PDF needs a page");
  const parts = [];
  const offsets = [];
  let length = 0;
  const push = (chunk) => { const bytes = typeof chunk === "string" ? encoder.encode(chunk) : chunk; parts.push(bytes); length += bytes.length; };
  const object = (number, ...body) => { offsets[number] = length; push(`${number} 0 obj\n`); body.forEach(push); push("\nendobj\n"); };

  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  // 1: the catalog, 2: the pages; then for page i: 3 + 3i the page, 4 + 3i its drawing, 5 + 3i its picture.
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${3 + 3 * i} 0 R`).join(" ")}] >>`);
  pages.forEach((page, i) => {
    const w = Math.max(1, Math.round(page.width)), h = Math.max(1, Math.round(page.height));
    const draw = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    object(3 + 3 * i, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${5 + 3 * i} 0 R >> >> /Contents ${4 + 3 * i} 0 R >>`);
    object(4 + 3 * i, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
    offsets[5 + 3 * i] = length;
    push(`${5 + 3 * i} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.pixelWidth ?? w * 2} /Height ${page.pixelHeight ?? h * 2} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`);
    push(page.jpeg);
    push("\nendstream\nendobj\n");
  });
  const count = 3 + 3 * pages.length;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) push(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of parts) { out.set(chunk, at); at += chunk.length; }
  return out;
}
