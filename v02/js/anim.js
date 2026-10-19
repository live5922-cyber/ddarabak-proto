// anim.js · 동작 이어 그림(스톱모션식) 넘기기
// - 칸 = assets/anim.json 의 아틀라스 조각. 기준점 = 발 가운데(footX), 발 기준선(baseY), 뜬 높이(lift).
// - 모든 칸 넘김은 곡 시계(박 위상)로 정함 → 60·120Hz에서 같고, 되감아도 같은 칸.
// - 우선순위: 끝 > 지금 덧붙인 동작(치기·반응·콤보·놀람) > 누르고 있기 > 다음 노트 예비(ready·wind) > 들을 때 박 타기.
export function createAnimLib(json, atlasImgs, shadowOf) {
  const lib = { cssPerPx: json.cssPerPx, motions: {}, atlases: atlasImgs, shadows: atlasImgs.map(shadowOf) };
  for (const name in json.motions) {
    const fr = {}; const order = [];
    for (const f of json.motions[name]) { fr[f.key] = f; order.push(f.key); }
    lib.motions[name] = { name, frames: fr, order };
  }
  return lib;
}

function hash(n) { let x = Math.sin(n * 91.345 + 7.13) * 43758.5453; return x - Math.floor(x); }

export function createAnimator(lib, M, who) {
  const A = { who, clips: [], cur: null, curT: -1e9, motionT: -1e9, changes: [], stills: 0, lastKey: null, maxStill: 0, lastChangeT: null, durs: [] };
  // 같은 동작 연속 금지(같은 묶음 안에서): seed 로 정해 되감아도 같은 결과
  A.pickFrom = function (list, seed, prev) {
    const pool = list.filter(m => lib.motions[m] && m !== prev);
    const use = pool.length ? pool : list.filter(m => lib.motions[m]);
    if (!use.length) return null;
    return use[Math.floor(hash(seed) * use.length) % use.length];
  };
  A.frame = function (motion, key) {
    const m = lib.motions[motion]; if (!m) return null;
    return m.frames[key] || null;
  };
  // 덧붙임 동작: frames = [[칸, 시각(곡 초), 동작(없으면 motion)]], t1 = 끝 — v0.3 고침: 칸마다 다른 동작의 핵심 칸을 섞어 씀
  A.add = function (kind, t0, t1, motion, frames, extra) {
    if (!lib.motions[motion]) return;
    A.clips = A.clips.filter(c => c.kind === 'card' || (c.t1 > t0 - 4 && !(c.kind === kind && c.t0 >= t0 - 1e-4)));
    A.clips.push(Object.assign({ kind, t0, t1, motion, frames: frames.filter(f => lib.motions[f[2] || motion] && lib.motions[f[2] || motion].frames[f[0]]) }, extra || {}));
  };
  A.cancel = function (kind, after) { A.clips = A.clips.filter(c => !(c.kind === kind && c.t0 >= after)); };
  A.clear = function () { A.clips.length = 0; };
  A.active = function (t) {
    let best = null;
    for (const c of A.clips) if (t >= c.t0 && t < c.t1 && (!best || c.t0 >= best.t0)) best = c;
    if (!best) return null;
    let key = null, mo = best.motion; for (const f of best.frames) if (t >= f[1]) { key = f[0]; mo = f[2] || best.motion; }
    return key ? { motion: mo, key, kind: best.kind, arc: best.arc || null } : null;
  };
  // 칸 바뀜 기록(시험: 몸 옆 튐·같은 그림 멈춤)
  // noStat = 메뉴 뒤 화면(시계가 곡 시계가 아님) → 칸만 바꾸고 셈은 안 함
  A.note = function (t, sel, x, beatLen, noStat) {
    const id = sel ? sel.motion + ':' + sel.key : 'none';
    if (id !== A.lastKey) {
      if (!noStat && A.lastChangeT != null && t > A.lastChangeT) { A.maxStill = Math.max(A.maxStill, (t - A.lastChangeT) / beatLen); if (A.cur && A.durs.length < 4000) A.durs.push({ kind: A.cur.kind, key: A.cur.key, motion: A.cur.motion, ms: (t - A.lastChangeT) * 1000, t: +A.lastChangeT.toFixed(2) }); }
      if (!noStat && A.cur && sel) {
        const f0 = A.frame(A.cur.motion, A.cur.key), f1 = A.frame(sel.motion, sel.key);
        if (f0 && f1 && A.changes.length < 4000) A.changes.push({ t, foot: 0, body: Math.abs((f1.bodyX - f1.footX) - (f0.bodyX - f0.footX)) * lib.cssPerPx * (A.scale || 1) });
      }
      if (!A.cur || !sel || A.cur.motion !== sel.motion || sel.key === 'hit') A.motionT = t;   // 큰 바뀜(동작이 바뀌거나 치기)만 종이 흔들림
      A.lastKey = id; A.cur = sel; A.curT = t; A.lastChangeT = t;
    }
  };
  A.resetStats = function () { A.changes.length = 0; A.durs.length = 0; A.maxStill = 0; A.lastChangeT = null; A.lastKey = null; };
  return A;
}

// 박 위상으로 들을 때 칸 고르기: per = 칸 하나 길이(박), order 순서. A1·A2 = 16분마다(박 위가 첫 칸), A3 = 8분마다(2박 한 바퀴)
// durs = 칸마다 길이(박) — 포즈에서 포즈로(명세 6절): 박 위 핵심 포즈는 길게(0.375), 사이 칸은 짧게(0.125). 한 바퀴는 박 위에서 시작
export function idleFrame(spec, beatPos) {
  if (spec.durs) {
    const cyc = spec.durs.reduce((a, b) => a + b, 0);
    let x = ((beatPos % cyc) + cyc) % cyc + 1e-6;
    for (let i = 0; i < spec.durs.length; i++) { if (x < spec.durs[i]) return spec.order[i]; x -= spec.durs[i]; }
    return spec.order[spec.order.length - 1];
  }
  const per = spec.per, n = spec.order.length;
  const k = Math.floor(beatPos / per + 1e-6);
  return spec.order[((k % n) + n) % n];
}
