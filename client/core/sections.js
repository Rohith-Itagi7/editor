// The design panel is a list of sections. Each module that owns a kind of node or property
// registers its section here; the panel renders the ones that apply to the selection, in order.
//
// registerSection({
//   id, title, order,                 // order: lower comes first
//   appliesTo(nodes, store) -> bool,  // nodes: the selected nodes
//   render(container, nodes, store),  // fill `container`; write only inside store.transact
// })

const sections = [];

export function registerSection(section) {
  const at = sections.findIndex((s) => s.id === section.id);
  if (at >= 0) sections.splice(at, 1);
  sections.push(section);
  sections.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

export function sectionsFor(nodes, store) {
  return sections.filter((s) => s.appliesTo(nodes, store));
}
