// poses.js · 포즈 묶음(pose library)과 종이 인형(actor)
// - assets/poses.json: 포즈마다 인물(char)·상태(states)·그림·발 기준점. 상태 하나에 포즈가 여럿이면 그중 하나를 고름.
// - 같은 포즈가 두 번 연달아 나오지 않음(후보가 둘 이상일 때). 후보가 없으면 motion.json fallback 사슬을 따라감.
// - 포즈 바꾸기: flip(종이 뒤집기 160ms: 예비 눌림 → 90° → 그림 교체 → 90° → 튕김) · snap(그림 교체 + 눌림) · cut(그냥 교체)
// - 시간은 모두 곡 시계(초). 일시정지·되감기와 같이 움직임.
export function createPoseLib(list, images) {
  const byChar = {};
  for (const p of list) {
    p.img = images[p.id];
    const c = byChar[p.char] || (byChar[p.char] = { states: {}, all: [] });
    c.all.push(p);
    for (const s of p.states) (c.states[s] || (c.states[s] = [])).push(p);
  }
  return { byChar, list };
}

function rand(seed) { let x = Math.sin(seed * 12.9898) * 43758.5453; return x - Math.floor(x); }

export function createActor(lib, char, motion) {
  const C = lib.byChar[char] || { states: {}, all: [] };
  const fb = motion.fallback || {};
  const A = {
    char, cur: null, prev: null, state: null, kind: 'cut', t0: -1e9, picks: 0,
    queue: [],   // { at, state, kind }
    squashT: -1e9, squashKind: null,
  };
  function candidates(state) {
    let s = state, guard = 0;
    while (s && guard++ < 8) { if (C.states[s] && C.states[s].length) return C.states[s]; s = fb[s]; }
    return C.states.idle || C.all;
  }
  function pick(state) {
    const c = candidates(state);
    if (!c.length) return null;
    if (c.length === 1) return c[0];
    const pool = A.cur ? c.filter(p => p !== A.cur) : c;
    A.picks++;
    return pool[Math.floor(rand(A.picks * 7.31 + c.length) * pool.length) % pool.length];
  }
  // 지금 바로 바꿈
  A.set = function (state, t, kind) {
    const p = pick(state);
    A.state = state;
    if (!p) return;
    if (p === A.cur) { if (kind === 'snap') { A.squashT = t; } return; }
    A.prev = A.cur; A.cur = p; A.kind = A.prev ? (kind || 'cut') : 'cut'; A.t0 = t;
    if (kind === 'snap') A.squashT = t;
  };
  // 정한 시각에 바꿈(뒤집기는 끝이 그 시각에 오게 미리 시작)
  A.at = function (t, state, kind) {
    const lead = kind === 'flip' ? (motion.flip.ms / 1000) : 0;
    A.queue.push({ at: t - lead, state, kind });
    A.queue.sort((a, b) => a.at - b.at);
  };
  A.clearQueue = function () { A.queue.length = 0; };
  A.update = function (t) {
    while (A.queue.length && A.queue[0].at <= t) { const q = A.queue.shift(); A.set(q.state, q.at, q.kind); }
  };
  A.reset = function (state) { A.cur = null; A.prev = null; A.queue.length = 0; A.t0 = -1e9; A.squashT = -1e9; A.set(state || 'idle', -1e9, 'cut'); };
  // 그림·뒤집기 상태: { img pose, sx(가로 배율), sy(세로 배율) }
  A.look = function (t) {
    const F = motion.flip, dt = (t - A.t0) * 1000;
    let pose = A.cur, sx = 1, sy = 1;
    if (A.kind === 'flip' && A.prev) {
      const half = F.ms / 2;
      if (dt < 0) { pose = A.prev; }
      else if (dt < half) { pose = A.prev; sx = Math.cos((dt / half) * Math.PI / 2); sy = F.anticipateSy; }
      else if (dt < F.ms) { sx = Math.sin(((dt - half) / half) * Math.PI / 2); }
      else if (dt < F.ms + F.overshootMs) { const u = (dt - F.ms) / F.overshootMs; sy = 1 + (F.overshootSy - 1) * Math.sin(u * Math.PI); }
      if (dt >= -F.anticipateMs && dt < 0) sy = F.anticipateSy;
      sx = Math.max(0.04, sx);
    }
    return { pose, sx, sy };
  };
  return A;
}
