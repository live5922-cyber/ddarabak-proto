// judge.js · 판정. 시각은 모두 '들리는 곡 시각'(초). 지연 보정은 누른 시각에서 뺌.
// 시작값(기획안 v0.5 6절): PERFECT ±45ms · GREAT ±90 · GOOD ±135 · MISS(눌렀음) ±135~200 · 안 누르고 지나가면 MISS
export const WIN = { PERFECT: 0.045, GREAT: 0.090, GOOD: 0.135, MISS: 0.200 };
export const RANKS = ['PERFECT', 'GREAT', 'GOOD', 'MISS'];

export function classify(delta) {
  const a = Math.abs(delta);
  if (a <= WIN.PERFECT) return 'PERFECT';
  if (a <= WIN.GREAT) return 'GREAT';
  if (a <= WIN.GOOD) return 'GOOD';
  if (a <= WIN.MISS) return 'MISS';
  return null;
}

export function createJudge(ch) {
  const J = {
    ch,
    counts: { PERFECT: 0, GREAT: 0, GOOD: 0, MISS: 0 },
    combo: 0, maxCombo: 0, missRun: 0,
    log: [],                 // { id, k, t, delta, res, how }
    gagBars: new Set(),      // 이 받는 마디에서 개그를 이미 했는지
  };
  for (const n of ch.notes) { n.judged = false; n.res = null; n.delta = 0; n.tJudged = 0; }

  // 누름: side 'L'|'R', tPress = 들리는 곡 시각 − 보정
  J.press = (side, tPress) => {
    let best = null, bestA = Infinity;
    for (const n of ch.notes) {
      if (n.judged || n.btn !== side) continue;
      const d = tPress - n.t;
      if (d < -WIN.MISS) break;               // 노트는 시각순 → 더 뒤는 볼 필요 없음
      const a = Math.abs(d);
      if (a <= WIN.MISS && a < bestA) { best = n; bestA = a; }
    }
    if (!best) return null;
    const delta = tPress - best.t;
    return J.mark(best, classify(delta), delta, 'press', tPress);
  };

  J.mark = (n, res, delta, how, tNow) => {
    n.judged = true; n.res = res; n.delta = delta; n.tJudged = tNow;
    J.counts[res]++;
    if (res === 'MISS') { J.combo = 0; J.missRun++; }
    else { J.combo++; J.missRun = 0; if (J.combo > J.maxCombo) J.maxCombo = J.combo; }
    const r = { note: n, res, delta, how };
    J.log.push({ id: n.id, k: n.k, t: n.t, delta: Math.round(delta * 1000), res, how });
    return r;
  };

  // 지나간 노트를 MISS로. 새로 생긴 MISS 목록을 돌려줌
  J.sweep = (tNow, out) => {
    out.length = 0;
    for (const n of ch.notes) {
      if (n.t > tNow) break;
      if (!n.judged && tNow - n.t > WIN.MISS) out.push(J.mark(n, 'MISS', tNow - n.t, 'pass', tNow));
    }
    return out;
  };

  // 받는 마디에서 첫 MISS만 개그. MISS 3번 이어지면 개그 쉼(기획안 6절)
  J.wantGag = n => {
    if (J.missRun >= 3) return false;
    if (J.gagBars.has(n.bar)) return false;
    J.gagBars.add(n.bar);
    return true;
  };

  J.done = () => ch.notes.every(n => n.judged);
  J.goodOrBetter = () => J.counts.PERFECT + J.counts.GREAT + J.counts.GOOD;
  return J;
}
