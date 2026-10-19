// judge.js · 판정 v0.2 (research/jp/2026-10-18_chart_design.md 3-2·3-4·8-3절)
// - 누른 쪽 노트만 봄. GOOD 창 안 아직 안 친 노트 가운데 가장 이른 것(osu!mania·태고 방식).
// - GOOD 창은 같은 쪽 이웃 노트 간격의 절반을 넘지 않음(8분 244ms → ±122).
// - GOOD 창 밖 늦은 누름(+good ~ +lateMiss) = 그 노트 MISS(눌렀음). 더 이른 누름 = 빈 터치(벌 없음, 정확하게는 MISS).
// - 누르고 있기: 머리 = 톡과 같은 창. 끝 holdEarlyRelease 전부터 떼면 그대로, 끝을 넘겨 눌러도 됨(끝에서 자동 완료),
//   엄지가 holdGap 안 들렸다 닿으면 이어 줌, 머리를 놓쳐도 길이 절반 전에 누르면 GOOD(정확하게는 없음).
// - 마구 누르기: 한 노트 GOOD 창 안에서 같은 쪽 3번 이상 누르면 그 노트 최고 GOOD.
// 시각은 모두 초. 판정 시각 = 들린 시각 − 지연 보정.
const RANK = { PERFECT: 3, GREAT: 2, GOOD: 1, MISS: 0 };
const NAME = ['MISS', 'GOOD', 'GREAT', 'PERFECT'];

// opts: { echoes: [초] 따라 친 글자 자리, beat: 평균 박(초), noMash·noEcho: 시험 비교용으로 규칙 끔 }
export function createJudge(notes, P, opts) {
  opts = opts || {};
  const echoes = (opts.echoes || []).map(t => ({ t, used: false })), BEAT = opts.beat || 0.49;
  const ms = x => x / 1000;
  const W = { perfect: ms(P.perfect), great: ms(P.great), good: ms(P.good), late: ms(P.lateMiss),
    early: P.earlyMiss == null ? null : ms(P.earlyMiss), relEarly: ms(P.holdEarlyRelease), gap: ms(P.holdGap),
    lateGrab: !!P.holdLateGrab, mash: P.mashPresses || 3 };
  // 이웃 간격으로 창 자르기
  for (const side of ['L', 'R']) {
    const arr = notes.filter(n => n.side === side).sort((a, b) => a.t - b.t);
    for (let i = 0; i < arr.length; i++) {
      const n = arr[i], prev = arr[i - 1], next = arr[i + 1];
      const prevEnd = prev ? (prev.end || prev.t) : -1e9;
      n.winE = Math.min(W.good, (n.t - prevEnd) / 2);
      n.winL = Math.min(W.good, next ? (next.t - (n.end || n.t)) / 2 : W.good);
      n.winLate = W.late;   // 늦은 MISS 띠. 다음 노트 GOOD 창과 겹치면 다음 노트가 먼저(press 에서 GOOD 창을 먼저 봄)
      // '빠름/느림' 딱지는 앞뒤 같은 쪽 노트가 둘 다 1박 넘게 떨어진 노트에만(리듬 검토 10-19 I4)
      n.fsOK = (!prev || n.t - prevEnd > BEAT * 0.99) && (!next || next.t - (n.end || n.t) > BEAT * 0.99);
    }
  }
  const J = {
    notes, W, combo: 0, maxCombo: 0, log: [],
    counts: { PERFECT: 0, GREAT: 0, GOOD: 0, MISS: 0 },
    presses: { L: [], R: [] }, raw: { L: [], R: [] }, empty: { L: [], R: [] }, holding: { L: null, R: null }, emptyCount: 0, echoCount: 0,
  };
  function grade(d) { const a = Math.abs(d); return a <= W.perfect ? 'PERFECT' : a <= W.great ? 'GREAT' : 'GOOD'; }
  function finish(n, res, how, extra) {
    n.judged = true; n.res = res;
    J.counts[res]++;
    if (res === 'MISS') J.combo = 0; else { J.combo++; if (J.combo > J.maxCombo) J.maxCombo = J.combo; }
    const rec = Object.assign({ id: n.id, k: n.k, side: n.side, type: n.type, t: n.t, delta: n.delta, res, how }, extra || {});
    J.log.push(rec);
    return Object.assign({ note: n, res, how, delta: n.delta, final: true }, extra || {});
  }

  // 누름 → 결과 { note, res, how:'press'|'head'|'regrab'|'lategrab', delta, final } 또는 null(빈 터치)
  J.press = function (side, tp) {
    J.raw[side].push(tp);
    // 누르고 있기 이어 주기(한 길게에 2번까지 — 마구 누르기로 끝까지 버티지 못하게)
    const h = J.holding[side];
    if (h && h.hold.released != null && tp - h.hold.released <= W.gap && (h.hold.regrabs || 0) < 2) { h.hold.released = null; h.hold.regrabs = (h.hold.regrabs || 0) + 1; return { note: h, res: h.hold.headRes, how: 'regrab', final: false }; }
    let best = null;
    for (const n of notes) {
      if (n.judged || n.side !== side || n.hold && n.hold.active) continue;
      if (tp >= n.t - n.winE && tp <= n.t + n.winL) { best = n; break; }   // notes 는 시각 순 → 가장 이른 것
    }
    // 따라 친 글자(보기 글자·말풍선 꼬리 ±120ms, 노트 창 밖): 글자마다 한 번 흡수 → 벌·마구 누르기 셈 없음(리듬 검토 10-19 C1)
    if (!best && !opts.noEcho) {
      for (const e of echoes) if (!e.used && Math.abs(tp - e.t) <= 0.12) { e.used = true; J.echoCount++; return { note: null, res: null, how: 'echo', final: false }; }
    }
    const pr = J.presses[side]; const prev = pr.length ? pr[pr.length - 1] : -1e9; pr.push(tp); while (pr.length > 8) pr.shift();
    if (best) {
      const n = best; n.delta = tp - n.t;
      let res = grade(n.delta);
      // 마구 누르기(리듬 검토 C1): 이 노트 앞 0.35초 안 같은 쪽 빈 터치가 2번 넘으면 최고 GOOD
      const em = J.empty[side].filter(x => x >= n.t - 0.35 && x < tp).length;
      if (!opts.noMash && em >= 2 && RANK[res] > RANK.GOOD) res = 'GOOD';
      const fs = !!n.fsOK;
      if (n.type === 'hold') {
        n.hold = { active: true, headRes: res, released: null, ticks: 0 };
        J.holding[side] = n;
        return { note: n, res, how: 'head', delta: n.delta, final: false, fastSlow: fs };
      }
      return Object.assign(finish(n, res, 'press'), { fastSlow: fs });
    }
    // 머리를 놓친 길게: 길이 절반 전이면 GOOD으로 잡음
    if (W.lateGrab) {
      for (const n of notes) {
        if (n.judged || n.side !== side || n.type !== 'hold' || (n.hold && n.hold.active)) continue;
        if (tp > n.t + n.winL && tp < n.t + (n.end - n.t) / 2) {
          n.delta = tp - n.t; n.hold = { active: true, headRes: 'GOOD', released: null, ticks: 0, late: true };
          J.holding[side] = n;
          return { note: n, res: 'GOOD', how: 'lategrab', delta: n.delta, final: false };
        }
      }
    }
    // 마구 누르기: 바로 앞 같은 쪽 누름이 300ms 안이고 이번 누름이 노트 −200 ~ −GOOD 띠면 그 노트를 MISS로 써 버림(태고·osu!mania처럼 이른 누름이 노트를 소모)
    // v0.3 검토 C1: 바로 앞 누름도 빈 터치였을 때만(따라 친 글자·맞힌 노트 뒤 누름은 소모 안 함)
    const em0 = J.empty[side];
    if (!opts.noMash && tp - prev < 0.3 && em0.length && em0[em0.length - 1] === prev) {
      for (const n of notes) {
        if (n.judged || n.side !== side || (n.hold && n.hold.active)) continue;
        if (tp >= n.t - 0.2 && tp < n.t - n.winE) { n.delta = tp - n.t; return finish(n, 'MISS', 'early-mash'); }
        if (n.t - 0.2 > tp) break;
      }
    }
    // 늦은 MISS(눌렀음) · 정확하게의 이른 MISS
    for (const n of notes) {
      if (n.judged || n.side !== side || (n.hold && n.hold.active)) continue;
      if (tp > n.t + n.winL && tp <= n.t + n.winLate && n.type !== 'hold') { n.delta = tp - n.t; return finish(n, 'MISS', 'late'); }
      if (W.early != null && tp < n.t - n.winE && tp >= n.t - W.early) { n.delta = tp - n.t; return finish(n, 'MISS', 'early'); }
    }
    J.empty[side].push(tp); if (J.empty[side].length > 16) J.empty[side].shift(); J.emptyCount++;
    return null;
  };

  // 뗌 → 결과(끝 판정) 또는 null
  J.release = function (side, tr) {
    const n = J.holding[side];
    if (!n || n.judged || !n.hold || n.hold.released != null) return null;
    if (tr >= n.end - W.relEarly) { J.holding[side] = null; n.hold.active = false; return finish(n, n.hold.headRes, 'release', { relDelta: tr - n.end, ok: true }); }
    n.hold.released = tr;   // 이어 주기 시간을 기다림(sweep 에서 정함)
    return { note: n, res: null, how: 'lift', final: false };
  };

  // 매 프레임: 지나간 노트 MISS, 길게 끝 자동 완료, 이어 주기 시간이 지난 일찍 뗌
  J.sweep = function (t, out) {
    out.length = 0;
    for (const side of ['L', 'R']) {
      const n = J.holding[side];
      if (!n || n.judged) { J.holding[side] = null; continue; }
      if (n.hold.released != null) {
        if (t - n.hold.released > W.gap) {
          const frac = (n.hold.released - n.t) / (n.end - n.t);
          let res = n.hold.headRes;
          if (W.early != null && frac < 0.5) res = 'MISS';
          else if (frac < 0.5) res = 'GOOD';
          else res = NAME[Math.max(1, RANK[res] - 1)];
          J.holding[side] = null; n.hold.active = false;
          out.push(finish(n, res, 'early-release', { relDelta: n.hold.released - n.end, ok: false }));
        }
      } else if (t >= n.end) {
        J.holding[side] = null; n.hold.active = false;
        out.push(finish(n, n.hold.headRes, 'auto', { relDelta: 0, ok: true }));
      }
    }
    for (const n of notes) {
      if (n.judged || (n.hold && n.hold.active)) continue;
      const lim = n.type === 'hold' ? (W.lateGrab ? n.t + (n.end - n.t) / 2 : n.t + n.winL) : n.t + W.late + 0.05;   // 늦게 도착한 누름 이벤트를 먼저 받게 50ms 여유(리듬 검토 S7)
      if (t > lim) { n.delta = null; out.push(finish(n, 'MISS', 'pass')); }
      else if (n.t > t + 1) break;
    }
    return out;
  };
  // 일시정지 때 누르고 있던 것을 그 자리에서 마무리(되감아 이어 할 때 길게가 걸려 있지 않게)
  J.forceRelease = function (t) {
    const out = [];
    for (const side of ['L', 'R']) {
      const n = J.holding[side]; if (!n || n.judged) continue;
      if (n.hold.released == null) n.hold.released = t;
      const rel = n.hold.released; J.holding[side] = null; n.hold.active = false;
      if (rel >= n.end - W.relEarly) { out.push(finish(n, n.hold.headRes, 'release', { relDelta: rel - n.end, ok: true })); continue; }
      const frac = (rel - n.t) / (n.end - n.t);
      const res = W.early != null && frac < 0.5 ? 'MISS' : frac < 0.5 ? 'GOOD' : NAME[Math.max(1, RANK[n.hold.headRes] - 1)];
      out.push(finish(n, res, 'early-release', { relDelta: rel - n.end, ok: false }));
    }
    return out;
  };
  J.goodOrBetter = () => J.counts.PERFECT + J.counts.GREAT + J.counts.GOOD;
  return J;
}
