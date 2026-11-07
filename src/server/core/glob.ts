/**
 * Minimal, deterministic glob matcher: `*` matches any run of characters (including none).
 * Matching is case-insensitive and anchored. No regex input is accepted from policies.
 */
export function globMatch(pattern: string, value: string): boolean {
  const p = pattern.toLowerCase();
  const v = value.toLowerCase();
  const parts = p.split("*");
  if (parts.length === 1) return p === v;
  let pos = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i === 0) {
      if (!v.startsWith(part)) return false;
      pos = part.length;
      continue;
    }
    if (i === parts.length - 1) {
      return part === "" || (v.length - part.length >= pos && v.endsWith(part));
    }
    const idx = v.indexOf(part, pos);
    if (idx === -1) return false;
    pos = idx + part.length;
  }
  return true;
}

export function matchesAny(patterns: string[], value: string): boolean {
  return patterns.some((p) => globMatch(p, value));
}
