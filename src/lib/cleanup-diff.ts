export interface DiffPart { text: string; changed: boolean }
/** Word/punctuation diff. Bound the matrix for the playground's 128 KB inputs. */
export function cleanupDiff(original: string, result: string): { original: DiffPart[]; result: DiffPart[] } {
  const tokenize = (text: string) => text.match(/\s+|[\p{L}\p{N}_]+|[^\s]/gu) ?? [];
  const a = tokenize(original), b = tokenize(result);
  const foldedA = a.map(token => token.toLowerCase()), foldedB = b.map(token => token.toLowerCase());
  const compact = (parts: DiffPart[]) => parts.reduce<DiffPart[]>((groups, part) => {
    const last = groups[groups.length - 1];
    if (last && last.changed === part.changed) last.text += part.text;
    else groups.push({ ...part });
    return groups;
  }, []);
  if (a.length > 400 || b.length > 400) {
    let start = 0, end = 0;
    while (start < a.length && start < b.length && foldedA[start] === foldedB[start]) start++;
    while (end < a.length - start && end < b.length - start && foldedA[a.length - 1 - end] === foldedB[b.length - 1 - end]) end++;
    const parts = (tokens: string[], resultSide = false) => tokens.map((text, index) => ({
      text,
      changed: index >= start && index < tokens.length - end || resultSide && text !== a[index < start ? index : a.length - (b.length - index)],
    }));
    return { original: compact(parts(a)), result: compact(parts(b, true)) };
  }
  const rows = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) rows[i][j] = foldedA[i] === foldedB[j] ? rows[i + 1][j + 1] + 1 : Math.max(rows[i + 1][j], rows[i][j + 1]);
  const before: DiffPart[] = [], after: DiffPart[] = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && foldedA[i] === foldedB[j]) {
      before.push({ text: a[i], changed: false });
      after.push({ text: b[j], changed: a[i] !== b[j] });
      i++; j++;
    }
    else if (j < b.length && (i === a.length || rows[i][j + 1] >= rows[i + 1][j])) after.push({ text: b[j++], changed: true });
    else before.push({ text: a[i++], changed: true });
  }
  return { original: compact(before), result: compact(after) };
}
