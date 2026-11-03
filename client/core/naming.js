// Names that must not repeat: a new page, a new token, a copy.

/**
 * `base` if it is free, else the first free name among nameFor(2), nameFor(3), ... ("Untitled", "Untitled 2", ...).
 * `isTaken(name)` says whether a name is in use.
 */
export function freeName(isTaken, base, nameFor = (n) => `${base} ${n}`) {
  if (!isTaken(base)) return base;
  for (let n = 2; ; n++) {
    const name = nameFor(n);
    if (!isTaken(name)) return name;
  }
}
