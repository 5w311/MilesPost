// Fuzzy matching for search-as-you-type lists.
//
// Characters of the query must appear in order in the text. Among all ways to
// line them up, we pick the best-scoring one (dynamic programming), rewarding
// matches at the start of words and runs of consecutive characters, and
// lightly penalizing gaps. Returns the matched indices for highlighting.

const BOUNDARY = /[\s\-_/.:,()[\]]/;

function bonusAt(text, raw, j) {
  if (j === 0) return 8;
  const prev = text[j - 1];
  if (BOUNDARY.test(prev)) return 6;
  // camelCase hump: "openFile" -> F
  const before = raw[j - 1];
  const here = raw[j];
  if (before && here && before === before.toLowerCase() && here !== here.toLowerCase()) return 5;
  // letter after a digit or digit after a letter ("I75" -> 7)
  if (/\d/.test(here) !== /\d/.test(before)) return 3;
  return 0;
}

/**
 * Score `query` against `text`.
 * @returns {{ score: number, indices: number[] } | null} null when it doesn't match.
 */
export function fuzzyMatch(query, raw) {
  const q = String(query ?? '').trim().toLowerCase();
  const source = String(raw ?? '');
  const t = source.toLowerCase();
  if (!q) return { score: 0, indices: [] };
  const n = q.length;
  const m = t.length;
  if (n > m) return null;

  // Fast reject: every query char must exist in order.
  for (let i = 0, j = 0; i < n; i++, j++) {
    j = t.indexOf(q[i], j);
    if (j === -1) return null;
  }

  const NEG = -1e9;
  // best[i][j]: best score with q[i] matched at t[j]; from[i][j]: where q[i-1] matched.
  const best = Array.from({ length: n }, () => new Float64Array(m).fill(NEG));
  const from = Array.from({ length: n }, () => new Int32Array(m).fill(-1));

  for (let j = 0; j < m; j++) {
    if (t[j] === q[0]) best[0][j] = 1 + bonusAt(t, source, j) - j * 0.05;
  }
  for (let i = 1; i < n; i++) {
    // Running best of (best[i-1][k] + 0.1*(k+1)) for k < j-1, so the gap
    // penalty 0.1*(j-k-1) can be applied in O(1).
    let run = NEG;
    let runK = -1;
    for (let j = 1; j < m; j++) {
      if (j >= 2) {
        const k = j - 2;
        const cand = best[i - 1][k] + 0.1 * (k + 1);
        if (best[i - 1][k] > NEG && cand > run) { run = cand; runK = k; }
      }
      if (t[j] !== q[i]) continue;
      const base = 1 + bonusAt(t, source, j);
      const consecutive = best[i - 1][j - 1] > NEG ? best[i - 1][j - 1] + 5 : NEG;
      const gapped = run > NEG ? run - 0.1 * j : NEG;
      if (consecutive >= gapped && consecutive > NEG) {
        best[i][j] = base + consecutive;
        from[i][j] = j - 1;
      } else if (gapped > NEG) {
        best[i][j] = base + gapped;
        from[i][j] = runK;
      }
    }
  }

  let end = -1;
  let score = NEG;
  for (let j = 0; j < m; j++) {
    if (best[n - 1][j] > score) { score = best[n - 1][j]; end = j; }
  }
  if (end === -1) return null;

  const indices = new Array(n);
  for (let i = n - 1, j = end; i >= 0; i--) {
    indices[i] = j;
    j = from[i][j];
  }

  // Whole-text and prefix matches beat everything else.
  if (t === q) score += 100;
  else if (t.startsWith(q)) score += 20;
  // Shorter texts win ties.
  score -= m * 0.01;
  return { score, indices };
}

/**
 * Rank items. `fields(item)` returns [primaryText, ...secondaryTexts].
 * Secondary matches (keywords) count at 70% and contribute no highlight.
 */
export function fuzzyRank(query, items, fields) {
  const out = [];
  for (const item of items) {
    const [primary, ...rest] = fields(item);
    const hit = fuzzyMatch(query, primary);
    let score = hit ? hit.score : -Infinity;
    for (const extra of rest) {
      if (!extra) continue;
      const alt = fuzzyMatch(query, extra);
      if (alt && alt.score * 0.7 > score) score = alt.score * 0.7;
    }
    if (score > -Infinity) out.push({ item, score, indices: hit ? hit.indices : [] });
  }
  return out.sort((a, b) => b.score - a.score);
}
