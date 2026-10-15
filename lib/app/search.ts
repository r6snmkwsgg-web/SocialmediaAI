/**
 * Matching what someone types in the command palette: every word they
 * type has to appear in the command's name or its other words. Hits in
 * the name, and hits at the start of a word, rank higher.
 */
export function score(c: { label: string; words?: string }, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const label = c.label.toLowerCase();
  const all = `${label} ${c.words ?? ""}`.toLowerCase();
  let total = 0;
  for (const w of q.split(/\s+/)) {
    const i = all.indexOf(w);
    if (i < 0) return 0;
    const start = i === 0 || all[i - 1] === " " || all[i - 1] === ":";
    total += (i < label.length ? 3 : 1) + (start ? 2 : 0);
  }
  return total;
}
