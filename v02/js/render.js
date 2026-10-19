// render.js · 캔버스 그리기 v0.3(검토 고침 10-19) — 여행 수첩·필름 카메라 결(명세 docs/spec_v03.md 5절, 조사 research/jp/2026-10-19_ui_benchmark.md 3-0·3-1)
// 검토: research/jp/reviews/2026-10-19_v03_review_visual.md(V1~V21) · _rhythm_ux.md(C1·C2·I1~I8·S1~S8)
// 좌표는 아이폰 12 CSS px(폭 390). 위 묶음(리본·기차 노선·콤보·카드)은 위 안전 영역(T), 아래 묶음(발 선·필름 띠·수첩 바닥·버튼)은 아래 기준(B)에 붙임.
// 무대(배경 종이 판·인형)만 멈춤·흔들림·박 움직임. 노트·버튼·도장은 멈추거나 흔들지 않음.
// 인물(V1): 들을 때·쉴 때는 기본 그림 1장 + 코드 박 움직임(beatCurve·박마다 종이 휨), 사건(치기·길게·반응·점프)만 핵심 칸 1~2장.
// 장면 넘김(V2): 조연·트럭은 넘기기 1/2박 전에 발 축으로 눕고(팝업), 무대 판은 왼쪽 가장자리 축으로 원근 띠 24개로 넘어가고, 새 장면 첫 박에 조연이 일어섬.
import { settings, fadeAlpha } from './settings.js';
import { createActor } from './poses.js';
import { createAnimator } from './anim.js';

export const C = {
  navy: '#283A66', navyD: '#1B2745', tan: '#FF6C2F', paper: '#FFF8EC', cream: '#F3E4C8', paperD: '#C7DCF2', slate: '#8C96B4', slateD: '#656C82',
  sky: '#62A8E5', skyD: '#4779A5', crimson: '#F65058', apricot: '#F7C6A8', sun: '#FFB511', mint: '#82D8D5', line: '#A1C5DE', floor: '#E5D8C1', creamD: '#E3D6BE',
};
const PI = Math.PI, TAU = PI * 2;
const HIT_X = 72, SPEED = 295.1;   // V7: 맞춤 자리 72(고리가 화면 왼쪽 끝을 안 넘음). px/초 = 가장 짧은 박 488ms → 144px
const NOTE_R = 29, PAD_R = 48;     // V16 노트 지름 58(필름 띠 80 구멍 줄 안) · 버튼 지름 96(코디네이터 판단 10-19)
const F_GO = '"Gowun Dodum", "Pretendard Variable", Pretendard, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
const F_KANA = '"Klee One", "Hiragino Mincho ProN", "Yu Mincho", serif';
const F_DELA = '"Dela Gothic One", "Pretendard Variable", Pretendard, sans-serif';
// 판정 색: PERFECT 귤 + 해바라기 · GREAT 하늘 · GOOD 회청(V15 조각·도장 한 색) · MISS 회청 짙게
const GC = { PERFECT: { main: C.tan, sub: C.sun }, GREAT: { main: C.sky, sub: C.paper }, GOOD: { main: C.slate, sub: C.paperD }, MISS: { main: C.slateD, sub: C.slate } };
const SCENE_OF_BG = { p1: { id: 'station', bg: 'p1', cast: ['uncle'], lead: 'uncle', truck: true, t0: -1, f0: -2 }, p2: { id: 'odori', bg: 'p2', cast: ['stall'], lead: 'stall', t0: -1, f0: -2 },
  p3: { id: 'nijo', bg: 'p3', cast: ['crab'], lead: 'crab', t0: -1, f0: -2 }, p4: { id: 'lights', bg: 'p4', cast: ['crab', 'uncle', 'stall'], lead: 'uncle', t0: -1, f0: -2 } };
const IDLE_KINDS = new Set(['idle', 'listen', 'rest', 'watch', 'hold']);

let cv, g, dpr = 1, L = null, M = null, LIB = null, IMG = null, STG = null, AL = null, AM = null;
let pan = null, T = null, idleScene = SCENE_OF_BG.p1;
const bgCache = {};
let truck = null, HA = null, pageCv = null, pageG = null;
const CA = {};
const fx = [];
const snow = [];
const S = {
  chips: { L: null, R: null }, combo: 0, comboT: -9, pads: { L: { down: false, t: -9 }, R: { down: false, t: -9 } }, lastPress: { t: -9, side: 'L' },
  shutterT: -9, flashT: -9, freezeUntil: -9, freezeAt: 0, shakeUntil: -9, lastJ: null, endFx: null, pracMiss: null,
  endT: null, endShown: false, cells: {}, stampT: {}, holding: null, countFrom: null, countTo: null, rightOn: false,
  lastDrawMs: 0, tStage: -1e9, allowBack: true, demo: null, prac: null, hintOn: false,
};
export function getState() { return S; }
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const lerp = (a, b, v) => a + (b - a) * v;
function R(a, b) { let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
function seedOf(s) { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

// ── 준비 ─────────────────────────────
export function init(canvas, assets) {
  cv = canvas; g = cv.getContext('2d', { alpha: false });
  IMG = assets.images; STG = assets.stage; M = assets.motion; LIB = assets.lib; AL = assets.anim; AM = M.anim;
  for (const p of LIB.list) {
    if (!p.img) continue;
    const c = document.createElement('canvas'); c.width = p.w; c.height = p.h;
    const x = c.getContext('2d'); x.drawImage(p.img, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = C.navyD; x.fillRect(0, 0, p.w, p.h);
    p.shadow = c;
  }
  truck = createActor(LIB, 'truck', M); truck.reset('idle');
  HA = createAnimator(AL, M, 'hana');
  for (const who of ['uncle', 'stall', 'crab']) CA[who] = createAnimator(AL, M, who);
  for (let i = 0; i < M.snow.back + M.snow.front; i++) snow.push({ x: Math.random() * 420 - 15, ph: Math.random(), sw: Math.random() * PI * 2, rot: Math.random() * PI, front: i >= M.snow.back, sz: i >= M.snow.back ? 3 + Math.random() * 2 : 1.5 + Math.random() * 1.0 });
  resize();
}
export function animators() { return { HA, UA: CA.uncle, CA }; }
export function tintAtlas(img) {   // 아틀라스 그림자 판(남색 그늘)
  const c = document.createElement('canvas'); c.width = img.naturalWidth || img.width; c.height = img.naturalHeight || img.height;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = C.navyD; x.fillRect(0, 0, c.width, c.height);
  return c;
}
const castSpec = who => who === 'uncle' ? AM.uncle : AM[who];

// 배경 굽기: 3안 물림(값은 motion.json bgFilter) + 창 불빛 판 두 무리(Lab으로 고름, 반 해상도)
function srgbLin(v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
const LIN = new Float32Array(256); for (let i = 0; i < 256; i++) LIN[i] = srgbLin(i);
function lab(r, g2, b) {
  const Rr = LIN[r], G = LIN[g2], B = LIN[b];
  let X = (0.4124 * Rr + 0.3576 * G + 0.1805 * B) / 0.95047, Y = 0.2126 * Rr + 0.7152 * G + 0.0722 * B, Z = (0.0193 * Rr + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = v => v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116;
  X = f(X); Y = f(Y); Z = f(Z);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}
function bake(id) {
  if (bgCache[id]) return bgCache[id];
  const info = STG.bg[id], im = IMG['bg_' + id];
  const w = im.naturalWidth || im.width, h = im.naturalHeight || im.height, gy = Math.round(info.groundY);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.drawImage(im, 0, 0);
  const id0 = x.getImageData(0, 0, w, h), d = id0.data, d0 = new Uint8ClampedArray(d);
  const w2 = w >> 1, g2 = gy >> 1;
  const la = document.createElement('canvas'), lb = document.createElement('canvas'); la.width = lb.width = w2; la.height = lb.height = g2;
  const LA = la.getContext('2d').createImageData(w2, g2), LB = lb.getContext('2d').createImageData(w2, g2);
  const sat = s => [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s];
  const BF = Object.assign({}, M.bgFilter, (M.bgFilter.perBg || {})[id] || {}), LG = M.lights;
  const mS = sat(BF.sat), mW = sat(BF.warmSat || 0.7), cl = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const wl = LG.winLab; let nLight = 0, nTop = 0;
  const mask = new Uint8Array(w * gy);
  const yEnd = Math.min(h, gy + 24);   // 발 선 아래는 필름 띠에 가려 안 보임 → 굽지 않음
  for (let y = 0, i = 0; y < yEnd; y++) for (let xx = 0; xx < w; xx++, i += 4) {
    const r8 = d[i], g8 = d[i + 1], b8 = d[i + 2], r = r8 / 255, gg = g8 / 255, b = b8 / 255;
    let cr = cl(mS[0] * r + mS[1] * gg + mS[2] * b), cg = cl(mS[3] * r + mS[4] * gg + mS[5] * b), cb = cl(mS[6] * r + mS[7] * gg + mS[8] * b);
    cr = cl(BF.contrast * cr + BF.lift[0]); cg = cl(BF.contrast * cg + BF.lift[1]); cb = cl(BF.contrast * cb + BF.lift[2]);
    const wa = cl(2.5 * r - 2.5 * b - (BF.warmTh != null ? BF.warmTh : 0.6));
    if (wa > 0) {
      let wr = cl(mW[0] * r + mW[1] * gg + mW[2] * b), wg = cl(mW[3] * r + mW[4] * gg + mW[5] * b), wb = cl(mW[6] * r + mW[7] * gg + mW[8] * b);
      wr = cl(0.66 * wr + 0.03); wg = cl(0.66 * wg + 0.03); wb = cl(0.66 * wb + 0.05);
      cr = wr * wa + cr * (1 - wa); cg = wg * wa + cg * (1 - wa); cb = wb * wa + cb * (1 - wa);
    }
    if (y < gy) {
      nTop++;
      const [Ls, as, bs] = lab(r8, g8, b8);
      const dE = Math.sqrt((Ls - wl[0]) ** 2 + (as - wl[1]) ** 2 + (bs - wl[2]) ** 2);
      if (y > gy * 0.18 && ((Ls >= LG.minL && bs >= LG.minB) || dE <= LG.winDE)) mask[y * w + xx] = 1;
    }
    d[i] = cr * 255; d[i + 1] = cg * 255; d[i + 2] = cb * 255;
  }
  const lab2 = new Int32Array(w * gy), stack = new Int32Array(w * gy); let comp = 0;
  for (let p = 0; p < w * gy; p++) {
    if (!mask[p] || lab2[p]) continue;
    comp++; let sp = 0; const pts = []; stack[sp++] = p; lab2[p] = comp;
    while (sp) { const q = stack[--sp]; pts.push(q); const qx = q % w, qy = (q / w) | 0;
      if (qx > 0 && mask[q - 1] && !lab2[q - 1]) { lab2[q - 1] = comp; stack[sp++] = q - 1; }
      if (qx < w - 1 && mask[q + 1] && !lab2[q + 1]) { lab2[q + 1] = comp; stack[sp++] = q + 1; }
      if (qy > 0 && mask[q - w] && !lab2[q - w]) { lab2[q - w] = comp; stack[sp++] = q - w; }
      if (qy < gy - 1 && mask[q + w] && !lab2[q + w]) { lab2[q + w] = comp; stack[sp++] = q + w; } }
    if (pts.length < 8) continue;
    const T2 = (comp * 2654435761 >>> 0) & 2 ? LB.data : LA.data;
    for (const q of pts) { const qx = q % w, qy = (q / w) | 0; if ((qx >> 1) >= w2 || (qy >> 1) >= g2) continue; const i4 = q * 4, j4 = ((qy >> 1) * w2 + (qx >> 1)) * 4; T2[j4] = d0[i4]; T2[j4 + 1] = d0[i4 + 1] * 0.92; T2[j4 + 2] = d0[i4 + 2] * 0.7; T2[j4 + 3] = 255; nLight++; }
  }
  x.putImageData(id0, 0, 0);
  la.getContext('2d').putImageData(LA, 0, 0); lb.getContext('2d').putImageData(LB, 0, 0);
  return (bgCache[id] = { c, la, lb, info, w, h, gy, lightsPct: Math.round(nLight / nTop * 1000) / 10 });
}
export function preloadBg(id) { return bake(id); }

export function resize() {
  const vv = window.visualViewport;
  const cw = Math.round(vv ? vv.width : innerWidth), ch = Math.round(vv ? vv.height : innerHeight);
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
  cv.style.width = cw + 'px'; cv.style.height = ch + 'px';
  const s = Math.min(cw / 390, ch / 640);
  const probe = document.getElementById('safe-probe'); let it = 0, ib = 0;
  if (probe) { const cs = getComputedStyle(probe); it = parseFloat(cs.paddingTop) || 0; ib = parseFloat(cs.paddingBottom) || 0; }
  const H = ch / s, T0 = Math.max(it / s, 20), B = H - Math.max(0, ib / s - 34);
  // 390×844: 발 선 592 = B − 252 · 필름 띠 592~672(80, V16) · 도장 가운데 688 · 버튼 지름 96 가운데 760 = B − 84(V13, 아래 끝 808 = 홈 막대 위) · 카드 T+65
  const footY = Math.round(B - 252);
  L = { s, ox: (cw - 390 * s) / 2, oy: 0, cw, ch, W: 390, H, T: T0, B, footY, laneTop: footY, laneBot: footY + 80, hitY: footY + 40,
    padY: B - 84, padR: PAD_R, stampY: footY + 96, pressTop: footY + 80, cardTop: T0 + 65, hanaX: AM ? AM.place.hanaX : 112, deckTop: footY };
  pageCv = null;
}
export function getLayout() { return L; }

// ── 판 ─────────────────────────────
export function setPan(p, t) {
  pan = p; T = p.T;
  for (const sc of p.scenes) bake(sc.bg);
  S.rightOn = p.notes.some(n => n.side === 'R');
  // 노트마다 예비 칸(wind)을 쓸지: 앞 노트와 0.75박 넘게 떨어졌을 때만(가까우면 hit 칸을 그대로 두고 누를 때마다 코드 눌림, V1)
  let prevT = -1e9;
  for (const n of p.notes) {
    if (n.both && n.side === 'R') { n.pre = false; continue; }
    const gapB = (n.t - prevT) / T.beatInfo(n.t).beatLen; prevT = n.end || n.t;
    n.pre = gapB >= AM.keys.windMinGap;
  }
  resetVisuals(t);
}
export function setTitleBg(id) { idleScene = SCENE_OF_BG[id] || SCENE_OF_BG.p1; bake(idleScene.bg); pan = null; T = null; S.endT = null; S.prac = null; S.endFx = null; HA.clear(); for (const w in CA) CA[w].clear(); }
export function resetVisuals(t) {
  fx.length = 0; S.chips = { L: null, R: null }; S.combo = 0; S.cells = {}; S.stampT = {}; S.holding = null; S.lastJ = null; S.endFx = null; S.pracMiss = null;
  S.countFrom = null; S.shutterT = -9; S.flashT = -9; S.freezeUntil = -9; S.shakeUntil = -9; S.allowBack = true;
  S.endT = pan && pan.kind === 'run' ? pan.hitAt : null; S.endShown = false;
  HA.clear(); HA.resetStats(); for (const w in CA) { CA[w].clear(); CA[w].resetStats(); }
}
export function setCountIn(from, to) { S.countFrom = from; S.countTo = to; fx.length = 0; S.allowBack = true; HA.cancel('hit', from); HA.cancel('react', from); }
export function setDemo(d) { S.demo = d; }
export function setLayoutB() { }
// 연습 안내(명세 4절): { line, sub, icon, need, ok, passed } · 쉬움 첫 자유 손뼉 안내(I4) 켬/끔
export function setPractice(p) { S.prac = p ? Object.assign({}, p) : null; }
export function setHint(on) { S.hintOn = !!on; }
// 연습 중 MISS: 도장 대신 그쪽 버튼 테두리 1박 깜빡임 + '다시 한 번'(I5③)
export function practiceMiss(side, t) { S.pracMiss = { side, t }; }

// ── 장면 ─────────────────────────────
function sceneIdx(t) { if (!pan) return 0; let i = 0; for (let k = 0; k < pan.scenes.length; k++) if (t >= pan.scenes[k].t0) i = k; return i; }
function flipOf(t) {
  if (!pan) return null;
  for (let k = 1; k < pan.scenes.length; k++) { const s = pan.scenes[k]; if (!s.develop && t >= s.f0 && t < s.t0) return { k, u: (t - s.f0) / (s.t0 - s.f0) }; }
  return null;
}
export function sceneAt(t) { return pan ? pan.scenes[sceneIdx(t)] : idleScene; }
function leadNow(t) { const sc = sceneAt(t); return sc ? sc.lead : 'uncle'; }
// 팝업(V2): 다음 장면 넘김 1/2박 전부터 1/4박 동안 발 축으로 눕고(1 → 0), 새 장면 첫 박부터 1/4박 동안 일어섬(0 → 1.08 → 1). j = 엇갈림 순번
function popOf(si, t, j) {
  if (!pan) return 1;
  const P = AM.pop, sc = pan.scenes[si], nx = pan.scenes[si + 1], bl = T.avgBeat;
  if (nx) { const a = nx.develop ? nx.t0 - P.layBeats * bl : nx.f0 + P.layAt * bl; if (t >= a) { const u = clamp01((t - a) / (P.layBeats * bl)); return 1 - u * u; } }
  if (si > 0) {
    const a = sc.t0 + (j || 0) * P.stagger * bl; if (t < a) return 0;
    const u = (t - a) / (P.standBeats * bl);
    if (u < 0.5) { const v = u / 0.5; return P.over * (1 - (1 - v) * (1 - v)); }
    if (u < 1) return P.over + (1 - P.over) * ((u - 0.5) / 0.5);
  }
  return 1;
}

// ── 사건(main 이 부름) ─────────────────────────────
export function press(side, t, empty) { const p = S.pads[side]; p.down = true; p.t = t; p.empty = !!empty; S.lastPress = { t, side }; }
export function release(side) { S.pads[side].down = false; }
function nextAfter(n) { for (const x of pan.notes) if (x !== n && x !== n.both && !x.judged && x.t > n.t + 0.01) return x; return null; }
function anchorTime(kind, t) {
  if (kind === 'press') return t;
  const p = T.pos(t + 0.0625 * T.beatInfo(t).beatLen);
  return kind === 'next16' ? T.timeOfPos(Math.ceil(p * 4) / 4) : kind === 'next8' ? T.timeOfPos(Math.ceil(p * 2) / 2) : T.timeOfPos(Math.ceil(p));
}
function nextCall(t) { let c = Infinity; for (const ph of pan.phrases) if (ph.call0 > t + 0.01 && ph.call0 < c) c = ph.call0; return c; }
function preStart(n) { const bn = T.beatInfo(n.t).beatLen; return n.pre ? n.t + AM.keys.windAt * bn : n.t; }
const kf = (p, t) => [p[1], t, p[0]];   // 칸 하나 = [칸, 시각, 동작]
// 판정 뒤 동작(V1: 핵심 칸만): 누르면 hit 칸(0.25박, 다음 노트가 반 박 안이면 그 노트까지) → 1박 넘게 비면 판정 반응 1장(0.5박) → 기본 그림.
// MISS: 누른 MISS = 그 자리 미끄러짐, 안 누른 MISS = 다음 박 머리 긁기(V18). 반응은 다음 예비·부름 0.25박 전에 끊음.
function hitClip(n, res, t, pressed) {
  const bl = T.beatInfo(t).beatLen, nx = nextAfter(n), K = AM.keys, gap = nx ? (nx.t - t) / bl : 99;
  const nxPre = nx ? preStart(nx) : Infinity, cut = Math.min(nxPre, nextCall(t) - AM.react.beforeCall * bl);
  if (res === 'MISS') {
    const fr = pressed ? K.react.MISSpress : K.react.MISSpass, at = pressed ? t : anchorTime('nextBeat', t);
    const t1 = Math.min(at + K.reactBeats * bl, cut);
    if (t1 > at + 0.02) HA.add('react', at, t1, fr[0], [kf(fr, at)]);
    return;
  }
  if (!pressed) return;
  const hk = K[n.both ? 'both' : n.side].hit;
  let hEnd = t + K.hitBeats * bl;
  const dense = nx && gap <= 0.55 && !nx.pre;   // 8분 연속: 다음 누름까지 hit 칸 유지(늦게 눌러도 사이에 기본 그림이 1~6ms 끼지 않게)
  if (nx && gap <= 0.55) hEnd = Math.max(hEnd, nx.pre ? nxPre : nx.t + 0.13);
  HA.add('hit', t, dense ? hEnd : Math.max(t + 0.125 * bl, Math.min(hEnd, Math.max(cut, t + 0.125 * bl))), hk[0], [kf(hk, t)]);
  if (gap > AM.reactMinGap) {
    const rx = K.react[res], at = Math.max(t + K.hitBeats * bl, anchorTime(res === 'PERFECT' ? 'next8' : 'next16', t));
    const t1 = Math.min(at + K.reactBeats * bl, cut);
    if (t1 > at + 0.02) HA.add('react', at, t1, rx[0], [kf(rx, at)]);
  }
}
export function judged(r, t) {
  const n = r.note, res = r.res;
  if (r.how === 'lift' || r.how === 'regrab') return;
  const prac = pan && pan.kind === 'practice';
  if (res && !(prac && res === 'MISS')) S.chips[n.side] = { res, t0: t, delta: r.delta, side: n.side, fastSlow: r.fastSlow !== false && r.how === 'press' };
  if (res && !(n.both && n.side === 'R')) S.lastJ = { t, res, seed: seedOf(n.id) };
  if (res === 'MISS') { n.missT = t; if (prac) practiceMiss(n.side, t); if (!(n.both && n.side === 'R')) hitClip(n, 'MISS', t, r.how !== 'pass'); return; }
  if (r.how === 'head' || r.how === 'lategrab') { S.holding = n; n.pressT = t; S.shutterT = t; shards(res, t, n); return; }
  if (r.how === 'release' || r.how === 'auto' || r.how === 'early-release') {
    S.holding = null;
    const bl = T.beatInfo(t).beatLen, rk = AM.keys.hold.release;
    HA.add('hit', t, t + 0.375 * bl, rk[0], [kf(rk, t)]);
    if (r.ok) { S.lastJ = { t, res, seed: seedOf(n.id) + 7 }; shards(res, t, n); }
    if (n.release === 'shutter' && r.ok) flash(t);
    return;
  }
  S.shutterT = t;
  if (n.both && n.side === 'R') return;   // 두 손: 동작·조각은 왼쪽 노트 하나로
  hitClip(n, res, t, true);
  shards(res, t, n);
  if (n.side === 'L' && !n.noKana) fly(n, t);
  if (res === 'PERFECT') {
    const bi = T.beatInfo(n.t);
    S.freezeAt = t; S.freezeUntil = t + (bi.first && bi.phi < 0.1 ? M.stage.freezeBarMs : M.stage.freezePerfectMs) / 1000;
    if (bi.first && bi.phi < 0.1) S.shakeUntil = t + M.stage.freezeBarMs / 1000;
  }
}
// 자유 손뼉(판정·점수·콤보 없음): 가까운 표시를 터뜨리고, 하나 손뼉 1장, 작은 종이 꽃가루
export function freeClap(t) {
  const bl = T.beatInfo(t).beatLen, ck = AM.keys.clap;
  for (const fr of pan.free) { if (!fr.pop) fr.pop = {}; fr.at.forEach((ft, i) => { if (!fr.pop[i] && Math.abs(ft - t) < 0.2) fr.pop[i] = t; }); }
  HA.add('hit', t, t + 0.25 * bl, ck[0], [kf(ck, t)]);
  for (let i = 0; i < 6; i++) { const a = (70 + i * 40) * PI / 180, v = 90 + Math.random() * 60; fx.push({ k: 'bit', t0: t, dur: 0.45, x: HIT_X + 30, y: L.hitY - 10, vx: Math.cos(a) * v, vy: -Math.sin(a) * v * 0.6, rot: i, col: i % 2 ? C.cream : C.sky }); }
}
export function stamp(k, t) { if (!S.cells[k]) { S.cells[k] = true; S.stampT[k] = t; } }
export function setCombo(n, t) { if (n !== S.combo) { S.combo = n; S.comboT = t; } }
// 콤보 고비: 다음 노트가 2박 넘게 없으면 강박에 점프(웅크림 → 꼭대기 → 착지 3장). 부르는 구절과 겹치면 다음 빈 강박. 아저씨 군고구마 1장(무대에 있을 때)
function overlapsCall(a, b, bl) { for (const ph of pan.phrases) if (a < ph.resp0 && b > ph.call0 - 0.25 * bl) return true; return false; }
export function comboMilestone(t) {
  const C2 = AM.combo, bl = T.beatInfo(t).beatLen, J = AM.keys.jump;
  let nx = null; for (const x of pan.notes) if (!x.judged && x.t > t) { nx = x; break; }
  let p = Math.ceil(T.pos(t + 0.06));
  for (let tries = 0; tries < 8; tries++, p++) {
    if ((((p - 2) % 4) + 4) % 4 % 2 !== 0) continue;
    const at = T.timeOfPos(p), endT = at + 1.25 * bl;
    if (at > pan.hitAt - 1) return false;
    if (nx && ((nx.t - t) / bl < C2.minGap || preStart(nx) < endT)) return false;
    if (overlapsCall(at, endT, bl)) continue;
    HA.add('react', at, endT, J.crouch[0], [kf(J.crouch, at), kf(J.top, at + 0.125 * bl), kf(J.land, at + bl)], { arc: { t0: at + 0.125 * bl, t1: at + bl, H: C2.arc.H } });
    const P = AM.castKeys.uncle.potato; if (sceneAt(at).cast.includes('uncle') && !overlapsCall(at, at + 2 * bl, bl)) CA.uncle.add('combo', at, at + bl, P[0], [kf(P, at)]);
    return true;
  }
  return false;
}
// 끝 한 방(V10): 무대 1/2박 멈춤 + 흰 번쩍 + 폴라로이드 틀이 내려앉음 + 종이 조각 24 + 조연 셋 함께 점프
export function endHit(t) {
  S.endShown = true; flash(t); S.endFx = t;
  S.freezeAt = t; S.freezeUntil = t + 0.25;
  const cols = [C.tan, C.sun, C.sky, C.paper];
  for (let i = 0; i < 24; i++) fx.push({ k: 'confetti', t0: t, dur: 1.9, x: 30 + R(i, 1) * 330, y: L.T + 40 + R(i, 2) * 60, vx: (R(i, 3) - 0.5) * 60, vy: -40 - R(i, 4) * 80, rot: R(i, 5) * TAU, vr: (R(i, 6) - 0.5) * 10, col: cols[i % 4], s: 5 + R(i, 7) * 4 });
}
function flash(t) { if (t - S.flashT > 1.0) S.flashT = t; }
function shards(res, t, n) { fx.push({ k: 'shards', t0: t, dur: 2, res, seed: seedOf(n.id) }); }
function lensPos() {
  const G = HA.geo; if (!G || !G.f) return { x: L.hanaX + 6, y: L.footY - 70 };
  const f = G.f; if (f.camX == null) return { x: G.X + 6, y: G.groundY - G.liftCss - 70 };
  return { x: G.X + (f.camX - f.footX) * G.sc * G.sx, y: G.groundY - G.liftCss + (f.camY - f.baseY) * G.sc * G.sy };
}
function fly(n, t) { fx.push({ k: 'fly', t0: t, dur: 0.375 * T.avgBeat, x0: HIT_X, y0: L.hitY, txt: n.kanaChars[0] }); }

// ── 시간 도우미 ─────────────────────────────
const idleBeat = 60 / 122.39;
function beatInfoAny(t) {
  if (T) return T.beatInfo(t);
  const p = t / idleBeat, i = Math.floor(p), phi = p - i, beat = (((i - 2) % 4) + 4) % 4 + 1;
  return { p, i, phi, bar: Math.floor((i - 2) / 4) + 1, beat, first: beat === 1, beatLen: idleBeat };
}
function phaseAt(t) {
  if (!pan) return { who: null };
  let r = { who: null };
  for (const ph of pan.phrases) {
    if (t >= ph.call0 && t < ph.resp0) r = { who: 'call', ph };
    else if (t >= ph.resp0 && t < ph.resp1) r = { who: 'resp', ph };
  }
  return r;
}
const mot = () => settings.motion === 'less' ? 0.4 : 1;

// ── 인물 칸 고르기(V1: 기본 1장 + 핵심 칸) ─────────────────────────────
const fr = (p, kind, extra) => Object.assign({ motion: p[0], key: p[1], kind }, extra || {});
function hanaSel(t, play) {
  if (S.demo) return S.demo;
  const bi = beatInfoAny(t), bl = bi.beatLen, K = AM.keys, B = AM.base;
  const holding = S.holding && S.holding.hold && S.holding.hold.active && S.holding.hold.released == null;
  if (play && pan && S.endT != null && !holding) {   // 끝 한 방: 웅크림(−1/4박) → 꼭대기(−1/8 ~ 1/2박, 코드 포물선) → 착지(1/4박) → 기본
    const dt = (t - S.endT) / bl;
    if (dt >= -0.25 && dt < -0.125) return fr(K.jump.crouch, 'end');
    if (dt >= -0.125 && dt < 0.5) return fr(K.jump.top, 'end', { arc: { t0: S.endT - 0.125 * bl, t1: S.endT + 0.5 * bl, H: AM.end.arc.H } });
    if (dt >= 0.5 && dt < 0.75) return fr(K.jump.land, 'end');
  }
  if (play) {
    const c = HA.active(t); if (c) return c;
    if (holding) return fr(K.hold.press, 'hold');
    if (pan) {
      let n = null; for (const x of pan.notes) if (!x.judged && !(x.hold && x.hold.active) && !(x.both && x.side === 'R') && x.t > t - 0.25) { n = x; break; }
      if (n && n.pre) { const bn = T.beatInfo(n.t).beatLen; if (t >= n.t + K.windAt * bn && t < n.t + 0.13) return fr(K[n.both ? 'L' : n.side].wind, 'pre'); }   // 늦게 눌러도(GOOD 창 안) 예비 칸에서 바로 치기로
      for (const ph of pan.phrases) {
        if (t >= ph.call0 && t < ph.resp0 - 0.25 * bl) {
          let nod = false; for (const a of ph.at) if (t >= a && t < a + AM.listen.nodBeats * bl) nod = true;
          return fr(B, 'listen', { nod });
        }
      }
    }
  }
  return fr(B, 'idle');
}
// 조연(V3): 부를 때만 크게(숨 → 글자마다 '부름' 1장 + 코드 숙임·부풂) · 받을 때 = 기본 1장 + 작은 박 출렁(watch) · 받기 끝 뒤 빈 박에 응원 1장 1박 · 쉴 때 기본 1장
function castSel(who, role, t, play, j) {
  const U = castSpec(who), KB = AM.castBase[who], KK = AM.castKeys[who], CL = AM.caller, bi = beatInfoAny(t), bl = bi.beatLen;
  if (play && pan && S.endT != null && t >= S.endT - 0.125 * bl) {
    const o = (j || 0) * bl / 16;
    return fr(KK.cheer, 'end', { arc: { t0: S.endT - 0.125 * bl + o, t1: S.endT + 0.5 * bl + o, H: 30 } });
  }
  let ph = null, resp = null, lastEnd = -Infinity;
  if (play && pan) for (const p of pan.phrases) {
    if (t >= p.call0 + U.breatheAt * bl && t < p.resp0) ph = p; else if (t >= p.resp0 && t < p.resp1) resp = p;
    if (p.resp1 <= t && p.resp1 > lastEnd) lastEnd = p.resp1;
  }
  if (ph && role === 'lead' && !ph.all) {
    if (KK.point && t >= ph.resp0 + CL.pointAt * bl) return fr(KK.point, 'point');
    if (t < ph.at[0]) return fr(KK.breathe, 'call');
    let a = ph.at[0]; const last = ph.at[ph.at.length - 1]; for (const x of ph.at) if (x <= t) a = x;
    if (a === last && t >= a + U.relaxAfter * bl) return fr(KB, 'watch');
    return fr(KK.call, 'call', { dip: a });
  }
  if (play) { const c = CA[who].active(t); if (c) return c; }
  if ((ph && ph.all) || (resp && resp.all)) return fr(KK.cheer, 'cheer');   // 끝 おいしい는 모두 응원
  if (resp || ph) return fr(KB, 'watch');
  if (t >= lastEnd && t < lastEnd + CL.cheerBeats * bl) return fr(KK.cheer, 'cheer');
  return fr(KB, 'rest');
}
// 무대 위 조연 목록(V4 자리 · V2 팝업)
function castList(t, play) {
  const out = [];
  const si = play && pan ? sceneIdx(t) : 0, sc = play && pan ? pan.scenes[si] : idleScene, P = AM.place[sc.id] || {};
  let j = 0;
  for (const who of Object.keys(P)) {
    if (!sc.cast.includes(who) || !CA[who]) continue;
    const [hx, k, dy] = P[who];
    const pop = play && pan ? popOf(si, t, j) : 1;
    j++;
    if (pop <= 0.01) continue;
    out.push({ who, x: hx, k, dy, pop, j: j - 1, role: who === sc.lead ? 'lead' : 'side' });
  }
  return out;
}

// ── 그리기 ─────────────────────────────
export function draw(t, mode, dbg, visualMs) {
  const t0 = performance.now();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = C.navyD; g.fillRect(0, 0, cv.width, cv.height);
  g.setTransform(dpr * L.s, 0, 0, dpr * L.s, L.ox * dpr, L.oy * dpr);
  g.save(); g.beginPath(); g.rect(0, 0, 390, L.H); g.clip();
  const play = mode === 'play' || mode === 'pause';
  let ts = t;
  if (play) { if (S.allowBack || t >= S.tStage) { S.tStage = t; S.allowBack = false; } ts = S.tStage; if (ts < S.freezeUntil) ts = S.freezeAt; }
  const tv = t + (visualMs || 0) / 1000;   // 노트·고리·박 눈금만 화면 지연 보정(I5)
  drawStage(ts, play);
  drawLane(tv, play && !!pan);
  if (play && pan) { drawNotes(tv); drawMarker(tv, t); drawFx(t); drawPads(tv, t); drawStamps(t); drawCard(t); drawHud(t); drawPractice(t); if (S.countFrom != null && t < S.countTo) drawCount(t); }
  if (dbg) drawDebug(t, dbg);
  g.restore();
  S.lastDrawMs = performance.now() - t0;
}

function drawStage(t, play) {
  const bi = beatInfoAny(t), mk = mot(), bl = bi.beatLen;
  let shake = 0; if (play && t < S.shakeUntil) shake = Math.sin(t * 90) * M.stage.shakePx * mk;
  g.save(); g.translate(shake, 0);
  const si = play && pan ? sceneIdx(t) : 0;
  const fl = play && pan ? flipOf(t) : null;
  if (fl) { drawPage(pan.scenes[fl.k], t, bi, mk, 0); drawTurn(pan.scenes[fl.k - 1], t, bi, mk, fl.u); }
  else {
    const sc = play && pan ? pan.scenes[si] : idleScene;
    drawPage(sc, t, bi, mk, play && pan ? popOf(si, t, 0) : 1);
    if (play && pan && sc.develop && t >= sc.t0 && t < sc.t0 + 0.25 * bl) {   // V20 셔터 → 새 사진이 현상되듯 1/4박
      g.fillStyle = C.paper; g.globalAlpha = 1 - (t - sc.t0) / (0.25 * bl); g.fillRect(0, 0, 390, L.footY); g.globalAlpha = 1;
    }
  }
  drawSnow(t, false, bi);
  const shown = {};
  for (const c of castList(t, play)) {
    const an = CA[c.who], sel = holdMin(an, castSel(c.who, c.role, t, play, c.j), t, bl);
    an.scale = c.k; an.note(t, sel, c.x, bl, !play); shown[c.who] = true;
    drawAnim(an, sel, c.x, L.footY + c.dy, t, AM.code.callerScale, c.k, c.pop);
  }
  for (const w in CA) if (!shown[w] && CA[w].lastKey) { CA[w].lastKey = null; CA[w].lastChangeT = null; CA[w].cur = null; }   // 무대 밖이면 멈춤 셈을 끊음
  const hs = holdMin(HA, hanaSel(t, play), t, bl); HA.note(t, hs, L.hanaX, bl, !play);
  drawAnim(HA, hs, L.hanaX, L.footY, t, 1, 1, 1);
  drawSnow(t, true, bi);
  const fa = (t - S.flashT) * 1000;
  if (fa >= 0 && fa < M.stage.flashMs) { g.fillStyle = C.paper; g.globalAlpha = M.stage.flashAlpha * (1 - fa / M.stage.flashMs) * mk; g.fillRect(0, 0, 390, L.footY); g.globalAlpha = 1; }
  if (play && S.endFx != null) drawPolaroid(t, bl);
  g.restore();
}
// 칸 최소 길이(명세 6절): 지금 칸이 1/16박(31ms)도 안 됐으면 다음 칸으로 안 넘김. 단 누른 즉시 hit 칸은 늘 바로
function holdMin(an, sel, t, bl) {
  const c = an.cur;
  if (!c || !sel || (sel.motion === c.motion && sel.key === c.key) || sel.kind === 'hit' || sel.kind === 'end') return sel;
  const dt = t - an.curT;
  return dt >= 0 && dt < bl / 16 ? c : sel;
}
// 무대 종이 판 한 장: 배경(겹친 종이 층 세 띠가 2박 주기로 출렁 + 마디 첫 박 확대) + 창 불빛 + 트럭(역 앞, 팝업)
function drawPage(sc, t, bi, mk, pop) {
  const bg = bake(sc.bg);
  const bump = (M.stage.bumpScale - 1) * mk * Math.max(0, 1 - bi.phi / M.stage.bumpBeats) * (bi.first ? 1 : 0.35);
  const k = Math.max(390 / bg.w, L.footY / bg.info.groundY);
  const bw = bg.w * k, x0 = 195 - bg.info.focusX * k, y0 = L.footY - bg.info.groundY * k, cx = 195, cy = L.footY;
  const sway = Math.sin(bi.p * PI) * mk;
  const bands = [[0, bg.gy - 520 / k * 0.98, 0.6, 0.4], [bg.gy - 520 / k, bg.gy - 150 / k, 1.2, 0.7], [bg.gy - 150 / k, bg.gy + 10 / k, 2.0, 1.0]];
  const yTop = Math.max(0, -y0 / k);
  if (y0 > 0) { g.fillStyle = bg.info.sky; g.fillRect(0, 0, 390, y0 + 1); }
  for (const [s0, s1, amp, bf] of bands) {
    const a = Math.max(yTop, s0), b = Math.min(bg.h, s1); if (b <= a) continue;
    const sc2 = 1 + bump * bf, dx = sway * amp;
    g.drawImage(bg.c, 0, a, bg.w, b - a, cx + (x0 - cx) * sc2 + dx, cy + (y0 + a * k - cy) * sc2, bw * sc2, (b - a) * k * sc2);
  }
  const la = (S.combo >= 10 ? M.lights.comboAlpha : M.lights.alpha) * mk * Math.max(0, 1 - bi.phi / M.lights.decayBeats);
  if (la > 0.01) {
    g.globalCompositeOperation = 'lighter'; g.globalAlpha = la * 0.5;
    const dl = img => g.drawImage(img, 0, yTop / 2, img.width, (bg.gy - yTop) / 2, x0 + sway * 0.6, y0 + yTop * k, bw, (bg.gy - yTop) * k);
    if (bi.first || S.combo >= 10) { dl(bg.la); dl(bg.lb); } else dl(bi.beat % 2 ? bg.la : bg.lb);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }
  if (sc.truck && pop > 0.01) drawTruck(t, bi, mk, pop);
}
// 책장 넘김(V2): 옛 판을 한 번 따로 그린 뒤 왼쪽 가장자리를 축으로 0 → 90° 돌림. 세로 띠 64개를 원근(가까운 쪽 크게)으로 그려 접히는 끝이 앞으로 들림.
// 돌수록 한 색 그늘, 끝에 종이 두께 띠, 새 판 위 그늘 띠. 넘김은 천천히 시작해 빨라지고 새 장면 첫 박에 끝남
function drawTurn(sc, t, bi, mk, u) {
  const w = Math.round(390 * L.s * dpr), h = Math.round((L.footY + 2) * L.s * dpr);
  if (!pageCv || pageCv.width !== w || pageCv.height !== h) { pageCv = document.createElement('canvas'); pageCv.width = w; pageCv.height = h; pageG = pageCv.getContext('2d'); }
  const g0 = g; g = pageG; g.setTransform(dpr * L.s, 0, 0, dpr * L.s, 0, 0); g.fillStyle = C.navyD; g.fillRect(0, 0, 390, L.footY + 2);
  drawPage(sc, t, bi, mk, 0); g = g0;
  const e = u, th = e * PI / 2, cs = Math.cos(th), sn = Math.sin(th), D = 1100, yc = L.footY * 0.55, N = 64;
  const proj = x => { const p = D / (D - x * sn); return { X: 195 + (x * cs - 195) * p, p }; };   // 원근 중심 = 화면 가운데
  const ed = proj(390);
  if (ed.X < 390) { g.fillStyle = C.navyD; g.globalAlpha = 0.22 * sn; g.fillRect(Math.max(0, ed.X), 0, 34 * sn, L.footY); g.globalAlpha = 1; }
  const sw = 390 / N, swPx = w / N;
  for (let i = 0; i < N; i++) {
    const a = proj(i * sw), b = proj((i + 1) * sw), pm = (a.p + b.p) / 2;
    if (b.X - a.X < 0.05 || a.X > 392 || b.X < -2) continue;
    g.drawImage(pageCv, i * swPx, 0, swPx, h, a.X, yc - yc * pm, b.X - a.X + 0.7, (L.footY + 2) * pm);
  }
  g.fillStyle = C.navyD; g.globalAlpha = 0.3 * sn;
  g.beginPath(); g.moveTo(0, 0); g.lineTo(ed.X, yc - yc * ed.p); g.lineTo(ed.X, yc + (L.footY - yc) * ed.p); g.lineTo(0, L.footY); g.closePath(); g.fill(); g.globalAlpha = 1;
  g.fillStyle = C.cream; g.fillRect(ed.X - 1, yc - yc * ed.p, 3 * ed.p, L.footY * ed.p);
}
function drawTruck(t, bi, mk, pop) {
  const tk = truck.look(t).pose;
  if (!tk || !tk.img) return;
  const sc = tk.cssPerPx, ph8 = (bi.p * 2) % 1, bob = ph8 < 0.25 ? 1 : 0;
  const x = AM.place.truckX + tk.footX * sc, y = L.footY + bob;
  drawPose(tk, x, y, 1, pop, 0);
  if (pop < 0.98) return;
  const left = x - tk.footX * sc, top = y - tk.footY * sc, tw = tk.w * sc, th = tk.h * sc;
  const ka = (bi.first || S.combo >= 10 ? 0.35 : 0.12) * Math.max(0, 1 - bi.phi) * mk;
  if (ka > 0.01) { g.globalCompositeOperation = 'lighter'; g.globalAlpha = ka; g.fillStyle = C.tan; g.fillRect(left + tw * 0.2, top + th * 0.4, tw * 0.17, th * 0.13); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; }
  const chx = left + tw * M.steam.chimneyX, chy = top + th * M.steam.chimneyY;
  for (let j = 0; j < 2; j++) {
    const age = (bi.p - Math.floor(bi.p) + j) / M.steam.lifeBeats; if (age > 1) continue;
    const r = (6 + age * 6) * (1 + (M.steam.grow - 1) * age) * (S.combo >= 10 ? 1.25 : 1);
    g.fillStyle = C.paperD; g.globalAlpha = 0.9 * (1 - age); poly(chx + Math.sin(age * 5) * 4, chy - age * M.steam.rise, r, 6, age); g.fill(); g.globalAlpha = 1;
  }
}
function curveAt(arr, phi) { const P = M.beatCurve.phi; for (let i = 1; i < P.length; i++) if (phi <= P[i]) { const u = (phi - P[i - 1]) / (P[i] - P[i - 1]); return arr[i - 1] + (arr[i] - arr[i - 1]) * u; } return arr[arr.length - 1]; }
// 인물 한 칸 + 코드 움직임: 들을 때·쉴 때 = 박 곡선(출렁·세로·기울기, motion.json beatCurve) + 박마다 종이 휨 · 사건 칸 = 강박 눌림·치기 눌림·착지 눌림
// · 칸 바뀜 종이 휨(0.94 → 1, 70ms) · 부르는 사람 글자마다 숙임 4°·부풂 1.06(V3) · 팝업 세로(V2) · 발밑 그늘 타원
function drawAnim(an, sel, X, groundY, t, codeMul, kk, pop) {
  if (!sel) return;
  const f = an.frame(sel.motion, sel.key); if (!f) return;
  const CD = AM.code, bi = beatInfoAny(t), bl = bi.beatLen, mk = mot() * codeMul, k = kk || 1, sgn = bi.i % 2 ? -1 : 1;
  const sc = AL.cssPerPx * k;
  let sy, tilt, dyBeat = 0;
  if (IDLE_KINDS.has(sel.kind)) {
    const BC = M.beatCurve;
    dyBeat = curveAt(BC.y, bi.phi) * 0.8 * mk; sy = 1 + (curveAt(BC.sy, bi.phi) - 1) * mk; tilt = curveAt(BC.tilt, bi.phi) * 0.4 * sgn * mk;
    if (sel.kind === 'watch') dyBeat *= AM.caller.watchBobPx / 3;
  } else {
    const u = bi.phi / CD.squashBeats;
    sy = u < 1 ? 1 - (bi.beat % 2 ? CD.strongSquash : CD.weakSquash) * (1 - u) * (1 - u) * mk : 1;
    tilt = CD.tiltDeg * sgn * Math.cos(PI * bi.phi) * mk;
  }
  const u2 = (t - an.curT) / (CD.landBeats * bl);
  if (sel.key === 'land' && u2 >= 0) { if (u2 < 1) sy = 1 - CD.landSquash * mot(); else if (u2 < 2) sy = CD.landOver - (CD.landOver - 1) * (u2 - 1); }
  else if (sel.kind === 'hit' && u2 >= 0 && u2 < 1) sy *= 1 - CD.hitSquash * (1 - u2) * mot();
  if (sel.kind === 'hit' && an === HA) { const up = (t - S.lastPress.t) / (CD.landBeats * bl); if (up >= 0 && up < 1) sy *= 1 - CD.hitSquash * (1 - up) * mot(); }   // 8분 연속(같은 칸)도 누를 때마다 눌림
  if (sel.nod) sy *= AM.listen.nodSy;
  let sx = 1 / sy;
  const bu = (t - an.curT) * 1000 / AM.bend.ms;
  if (bu >= 0 && bu < 1) sx *= 1 - (1 - AM.bend.from) * (1 - bu) * (1 - bu) * mot();
  else if (IDLE_KINDS.has(sel.kind)) { const pb = bi.phi * bl * 1000 / AM.bend.ms; if (pb < 1) sx *= 1 - (1 - AM.bend.beatFrom) * (1 - pb) * (1 - pb) * mk; }
  if (sel.dip != null) {   // 부르는 글자마다: 하나 쪽으로 4° 숙였다 1/8박에 돌아옴 + 1/16박 부풂
    const CL = AM.caller, ud = (t - sel.dip) / (CL.leanBeats * bl), up2 = (t - sel.dip) / (CL.pulseBeats * bl);
    if (ud >= 0 && ud < 1) tilt -= CL.leanDeg * (1 - ud) * mot();
    if (up2 >= 0 && up2 < 1) { const p = 1 + (CL.pulse - 1) * (1 - up2) * mot(); sx *= p; sy *= p; }
  }
  const dms = (t - an.motionT) * 1000; if (dms >= 0 && dms < CD.wobbleMs * 4) tilt += CD.wobbleDeg * Math.exp(-dms / CD.wobbleMs) * Math.cos(dms / 1000 * 2 * PI * 7) * mot();
  let liftCss = f.lift * sc;
  if (sel.arc) { const ua = (t - sel.arc.t0) / (sel.arc.t1 - sel.arc.t0); liftCss = ua > 0 && ua < 1 ? sel.arc.H * 4 * ua * (1 - ua) * mot() : 0; }
  const pp = pop == null ? 1 : pop;
  const SH = AM.shadow, sk = (1 - Math.min(0.45, liftCss / 110)) * (0.5 + 0.5 * Math.min(1, pp));
  g.fillStyle = C.navyD; g.globalAlpha = SH.alpha * (0.6 + 0.4 * sk);
  g.beginPath(); g.ellipse(X, groundY + SH.dy, SH.rx * k * sk, SH.ry * k, 0, 0, TAU); g.fill(); g.globalAlpha = 1;
  g.save(); g.translate(X, groundY - liftCss + dyBeat); g.rotate(tilt * PI / 180); g.scale(sx, sy * pp);
  const atl = AL.atlases[f.a], sh = AL.shadows[f.a];
  const dx = -f.footX * sc, dy = -f.baseY * sc, w = f.w * sc, h = f.h * sc;
  if (sh) g.drawImage(sh, f.x, f.y, f.w, f.h, dx + 2, dy + 3, w, h);
  g.drawImage(atl, f.x, f.y, f.w, f.h, dx, dy, w, h);
  g.restore();
  an.geo = { X, groundY, liftCss, sc, f, sx, sy };
}
function drawPose(p, x, y, sx, sy, tiltDeg) {
  if (!p || !p.img) return;
  const sc = p.cssPerPx;
  g.save(); g.translate(x, y); if (tiltDeg) g.rotate(tiltDeg * PI / 180); g.scale(sx, sy);
  const dx = -p.footX * sc, dy = -p.footY * sc, w = p.w * sc, h = p.h * sc;
  if (p.shadow) g.drawImage(p.shadow, dx + 2, dy + 3, w, h);
  g.drawImage(p.img, dx, dy, w, h);
  g.restore();
}
function drawSnow(t, front, bi) {
  const mk = mot(); if (!mk) return;
  const fall = (front ? M.snow.frontFallBeats : M.snow.backFallBeats) * idleBeat, maxY = L.footY - 4;
  g.fillStyle = front ? C.paper : C.paperD;
  for (const f of snow) {
    if (f.front !== front) continue;
    const u = ((t / fall + f.ph) % 1 + 1) % 1, y = -10 + u * (maxY + 10);
    if (y > maxY) continue;
    const x = f.x + Math.sin((t / (M.snow.swayBeats * idleBeat)) * 2 * PI + f.sw) * M.snow.swayPx;
    poly(x, y, f.sz, 6, f.rot + (front ? Math.floor(bi.p) * 0.26 : 0)); g.fill();
  }
}
// 끝 한 방 폴라로이드 틀(V10): 1/4박 동안 위에서 −4°로 내려앉아 곡 끝까지. 아래 칸에 날짜·도시(가나)
function drawPolaroid(t, bl) {
  const a = t - (S.endFx + 0.03); if (a < 0) return;
  const u = clamp01(a / (0.25 * bl)), e = 1 - (1 - u) * (1 - u);
  const x0 = 16, x1 = 374, y0 = L.T + 54, y1 = L.footY - 4, ix0 = x0 + 10, ix1 = x1 - 10, iy0 = y0 + 10, iy1 = y1 - 40;
  g.save(); g.translate(195, (y0 + y1) / 2 - 30 * (1 - e)); g.rotate(-4 * (1 - e) * PI / 180 - 1.2 * PI / 180); g.translate(-195, -(y0 + y1) / 2);
  const frame = (ox, oy) => { g.beginPath(); g.rect(x0 + ox, y0 + oy, x1 - x0, y1 - y0); g.rect(ix0 + ox, iy0 + oy, ix1 - ix0, iy1 - iy0); };
  g.fillStyle = C.navyD; g.globalAlpha = 0.5; frame(3, 4); g.fill('evenodd'); g.globalAlpha = 1;
  g.fillStyle = C.paper; frame(0, 0); g.fill('evenodd');
  g.fillStyle = C.navy; g.font = '600 18px ' + F_KANA; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText('12.24  さっぽろ', ix0 + 6, (iy1 + y1) / 2 + 1);
  g.restore();
}
function poly(x, y, r, n, rot) { g.beginPath(); for (let i = 0; i < n; i++) { const a = rot + i * 2 * PI / n; const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; i ? g.lineTo(px, py) : g.moveTo(px, py); } g.closePath(); }
function circ(x, y, r) { g.beginPath(); g.arc(x, y, r, 0, TAU); }
function rrect(x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.arcTo(x + w, y, x + w, y + r, r); g.lineTo(x + w, y + h - r); g.arcTo(x + w, y + h, x + w - r, y + h, r); g.lineTo(x + r, y + h); g.arcTo(x, y + h, x, y + h - r, r); g.lineTo(x, y + r); g.arcTo(x, y, x + r, y, r); g.closePath(); }

// ── 필름 띠(노트 길, 80) · 수첩 바닥 ─────────────────────────────
// 남색 필름 띠: 위아래 크림 구멍 6×7이 16px마다 노트와 같은 빠르기로 흐름(노트 지름 58이 구멍 줄을 안 덮음, V16), 박마다 칸 경계, 받는 마디엔 위 가장자리 크림.
// 바닥(V8·V13): 크림에 남색 7% 덮은 수첩 면 + 가는 줄 3개 + 왼쪽 스프링 구멍. 메뉴 뒤에는 필름 띠를 안 그림(V11)
function drawLane(t, play) {
  const y0 = L.laneTop, y1 = L.laneBot;
  if (play) {
    const ph = phaseAt(t);
    g.fillStyle = C.navy; g.fillRect(0, y0, 390, 80);
    const off = ((t * SPEED % 16) + 16) % 16;
    g.fillStyle = C.cream;
    for (let x = 4 - off; x < 394; x += 16) { g.fillRect(x, y0 + 3, 6, 7); g.fillRect(x, y1 - 10, 6, 7); }
    const p0 = Math.ceil(T.pos(t - 0.3)), p1 = Math.floor(T.pos(t + 1.35));
    for (let p = p0; p <= p1; p++) {
      const x = HIT_X + (T.timeOfPos(p) - t) * SPEED; if (x < -4 || x > 394) continue;
      const first = ((p - 2) % 4 + 4) % 4 === 0;
      g.fillStyle = first ? C.cream : C.slateD; g.fillRect(x - 1, y0 + 16, 2, 48);
    }
    if (ph.who === 'resp') { g.fillStyle = C.cream; g.fillRect(0, y0, 390, 3); }
  }
  const fy = play ? y1 : L.footY;
  g.fillStyle = C.floor; g.fillRect(0, fy, 390, L.H - fy);
  g.fillStyle = C.line; for (const dy of [30, 100, 142]) if (y1 + dy < L.H - 2) g.fillRect(16, y1 + dy, 374, 1.5);
  g.fillStyle = C.navyD; g.globalAlpha = 0.07; g.fillRect(0, fy, 14, L.H - fy); g.globalAlpha = 0.5;
  for (let y = y1 + 16; y < L.H - 6; y += 20) { circ(7, y, 3.2); g.fill(); }
  g.globalAlpha = 0.35; g.fillRect(0, fy, 390, 4); g.globalAlpha = 1;
}

// ── 노트 ─────────────────────────────
function xOf(tn, t) { return HIT_X + (tn - t) * SPEED; }
function drawNotes(t) {
  const y = L.hitY, maxT = t + 1.35, minT = t - 0.6;
  // 자유 손뼉 표시(판정 없음, V19 종이 결): 크림 종이 네모 + 흰 칼선 + 기울기, 가운데 회청 점. 누르면 터짐
  for (const fr2 of pan.free) fr2.at.forEach((ft, i) => {
    if (ft > maxT || ft < minT || (fr2.pop && fr2.pop[i])) return;
    const x = xOf(ft, t); if (x < -30) return;
    g.save(); g.translate(x, y); g.rotate((R(i, seedOf(String(fr2.t0))) - 0.5) * 0.28);
    g.fillStyle = C.navyD; g.globalAlpha = 0.5; rrect(-12, -10, 26, 26, 5); g.fill(); g.globalAlpha = 1;
    g.fillStyle = C.paper; rrect(-15, -15, 30, 30, 6); g.fill();
    g.fillStyle = C.creamD; rrect(-13, -13, 26, 26, 5); g.fill();
    g.fillStyle = C.slate; circ(0, 0, 4); g.fill();
    g.restore();
  });
  for (const grp of pan.groups) {
    const live = grp.filter(n => !(n.judged && n.res !== 'MISS') && !(n.ghost && t > n.t + 0.25) && !(n.res === 'MISS' && t < n.missT - 0.05));
    if (live.length < 2) continue;
    const a = live[0], b = live[live.length - 1];
    const xa = Math.max(HIT_X, xOf(a.t, t)), xb = xOf(b.tail || b.t, t);
    if (xb < 0 || xa > 420 || xb <= xa) continue;
    g.fillStyle = C.paperD; g.fillRect(xa, y + 20, xb - xa, 5);
  }
  for (const n of pan.ghosts) {
    if (n.t > maxT || n.t < minT) continue;
    const x = xOf(n.t, t); if (x < 8) continue;
    const ft = (t - n.t) * 1000, lit = ft >= 0 && ft < M.note.ghostFlashMs;
    const r = lit ? 23 : 20;
    g.fillStyle = C.navyD; circ(x, y + 2, r); g.fill();
    g.fillStyle = lit ? C.cream : C.slate; circ(x, y, r); g.fill();
    if (t >= n.reveal) { g.fillStyle = C.navyD; g.font = '600 19px ' + F_KANA; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(n.k, x, y + 1); }
  }
  for (const n of pan.notes) {
    if (n.type !== 'hold' || n.t > maxT) continue;
    if (n.judged && n.res !== 'MISS' && !(n.hold && n.hold.active)) continue;
    if (n.res === 'MISS' && t < n.missT - 0.05) continue;
    const active = n.hold && n.hold.active && n.hold.released == null;
    const xa = active ? HIT_X : xOf(n.t, t), xb = xOf(n.end, t);
    if (xb < -10) continue;
    const missed = n.res === 'MISS' || (n.hold && n.hold.released != null);
    g.fillStyle = missed ? C.slateD : active ? C.cream : C.paperD;
    g.fillRect(xa, y - 18, Math.max(0, xb - xa), 36);
    g.fillStyle = C.navy;
    const p0 = Math.ceil(T.pos(n.t) * 2) / 2, p1 = T.pos(n.end);
    for (let p = p0 + 0.5; p < p1 - 0.01; p += 0.5) { const xx = xOf(T.timeOfPos(p), t); if (xx > xa + 4) g.fillRect(xx - 1, y - 11, 2, 22); }
    g.fillStyle = active && n.end - t < T.avgBeat ? C.tan : C.cream;
    rrect(xb - 7, y - 23, 14, 46, 5); g.fill();
    if (n.release === 'shutter') { g.fillStyle = C.navy; g.fillRect(xb - 3, y - 6, 6, 12); }
  }
  for (let i = pan.notes.length - 1; i >= 0; i--) {
    const n = pan.notes[i];
    if (n.t > maxT) continue;
    if (n.judged && n.res !== 'MISS') continue;
    if (n.hold && n.hold.active && n.hold.released == null) { drawDisc(n, HIT_X, y, t, true); continue; }
    const x = xOf(n.t, t);
    if (n.res === 'MISS') { if (t < n.missT - 0.05) continue; const age = t - n.missT; if (age > 0.35 || x < -40) continue; }
    else if (x < -40) continue;
    if (n.side === 'R') { drawSquare(n, x, y, !!n.both); continue; }
    if (n.type === 'pill') {
      const xb = xOf(n.tail, t), miss = n.res === 'MISS';
      g.fillStyle = C.navyD; capsule(x, xb, y + 3, NOTE_R - 1, NOTE_R - 7); g.fill();
      g.fillStyle = C.paper; capsule(x, xb, y, NOTE_R + 1, NOTE_R - 5); g.fill();
      g.fillStyle = miss ? C.slate : C.cream; capsule(x, xb, y, NOTE_R - 1, NOTE_R - 7); g.fill();
      drawKana(n, 0, x, y, t, miss);
      drawKana(n, 1, xb, y, t, true, true);
      continue;
    }
    drawDisc(n, x, y, t, false);
  }
}
function capsule(xa, xb, y, r, r2) { g.beginPath(); g.arc(xa, y, r, PI / 2, PI * 1.5); g.lineTo(xb, y - r2); g.arc(xb, y, r2, -PI / 2, PI / 2); g.lineTo(xa, y + r); g.closePath(); }
// 왼쪽 노트 = 크림 원(지름 58, 왼쪽 버튼 속 도형) + 흰 칼선 + 그림자 1단
function drawDisc(n, x, y, t, pinned) {
  const miss = n.res === 'MISS';
  let sc = 1; const su = (t - n.reveal) / (M.note.stampBeats * T.avgBeat);
  if (su >= 0 && su < 1) sc = 1 + 0.25 * (1 - su);
  g.save(); g.translate(x, y); g.rotate(n.rot * PI / 180); g.scale(sc, sc);
  g.fillStyle = C.navyD; circ(0, 3, NOTE_R); g.fill();
  g.fillStyle = C.paper; circ(0, 0, NOTE_R + 1); g.fill();
  g.fillStyle = miss ? C.slate : C.cream; circ(0, 0, NOTE_R - 1); g.fill();
  if (pinned) { g.strokeStyle = C.tan; g.lineWidth = 4; circ(0, 0, NOTE_R - 3); g.stroke(); }
  g.restore();
  if (n.noKana) { g.fillStyle = miss ? C.navyD : C.navy; circ(x, y, 8); g.fill(); return; }
  drawKana(n, 0, x, y, t, miss);
}
// 오른쪽 노트 = 하늘 둥근 네모(오른쪽 버튼 속 도형, I8 노트 길 위에서도 또렷이). 두 손이면 왼쪽 원 뒤에 큰 네모
function drawSquare(n, x, y, big) {
  const s = big ? 64 : 54, h = s / 2, miss = n.res === 'MISS';
  g.save(); g.translate(x, y); g.rotate(n.rot * PI / 180);
  g.fillStyle = C.navyD; rrect(-h, -h + 3, s, s, 12); g.fill();
  g.fillStyle = C.paper; rrect(-h - 2, -h - 2, s + 4, s + 4, 13); g.fill();
  g.fillStyle = miss ? C.slate : C.sky; rrect(-h, -h, s, s, 11); g.fill();
  if (!big) { g.strokeStyle = C.paper; g.lineWidth = 4; rrect(-11, -11, 22, 22, 5); g.stroke(); }
  g.restore();
}
function drawKana(n, ci, x, y, t, miss, small) {
  if (t < n.reveal) { g.fillStyle = C.slate; g.fillRect(x - 7, y - 2, 14, 4); return; }
  const k = n.kanaChars[ci] || n.kanaChars[0];
  g.textAlign = 'center'; g.textBaseline = 'middle';
  if (small) { g.fillStyle = C.slate; g.font = '600 19px ' + F_KANA; g.fillText(k, x, y); return; }
  const mode = settings.sound, a = fadeAlpha(k), showSnd = mode !== 'off' && a > 0.01;
  g.fillStyle = miss ? C.navyD : C.navy;
  g.font = '600 28px ' + F_KANA; g.fillText(k, x, showSnd ? y - 7 : y);
  if (showSnd) {
    const s = mode === 'ro' ? n.ro[ci] : mode === 'ko+ro' ? n.snd[ci] + n.ro[ci] : n.snd[ci];
    g.globalAlpha = a; g.fillStyle = C.slateD;
    g.font = '400 ' + (mode === 'ko+ro' ? 12 : 14) + 'px ' + F_GO; g.fillText(s, x, y + 15);
    g.globalAlpha = 1;
  }
}

// ── 맞춤 자리 = 시안 D(종이 셔터 고리 + 조리개), V6·V7 고침 ─────────────────────────────
// 다가올 때: 가장 가까운 노트 하나에만 종이 고리(지름 104 → 64, 1박), 네 모서리 L 조각 46 → 34(흰 → 살구 → 귤).
// 맞으면 종이 흰 조리개 6장이 1/32박에 닫히고 1/16박 열림(판정 색 테) + 흰 터짐(PERFECT 61ms · GREAT 40ms) + 종이 조각(노트 길 안·아래로).
function lPiece(cx, cy, sx, sy, arm, th, col, rot) {
  const pts = [[0, 3], [3, 0], [arm, 0], [arm - 4, th], [th, th], [th, arm - 4], [0, arm]];
  for (const [ox, oy, c] of [[2, 3, C.navyD], [0, 0, col]]) {
    g.save(); g.translate(cx + ox, cy + oy); g.rotate(rot); g.scale(-sx, -sy);
    g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.fillStyle = c; g.fill();
    g.restore();
  }
}
function paperRing(x, y, r, k, seed, late) {
  const q = Math.min(3, Math.floor(k * 4)), rot = q * PI / 24 + seed * 0.37;
  const col = late ? C.slate : [C.paper, C.paper, C.apricot, C.tan][q];
  const n = 12, w = 5;
  const path = (ox, oy) => {
    g.beginPath();
    for (let i = 0; i <= n; i++) { const a = rot + i * TAU / n, j = (R(seed, i % n) - 0.5) * 2, rr = r + w / 2 + j; const px = x + ox + Math.cos(a) * rr, py = y + oy + Math.sin(a) * rr; i ? g.lineTo(px, py) : g.moveTo(px, py); }
    for (let i = n; i >= 0; i--) { const a = rot + i * TAU / n, j = (R(seed, i % n) - 0.5) * 2, rr = r - w / 2 + j; g.lineTo(x + ox + Math.cos(a) * rr, y + oy + Math.sin(a) * rr); }
    g.closePath();
  };
  g.globalAlpha = late ? 1 : clamp01(k / 0.25);
  path(1.5, 2.5); g.fillStyle = C.navyD; g.fill('evenodd');
  path(0, 0); g.fillStyle = col; g.fill('evenodd');
  g.globalAlpha = 1;
}
function iris(x, y, Rr, ap, rot, edge) {
  const pts = []; for (let i = 0; i < 6; i++) { const a = rot + i * PI / 3; pts.push([x + Math.cos(a) * ap, y + Math.sin(a) * ap]); }
  g.beginPath(); g.arc(x, y, Rr, 0, TAU);
  if (ap > 0.5) { g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < 6; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); }
  g.fillStyle = C.paper; g.fill('evenodd');
  g.save(); g.beginPath(); g.arc(x, y, Rr, 0, TAU); g.clip();
  g.strokeStyle = edge; g.lineWidth = 2;
  for (let i = 0; i < 6; i++) {
    const p0 = pts[i], p1 = pts[(i + 1) % 6];
    let dx, dy;
    if (ap > 0.5) { dx = p1[0] - p0[0]; dy = p1[1] - p0[1]; const l = Math.hypot(dx, dy); dx /= l; dy /= l; }
    else { const a = rot + i * PI / 3 + PI * 2 / 3; dx = Math.cos(a); dy = Math.sin(a); }
    g.beginPath(); g.moveTo(p0[0], p0[1]); g.lineTo(p0[0] + dx * Rr * 2.2, p0[1] + dy * Rr * 2.2); g.stroke();
  }
  g.restore();
  g.strokeStyle = edge; g.lineWidth = 3; g.beginPath(); g.arc(x, y, Rr, 0, TAU); g.stroke();
}
function drawMarker(t, tReal) {
  const x = HIT_X, y = L.hitY, ab = T.avgBeat, S16 = ab / 4, bi = T.beatInfo(t);
  const ph = phaseAt(t);
  let knockCue = false; for (const k of pan.knocks) if (tReal >= k.t - 0.01 && tReal < k.t + 0.125 * ab) knockCue = true;
  const base = knockCue ? C.tan : ph.who === 'call' ? C.slate : C.paper;
  let near = null;
  for (const n of pan.notes) {
    if (n.judged || (n.hold && n.hold.active) || (n.both && n.side === 'R')) continue;
    const d = n.t - t; if (d > ab) break; if (d < -0.06) continue;
    near = n; break;
  }
  let hs = 46, col = base, tilt = 0, push = 0, drop = 0;
  if (near) { const d = near.t - t, k = clamp01(1 - Math.max(0, d) / ab), q = Math.min(3, Math.floor(k * 4)); hs = 46 - 12 * k; col = d < 0 ? C.tan : [base, base, C.apricot, C.tan][q]; }
  else if (bi.phi < 0.25) push = 2;
  const ln = S.lastJ && tReal - S.lastJ.t < 2 * S16 && tReal >= S.lastJ.t ? S.lastJ : null;
  if (ln) {
    const s = (tReal - ln.t) / S16, gc = GC[ln.res];
    if (ln.res === 'MISS') { tilt = 10; drop = 3; col = C.slate; }
    else if (s < 1) { hs = 34; push = ln.res === 'GOOD' ? 3 : 6; tilt = ln.res === 'GOOD' ? 6 : 12; col = gc.main; }
    else { hs = lerp(34, hs, s - 1); push = 3; tilt = 5; col = ln.res === 'PERFECT' ? gc.sub : gc.main; }
  }
  if (near) { const d = near.t - t, k = clamp01(1 - Math.max(0, d) / ab); paperRing(x, y, d >= 0 ? 32 + 20 * (1 - k) : Math.max(20, 32 + 70 * d), k, seedOf(near.id) % 997, d < 0); }
  if (S.lastJ && S.lastJ.res !== 'MISS') {
    const L2 = S.lastJ, s = (tReal - L2.t) / S16;
    if (s >= 0 && s < 1.5) {
      const Rr = 31, apMin = { PERFECT: 0, GREAT: 0.45, GOOD: 0.75 }[L2.res] * Rr;
      const ap = s < 0.5 ? lerp(Rr, apMin, 1 - Math.pow(1 - s / 0.5, 2)) : lerp(apMin, Rr, Math.pow((s - 0.5) / 1, 2));
      iris(x, y, Rr, ap, 0.35 + (1 - ap / Rr) * PI / 3, GC[L2.res].main);
    }
  }
  const holding = S.holding && S.holding.hold && S.holding.hold.active && S.holding.hold.released == null;
  if (holding) {
    const n = S.holding, u = clamp01((t - n.t) / (n.end - n.t));
    g.strokeStyle = C.navyD; g.lineWidth = 5; circ(x, y, 37); g.stroke();
    g.strokeStyle = C.tan; g.lineWidth = 5; g.beginPath(); g.arc(x, y, 37, -PI / 2, -PI / 2 + u * TAU); g.stroke();
  }
  const lp = S.lastPress;
  if (!ln && tReal - lp.t >= 0 && tReal - lp.t < 0.16 * ab) col = lp.side === 'R' ? C.sky : C.paper;
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const rr = (ln && ln.res === 'MISS' ? tilt * sx : -tilt * sx * sy) * PI / 180;
    lPiece(x + sx * (hs + push), y + sy * (hs + push) + drop, sx, sy, 16, 6, col, rr);
  }
}

// ── 터짐·날아가는 글자·끝 종이 조각 ─────────────────────────────
function shard(x, y, s, rot, seed, col) {
  const pts = []; for (let i = 0; i < 4; i++) { const a = rot + i * PI / 2 + (R(seed, i) - 0.5) * 0.7, rr = s * (0.7 + R(seed, i + 5) * 0.5); pts.push([Math.cos(a) * rr, Math.sin(a) * rr]); }
  for (const [ox, oy, c] of [[1.5, 2, C.navyD], [0, 0, col]]) { g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(x + ox + p[0], y + oy + p[1]) : g.moveTo(x + ox + p[0], y + oy + p[1])); g.closePath(); g.fillStyle = c; g.fill(); }
}
const SHARD = {
  PERFECT: { n: 12, cols: ['main', 'main', 'sub', 'main', 'paper', 'sub'], d: [38, 64], size: [7, 11], life: 3.5, flashMs: 61 },
  GREAT: { n: 8, cols: ['main', 'paper', 'main'], d: [30, 52], size: [6, 9], life: 3, flashMs: 40 },
  GOOD: { n: 4, cols: ['main'], d: [22, 36], size: [5, 7], life: 2.5 },
  MISS: { n: 3, cols: ['main'], d: [0, 6], size: [5, 7], life: 4, fall: true },
};
function drawFx(t) {
  const S16 = T.avgBeat / 4;
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i];
    if (f.k === 'shards') {   // 조각: 첫 2/16박에 거의 다 튀고 멈칫 → 떨어짐. 위로는 0.45배(무대 쪽 16px까지, V7). 30프레임 끊어 움직임
      const a = t - f.t0, sp = SHARD[f.res], s = a / S16;
      if (s > sp.life || a < -0.5) { fx.splice(i, 1); continue; }
      if (a < 0) continue;
      const gc = GC[f.res], tq = Math.floor(a * 30) / 30, u = s / sp.life, x = HIT_X, y = L.hitY;
      if (sp.flashMs && a < sp.flashMs / 1000) { g.fillStyle = C.paper; g.globalAlpha = f.res === 'PERFECT' ? 1 : 0.8; poly(x, y, f.res === 'PERFECT' ? 38 : 34, 8, PI / 8); g.fill(); g.globalAlpha = 1; }
      for (let j = 0; j < sp.n; j++) {
        const ang = sp.fall ? PI / 2 + (R(f.seed, j) - 0.5) * 0.8 : -PI / 2 + (R(f.seed, j) - 0.5) * PI * 1.5;
        const D = lerp(sp.d[0], sp.d[1], R(f.seed, j + 40)) * (Math.cos(ang) < 0 ? 0.6 : 1), sz = lerp(sp.size[0], sp.size[1], R(f.seed, j + 80)) * (u > 0.7 ? 1 - (u - 0.7) / 0.3 : 1);
        const vy = Math.sin(ang) < 0 ? 0.45 : 1;
        const ox = x + Math.cos(ang) * 24, oy = y + Math.sin(ang) * (sp.fall ? 10 : 24) * vy;
        const e = 1 - Math.pow(1 - Math.min(1, tq / (2 * S16)), 3), fallT = Math.max(0, tq - S16);
        const px = ox + Math.cos(ang) * D * e, py = oy + Math.sin(ang) * D * e * vy + (sp.fall ? 260 * tq * tq : 240 * fallT * fallT);
        const key = sp.cols[j % sp.cols.length], c = key === 'paper' ? C.paper : gc[key];
        if (sz > 0.5) shard(px, py, sz, R(f.seed, j + 120) * TAU + (R(f.seed, j + 160) - 0.5) * 16 * tq, f.seed * 50 + j, c);
      }
      continue;
    }
    const u = (t - f.t0) / f.dur;
    if (u >= 1 || u < -0.5) { fx.splice(i, 1); continue; }
    if (u < 0) continue;
    const dt = t - f.t0;
    if (f.k === 'bit') {
      const x = f.x + f.vx * dt, y = f.y + f.vy * dt + 160 * dt * dt, s = 1 - u * 0.5;
      g.save(); g.translate(x, y); g.rotate(f.rot); g.fillStyle = f.col; g.fillRect(-4 * s, -4 * s, 8 * s, 8 * s); g.restore();
    } else if (f.k === 'confetti') {   // 끝 한 방 종이 조각 24(팔레트 4색), 30프레임 끊어 떨어짐
      const tq = Math.floor(dt * 30) / 30, x = f.x + f.vx * tq + Math.sin(tq * 5 + f.rot) * 8, y = f.y + f.vy * tq + 140 * tq * tq;
      if (y > L.footY) continue;
      g.save(); g.translate(x, y); g.rotate(f.rot + f.vr * tq); g.fillStyle = C.navyD; g.globalAlpha = 0.5; g.fillRect(-f.s / 2 + 1, -f.s / 4 + 2, f.s, f.s / 2); g.globalAlpha = 1; g.fillStyle = f.col; g.fillRect(-f.s / 2, -f.s / 4, f.s, f.s / 2); g.restore();
    } else if (f.k === 'spark') {
      const lp = lensPos(), r = 5 + 3 * u; g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.6 * (1 - u); g.fillStyle = C.paper;
      g.beginPath(); g.moveTo(lp.x, lp.y - r); g.lineTo(lp.x + r * 0.25, lp.y - r * 0.25); g.lineTo(lp.x + r, lp.y); g.lineTo(lp.x + r * 0.25, lp.y + r * 0.25); g.lineTo(lp.x, lp.y + r); g.lineTo(lp.x - r * 0.25, lp.y + r * 0.25); g.lineTo(lp.x - r, lp.y); g.lineTo(lp.x - r * 0.25, lp.y - r * 0.25); g.closePath(); g.fill();
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    } else if (f.k === 'fly') {
      const e = 1 - Math.pow(1 - u, 2), lp = lensPos();
      const x = f.x0 + (lp.x - f.x0) * e, y = f.y0 + (lp.y - f.y0) * e - 20 * Math.sin(u * PI), r = 12 * (1 - 0.55 * u);
      if (u > 0.85 && !f.sp) { f.sp = true; fx.push({ k: 'spark', t0: t, dur: 0.125 * T.avgBeat }); }
      g.fillStyle = C.cream; circ(x, y, r); g.fill();
      g.fillStyle = C.navy; g.font = '600 ' + Math.round(15 * (1 - 0.4 * u)) + 'px ' + F_KANA; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(f.txt, x, y + 1);
    }
  }
}

// ── 버튼 = 두꺼운 판지 원(지름 96, 두께 8 → 누르면 2, V13) ─────────────────────────────
// 그쪽 노트가 1박 안이면(I8): 판지가 6px 들리고, 버튼 둘레 고리가 노트와 같은 빠르기로 줄어 노트 시각에 버튼 가장자리에 닿음(왼쪽 크림 · 오른쪽 하늘).
// 손뼉이 없는 난이도면 오른쪽은 자유 손뼉 구간에서만 밝음. 연습 중 MISS면 그쪽 테두리 1박 귤 깜빡임(I5)
function nearNote(side, t) {
  for (const n of pan.notes) { if (n.side !== side || n.judged || (n.hold && n.hold.active)) continue; const d = n.t - t; if (d > T.avgBeat) break; if (d >= -0.05) return n; }
  return null;
}
function drawPads(tv, t) {
  const inFree = pan.free.some(fr2 => S.tStage >= fr2.t0 - 0.5 && S.tStage < fr2.t1), ab = T.avgBeat;
  for (const side of ['L', 'R']) {
    const x = side === 'L' ? 104 : 286, y = L.padY, P = S.pads[side], R0 = PAD_R;
    const on = side === 'L' || S.rightOn || inFree;
    const nn = on ? nearNote(side, tv) : null;
    const th = P.down ? 2 : nn ? 14 : 8, top = y - th;
    g.fillStyle = C.navyD; g.globalAlpha = 0.2; circ(x + 3, y + 7, R0 + 3); g.fill(); g.globalAlpha = 1;
    g.fillStyle = C.paper; circ(x, y, R0 + 3); g.fill(); circ(x, top, R0 + 3); g.fill(); g.fillRect(x - R0 - 3, top, 2 * R0 + 6, th);
    g.fillStyle = C.navyD; circ(x, y, R0); g.fill(); g.fillRect(x - R0, top, 2 * R0, th);
    g.fillStyle = on ? C.navy : C.slateD; circ(x, top, R0); g.fill();
    const lit = on && P.down;
    if (side === 'L') {
      if (lit) { g.fillStyle = C.cream; circ(x, top, 16); g.fill(); }
      else { g.strokeStyle = on ? C.cream : C.slate; g.lineWidth = 5; circ(x, top, 14); g.stroke(); }
    } else {
      if (lit) { g.fillStyle = C.sky; rrect(x - 16, top - 16, 32, 32, 7); g.fill(); }
      else { g.strokeStyle = on ? C.sky : C.slate; g.lineWidth = 5; rrect(x - 14, top - 14, 28, 28, 6); g.stroke(); }
    }
    const pm = S.pracMiss;
    if (pm && pm.side === side) { const a = (t - pm.t) / ab; if (a >= 0 && a < 1 && Math.floor(a * 4) % 2 === 0) { g.strokeStyle = C.tan; g.lineWidth = 4; circ(x, top, R0 + 1); g.stroke(); } }
    if (nn) {   // 다가오는 고리(홈 막대 자리는 잘라 냄)
      const d = nn.t - tv, k = clamp01(1 - Math.max(0, d) / ab), r = R0 + 3 + 26 * (1 - k);
      g.save(); g.beginPath(); g.rect(0, 0, 390, L.B - 30); g.clip();
      g.globalAlpha = clamp01(k / 0.25);
      g.strokeStyle = C.navyD; g.lineWidth = 7; circ(x, top, r); g.stroke();
      g.strokeStyle = side === 'L' ? C.cream : C.sky; g.lineWidth = 3.5; circ(x, top, r); g.stroke();
      g.globalAlpha = 1; g.restore();
    }
    const u = (t - P.t) / (0.24 * ab);
    if (u >= 0 && u < 1 && !P.empty) { g.strokeStyle = side === 'L' ? C.paper : C.sky; g.lineWidth = 4 * (1 - u) + 1; circ(x, top, R0 + 6 + 18 * u); g.stroke(); }
  }
}

// ── 판정 = 고무 도장(친 쪽 버튼 위, V15 종이 흰 바탕 + 그림자): PERFECT 귤 꽉 찬 도장 · GREAT 짙은 하늘 테두리 · GOOD 회청 · MISS 회청 연필 X ─────────────────────────────
const STAMP = { PERFECT: { col: C.tan, fs: 20, rot: -6, fill: true }, GREAT: { col: C.skyD, fs: 18, rot: -4 }, GOOD: { col: C.slateD, fs: 16, rot: -3 }, MISS: { col: C.slateD, fs: 16, rot: 4 } };
function drawStamps(t) {
  for (const side of ['L', 'R']) {
    const c = S.chips[side]; if (!c) continue;
    const age = t - c.t0; if (age > 0.55 || age < 0) continue;
    const sp = STAMP[c.res], x = side === 'R' ? 286 : 104, y = L.stampY;
    const sc = age < 0.08 ? 1.25 - 0.25 * (age / 0.08) : 1, a = age > 0.42 ? 1 - (age - 0.42) / 0.13 : 1;
    g.save(); g.globalAlpha = a; g.translate(x, y); g.rotate(sp.rot * PI / 180); g.scale(sc, sc);
    g.font = '400 ' + sp.fs + 'px ' + F_DELA; g.textAlign = 'center'; g.textBaseline = 'middle';
    const w = Math.ceil(g.measureText(c.res).width) + 20, h = sp.fs + 12;
    g.fillStyle = C.navyD; g.globalAlpha = 0.45 * a; rrect(-w / 2 + 2, -h / 2 + 3, w, h, 6); g.fill(); g.globalAlpha = a;
    g.fillStyle = C.paper; rrect(-w / 2, -h / 2, w, h, 6); g.fill();
    if (c.res === 'MISS') {
      g.fillStyle = sp.col; g.fillText('MISS', 0, 1);
      g.strokeStyle = C.navy; g.lineWidth = 3; g.lineCap = 'round';
      g.beginPath(); g.moveTo(-w / 2 + 8, -h / 2 + 5); g.lineTo(w / 2 - 8, h / 2 - 5); g.moveTo(w / 2 - 10, -h / 2 + 4); g.lineTo(-w / 2 + 10, h / 2 - 4); g.stroke(); g.lineCap = 'butt';
    } else if (sp.fill) {
      g.fillStyle = sp.col; rrect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4, 5); g.fill();
      g.strokeStyle = C.paper; g.lineWidth = 1.5; rrect(-w / 2 + 5, -h / 2 + 5, w - 10, h - 10, 3); g.stroke();
      g.fillStyle = C.paper; g.fillText(c.res, 0, 1);
    } else {
      g.strokeStyle = sp.col; g.lineWidth = 2.5; rrect(-w / 2 + 3, -h / 2 + 3, w - 6, h - 6, 5); g.stroke();
      g.fillStyle = sp.col; g.fillText(c.res, 0, 1);
    }
    g.restore();
    if ((c.res === 'GREAT' || c.res === 'GOOD') && c.delta != null && c.fastSlow) {
      g.globalAlpha = a; g.font = '400 ' + sp.fs + 'px ' + F_DELA; const hw = (Math.ceil(g.measureText(c.res).width) + 20) / 2;
      g.font = '400 15px ' + F_GO; g.fillStyle = C.navy; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillText(c.delta < 0 ? '빠름' : '늦음', x + hw + 8, y + 2); g.globalAlpha = 1;
    }
  }
}

// ── 글자 카드 = 수첩에서 뜯은 쪽(V9: 왼쪽 스프링 구멍 5 · 고르지 않은 찢긴 끝 · 손 밑줄 · 떨어져 붙는 등장 · 박마다 숨쉬기) + 테이프 한 조각 ─────────────────────────────
function cardGeom(ph) {
  const n = ph.kana.length, row = ph.kind === 'row', snd = ph.kind === 'sound';
  const fs = row ? 40 : snd ? 42 : 44, step = row ? 50 : snd ? 62 : 50;
  const w = Math.max(168, Math.ceil(((n - 1) * step + fs + 64) / 8) * 8), h = row || snd ? 104 : 122;
  return { fs, step, w, h, x0: 8 - (n - 1) * step / 2 };
}
function tornPath(w, h, seed, ox, oy, both) {
  const x0 = -w / 2 + ox, y0 = oy;
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + w, y0); g.lineTo(x0 + w, y0 + h - 3);
  let x = x0 + w, i = 0;
  while (x > x0) { i++; x -= 6 + R(seed, i) * 12; g.lineTo(Math.max(x0, x), y0 + h - 3 + (R(seed, i + 50) * 5 - 1)); }
  if (both) { let y = y0 + h; while (y > y0) { i++; y -= 6 + R(seed, i) * 10; g.lineTo(x0 - 1 + R(seed, i + 70) * 3, Math.max(y0, y)); } }
  g.lineTo(x0, y0); g.closePath();
}
// 떨어져 붙는 등장: 위에서 −18px·−5°로 1/8박에 내려앉고 마지막 1/16박 0.97 눌림
function dropIn(age, bl) {
  const u = age / (0.125 * bl);
  if (u < 1) { const e = 1 - (1 - u) * (1 - u); return { dy: -18 * (1 - e), rot: -5 * (1 - e) * PI / 180, sy: 1 }; }
  const v = (age - 0.125 * bl) / (0.0625 * bl);
  return { dy: 0, rot: 0, sy: v < 1 ? 0.97 + 0.03 * v : 1 };
}
function drawCard(t) {
  let ph = null;
  for (const p of pan.phrases) if (t >= p.call0 - 0.08 && t < p.resp1) ph = p;
  if (!ph) { drawLyric(t); return; }
  const G = cardGeom(ph), bl = T.avgBeat, seed = seedOf(ph.id), bi = T.beatInfo(t);
  const age = t - (ph.call0 - 0.08), D = dropIn(age, bl);
  const ru = (t - (ph.resp0 - M.card.shrinkBeats * bl)) / (M.card.shrinkBeats * bl);
  const resp = ru > 0;
  const breathe = 1 + 0.02 * Math.max(0, 1 - bi.phi / 0.3) * mot();
  const sc = (1 - (1 - M.card.respScale) * clamp01(ru)) * breathe;
  g.save(); g.translate(195, L.cardTop + D.dy); g.rotate(ph.rot * PI / 180 + D.rot); g.scale(sc, sc * D.sy);
  g.fillStyle = C.navyD; g.globalAlpha = 0.55; tornPath(G.w, G.h, seed, 2, 3); g.fill(); g.globalAlpha = 1;
  g.strokeStyle = C.paper; g.lineWidth = 6; g.lineJoin = 'round'; tornPath(G.w, G.h, seed, 0, 0); g.stroke(); g.lineJoin = 'miter';
  g.fillStyle = resp ? C.creamD : C.cream; g.fill();   // 받는 마디엔 남색 10% 덮은 크림(V8: 카드 < 하나)
  g.fillStyle = C.navyD; g.globalAlpha = 0.55;
  for (let i = 0; i < 5; i++) { circ(-G.w / 2 + 11, 14 + i * 19, 3.5); g.fill(); }
  g.globalAlpha = 1;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const mode = settings.sound;
  for (let i = 0; i < ph.kana.length; i++) {
    const kx = G.x0 + i * G.step, ky = 40;
    const at = ph.at[i], lit = t >= at && t < at + M.card.litBeats * bl, sung = t >= at;
    g.save(); g.translate(kx, ky); if (lit) g.scale(1.12, 1.12);
    g.fillStyle = sung ? C.navy : C.slate; g.font = '600 ' + G.fs + 'px ' + F_KANA; g.fillText(ph.kana[i], 0, 0);
    g.restore();
    if (ph.hitIdx.has(i)) {   // 손 밑줄: 사다리꼴(두께 5 → 2), −3°, 길이 = 글자 폭 0.8
      const len = G.fs * 0.8, x1 = kx - len / 2, x2 = kx + len / 2, yy = ky + G.fs / 2 + 3, dy2 = -Math.tan(3 * PI / 180) * len;
      g.fillStyle = C.tan; g.beginPath(); g.moveTo(x1, yy - 2.5); g.lineTo(x2, yy + dy2 - 1); g.lineTo(x2, yy + dy2 + 1); g.lineTo(x1, yy + 2.5); g.closePath(); g.fill();
    }
    if (ph.kind === 'sound' && i < ph.kana.length - 1) { g.fillStyle = t >= ph.at[i + 1] ? C.navy : C.slate; g.font = '600 ' + Math.round(G.fs * 0.7) + 'px ' + F_KANA; g.fillText('・', kx + G.step / 2, ky); }
    if ((ph.kind === 'row' || ph.kind === 'sound') && mode !== 'off') {
      const a = fadeAlpha(ph.kana[i]); if (a > 0.01) {
        g.globalAlpha = a; g.fillStyle = sung ? C.slateD : C.slate; g.font = '400 16px ' + F_GO;
        g.fillText(mode === 'ro' ? ph.ro[i] : mode === 'ko+ro' ? ph.snd[i] + ' ' + ph.ro[i] : ph.snd[i], kx, ky + 43); g.globalAlpha = 1;
      }
    }
  }
  if (ph.kind === 'word') {
    let line = '';
    if (mode !== 'off') { const ko = ph.snd.join(''), ro = ph.ro.join(''); line = mode === 'ro' ? ro : mode === 'ko+ro' ? ko + ' · ' + ro : ko; }
    const a = Math.max(...ph.kana.map(fadeAlpha));
    g.font = '400 16px ' + F_GO; g.fillStyle = C.slateD;
    if (line && a > 0.01) { g.globalAlpha = a; g.fillText(line, 8, 80); g.globalAlpha = 1; }
    if (settings.meaning && ph.mean) { g.font = '400 15px ' + F_GO; g.fillStyle = C.navy; g.fillText('뜻 · ' + ph.mean, 8, 101); }
  }
  g.save(); g.rotate((R(seed, 3) - 0.5) * 0.14); g.globalAlpha = 0.9; g.fillStyle = C.sun;
  g.beginPath(); g.moveTo(-22, -7); g.lineTo(22, -7); g.lineTo(20, 0); g.lineTo(22, 7); g.lineTo(-22, 7); g.lineTo(-20, 0); g.closePath(); g.fill();
  g.restore();
  g.restore();
}
// 가사 = 크림 종이 띠(V17): 양 끝 찢김 + ±1.5° + 카드와 같은 붙는 등장
function drawLyric(t) {
  let ly = null; for (const l of pan.lyrics) if (t >= l.t0 && t < l.t1) ly = l;
  if (!ly) return;
  const D = dropIn(t - ly.t0, T.avgBeat);
  g.font = ly.jp ? '600 19px ' + F_KANA : '400 17px ' + F_GO;
  const tw = g.measureText(ly.text).width, w = Math.ceil((tw + 40) / 8) * 8, h = 42, seed = seedOf(ly.text);
  g.save(); g.translate(195, L.cardTop + 14 + D.dy); g.rotate((R(seed, 1) - 0.5) * 0.052 + D.rot); g.scale(1, D.sy);
  const strip = (ox, oy) => {
    g.beginPath(); g.moveTo(-w / 2 + ox, oy);
    let x = -w / 2, i = 0; while (x < w / 2) { i++; x += 8 + R(seed, i) * 10; g.lineTo(Math.min(w / 2, x) + ox, oy + R(seed, i + 30) * 3); }
    let y = 0; while (y < h) { i++; y += 7 + R(seed, i) * 6; g.lineTo(w / 2 + ox - R(seed, i + 60) * 3, Math.min(h, y) + oy); }
    x = w / 2; while (x > -w / 2) { i++; x -= 8 + R(seed, i) * 10; g.lineTo(Math.max(-w / 2, x) + ox, oy + h - R(seed, i + 90) * 3); }
    y = h; while (y > 0) { i++; y -= 7 + R(seed, i) * 6; g.lineTo(-w / 2 + ox + R(seed, i + 120) * 3, Math.max(0, y) + oy); }
    g.closePath();
  };
  g.fillStyle = C.navyD; g.globalAlpha = 0.55; strip(2, 3); g.fill(); g.globalAlpha = 1;
  g.strokeStyle = C.paper; g.lineWidth = 5; g.lineJoin = 'round'; strip(0, 0); g.stroke(); g.lineJoin = 'miter';
  g.fillStyle = C.cream; g.fill();
  g.fillStyle = C.navy; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ly.text, 0, h / 2 + 1);
  g.restore();
}
// 연습 안내(명세 4절 · 검토 I5·S1): 두 줄(무엇 + 언제) + 버튼 속 도형 + 성공 점. 카드와 인물 사이(얼굴을 안 가림). MISS면 '괜찮아요 · 다시 한 번'
function drawStrip(main, sub, icon, dots, ok, subHot) {
  g.font = '400 17px ' + F_GO; const tw1 = g.measureText(main).width; g.font = '400 13px ' + F_GO; const tw2 = g.measureText(sub).width;
  const tw = Math.max(tw1, tw2), w = Math.ceil((tw + 52 + (dots ? 18 * dots + 10 : 0)) / 8) * 8, h = 52;
  const y = Math.max(L.cardTop + 112, Math.min(L.cardTop + 150, L.footY - 250));
  g.save(); g.translate(195, y); g.rotate(-0.012);
  g.fillStyle = C.navyD; g.globalAlpha = 0.55; g.fillRect(-w / 2 + 2, 3, w, h); g.globalAlpha = 1;
  g.fillStyle = C.paper; g.fillRect(-w / 2 - 3, -3, w + 6, h + 6);
  g.fillStyle = C.cream; g.fillRect(-w / 2, 0, w, h);
  let x = -w / 2 + 22;
  if (icon === 'R') { g.fillStyle = C.sky; rrect(x - 10, h / 2 - 10, 20, 20, 5); g.fill(); }
  else { g.fillStyle = C.navy; circ(x, h / 2, 11); g.fill(); g.fillStyle = C.cream; circ(x, h / 2, 6); g.fill(); }
  x += 20;
  g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillStyle = C.navy; g.font = '400 17px ' + F_GO; g.fillText(main, x, 18);
  g.fillStyle = subHot ? C.tan : C.slateD; g.font = '400 13px ' + F_GO; g.fillText(sub, x, 38);
  x += tw + 14;
  for (let i = 0; i < (dots || 0); i++) { const on = i < ok; g.fillStyle = on ? C.tan : C.cream; g.strokeStyle = on ? C.tan : C.navy; g.lineWidth = 2; circ(x + i * 18 + 6, h / 2, 6); g.fill(); g.stroke(); }
  g.restore();
}
function drawPractice(t) {
  const P = S.prac;
  if (P) {
    const pm = S.pracMiss, miss = pm && t - pm.t >= 0 && t - pm.t < 1.5 * T.avgBeat;
    drawStrip(P.passed ? '좋아요!' : P.line, P.passed ? '곧 곡이 시작돼요' : miss ? '괜찮아요 · 다시 한 번' : P.sub || '', P.icon, P.need, P.ok, miss && !P.passed);
    return;
  }
  const H = pan.hint;   // 쉬움 첫 자유 손뼉 구간 한 번(I4)
  if (H && S.hintOn && t >= H.t0 && t < H.t1) drawStrip(H.line, H.sub, H.icon, 0, 0, false);
}

// ── 위 묶음: 진홍 책갈피 리본(일시정지) · 크림 종이 띠 기차 노선(진행) · 귀 잉크 원 도장(콤보, V14 숫자 24px) ─────────────────────────────
function drawHud(t) {
  const T0 = L.T;
  const yb = T0 + 57, rx = 16, rw = 32;
  const rib = (ox, oy) => { g.beginPath(); g.moveTo(rx + ox, -4 + oy); g.lineTo(rx + rw + ox, -4 + oy); g.lineTo(rx + rw + ox, yb + oy); g.lineTo(rx + rw / 2 + ox, yb - 10 + oy); g.lineTo(rx + ox, yb + oy); g.closePath(); };
  g.fillStyle = C.navyD; g.globalAlpha = 0.55; rib(2, 3); g.fill(); g.globalAlpha = 1;
  g.strokeStyle = C.paper; g.lineWidth = 4; g.lineJoin = 'round'; rib(0, 0); g.stroke(); g.lineJoin = 'miter';
  g.fillStyle = C.crimson; g.fill();
  g.fillStyle = C.paper; g.fillRect(rx + 10, yb - 34, 4, 14); g.fillRect(rx + 18, yb - 34, 4, 14);
  if (pan.kind === 'run') drawTrain(t);
  if (S.combo >= 3) {
    const bu = (t - S.comboT) / 0.1, sc = bu >= 0 && bu < 1 ? 1.15 - 0.15 * bu : 1;
    g.save(); g.translate(342, T0 + 33); g.rotate(-8 * PI / 180); g.scale(sc, sc);
    g.fillStyle = C.navyD; g.globalAlpha = 0.55; circ(2, 3, 28); g.fill(); g.globalAlpha = 1;
    g.fillStyle = C.paper; circ(0, 0, 30); g.fill();
    g.fillStyle = C.cream; circ(0, 0, 27); g.fill();
    g.strokeStyle = C.tan; g.lineWidth = 3; circ(0, 0, 24); g.stroke();
    g.fillStyle = C.tan; g.textAlign = 'center'; g.textBaseline = 'middle';
    const s = String(S.combo); g.font = '400 ' + (s.length > 2 ? 18 : 24) + 'px ' + F_DELA; g.fillText(s, 0, -4);
    g.font = '400 10px ' + F_GO; g.fillText('콤보', 0, 13);
    g.restore();
  }
}
function drawTrain(t) {
  const T0 = L.T, w = 240, h = 24, cx = 64 + w / 2, cy = T0 + 29;
  g.save(); g.translate(cx, cy); g.rotate(-PI / 180);
  g.fillStyle = C.navyD; g.globalAlpha = 0.55; g.fillRect(-w / 2 + 2, -h / 2 + 3, w, h); g.globalAlpha = 1;
  g.fillStyle = C.paper; g.fillRect(-w / 2 - 3, -h / 2 - 3, w + 6, h + 6);
  g.fillStyle = C.cream; g.fillRect(-w / 2, -h / 2, w, h);
  const lx0 = -w / 2 + 16, lx1 = w / 2 - 16, span = pan.hitAt - pan.from;
  const px = tt => lx0 + (lx1 - lx0) * clamp01((tt - pan.from) / span);
  const prog = clamp01((t - pan.from) / span);
  g.fillStyle = C.navy; g.fillRect(lx0, -1.5, lx1 - lx0, 3);
  g.fillStyle = C.tan; g.fillRect(lx0, -1.5, (lx1 - lx0) * prog, 3);
  const st = pan.scenes.map(s => Math.max(pan.from, s.t0)).concat([pan.hitAt]);
  for (const s of st) { const x = px(s), on = t >= s - 0.01; g.fillStyle = C.navy; circ(x, 0, 5.5); g.fill(); g.fillStyle = on ? C.tan : C.cream; circ(x, 0, 3); g.fill(); }
  const fx0 = lx0 + (lx1 - lx0) * prog, face = IMG.face_look || IMG.face_smile;
  g.fillStyle = C.navyD; g.globalAlpha = 0.55; circ(fx0 + 1, -1, 13); g.fill(); g.globalAlpha = 1;
  g.fillStyle = C.paper; circ(fx0, -3, 13); g.fill();
  if (face) { g.save(); circ(fx0, -3, 11.5); g.clip(); g.fillStyle = C.sky; g.fillRect(fx0 - 12, -15, 24, 24); g.drawImage(face, fx0 - 13, -16, 26, 26); g.restore(); }
  g.restore();
}
function drawCount(t) {
  const bl = T.avgBeat, left = Math.ceil((S.countTo - t) / bl);
  if (left < 1 || left > 3) return;
  const u = 1 - ((S.countTo - t) / bl - (left - 1));
  g.save(); g.translate(195, L.footY - 230); g.scale(1.2 - 0.2 * Math.min(1, u * 3), 1.2 - 0.2 * Math.min(1, u * 3));
  g.fillStyle = C.navyD; g.globalAlpha = 0.55; circ(3, 4, 54); g.fill(); g.globalAlpha = 1;
  g.fillStyle = C.paper; circ(0, 0, 56); g.fill(); g.fillStyle = C.cream; circ(0, 0, 52); g.fill();
  g.font = '400 64px ' + F_DELA; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = C.navy; g.fillText(String(left), 0, 4);
  g.restore();
}
function drawDebug(t, d) {
  g.font = '600 11px ' + F_GO; g.textAlign = 'left'; g.textBaseline = 'top'; g.fillStyle = C.paper;
  const lines = ['곡 ' + t.toFixed(3) + 's', 'fps ' + d.fps + ' · 그리기 ' + S.lastDrawMs.toFixed(2) + 'ms', '보정 소리 ' + d.offsetMs + ' · 화면 ' + d.visualMs + 'ms · 출력 ' + d.lat];
  lines.forEach((s, i) => g.fillText(s, 70, L.T + 64 + i * 13));
}

// ── 시험용 ─────────────────────────────
export const LAY = { HIT_X, SPEED, NOTE_R, PAD_R };
export function visibility(t) {
  const area = 390 * L.H, hud = 32 * 61 + 246 * 30 + (S.combo >= 3 ? 60 * 60 : 0);
  let card = 0;
  if (pan) for (const p of pan.phrases) if (t >= p.call0 && t < p.resp1) { const G = cardGeom(p); card = G.w * (G.h + 8); }
  const stage = 390 * L.footY, bg = pan ? bake(sceneAt(t).bg) : null;
  return { withCard: (stage - hud - card) / area, noCard: (stage - hud) / area, hanaH: 170 / L.H, lightsPct: bg ? bg.lightsPct : null, scene: pan ? sceneAt(t).id : null };
}
// 장면 사진(결과 수첩): 발 선 위 330px를 잘라 240px 폭으로
export function capturePhoto() {
  const top = Math.max(0, L.footY - 330), hh = L.footY + 4 - top, w = 240, h = Math.round(240 * hh / 390);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.drawImage(cv, L.ox * dpr, top * L.s * dpr, 390 * L.s * dpr, hh * L.s * dpr, 0, 0, w, h);
  return c;
}
