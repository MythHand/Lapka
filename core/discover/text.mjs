/* ═══════════════════════════════════════════════════════════
   The text of an element, the way a person reads it.

   textContent glues the pieces of a card together: a duration, a
   number and a title in three spans come out as "23:5122 эпизодФинал",
   and 5122 looks like an episode number. Here every element boundary
   is a space, as it is on the screen.
   ═══════════════════════════════════════════════════════════ */
export function textOf(el) {
  const parts = [];
  const walk = node => {
    for (const n of node.childNodes || []) {
      if (n.nodeType === 3) parts.push(n.textContent);
      else if (n.nodeType === 1) { parts.push(' '); walk(n); parts.push(' '); }
    }
  };
  walk(el);
  return parts.join('').replace(/\s+/g, ' ').trim();
}
