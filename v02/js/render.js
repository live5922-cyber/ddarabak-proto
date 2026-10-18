// render.js · 캔버스 그리기. 배치 = 연주 화면 A2 v2(research/jp/2026-10-18_layout_A2.md 4절), 색 = 3안(2026-10-18_color_redesign.md 4절)
// 좌표는 아이폰 12 CSS px(폭 390). 위 묶음(HUD·카드)은 위 안전 영역(T), 아래 묶음(무대 판~패드)은 아래 기준(B)에 붙임.
// 무대(배경·인형)만 멈춤·흔들림·박 움직임. 노트·버튼·판정 띠는 멈추거나 흔들지 않음(기획안 6절).
// 인물 = 동작 이어 그림(anim.js, 스톱모션식) + 얕은 코드 움직임(강박 눌림·착지·종이 흔들림). 10-19 검토(화면 M1~M13·L1·K1, 리듬 I4·I5·I8·S4·S9) 반영.
import { settings, fadeAlpha } from './settings.js';
import { createActor } from './poses.js';
import { createAnimator, idleFrame } from './anim.js';

export const C = {
  navy: '#283A66', navyD: '#1B2745', tan: '#FF6C2F', paper: '#FFF8EC', paperD: '#C7DCF2', slate: '#8C96B4', slateD: '#656C82',
  sky: '#62A8E5', skyD: '#4779A5', wood: '#B28F79', woodD: '#8A6C5A',
};
const PI = Math.PI;
const HIT_X = 64, SPEED = 295.1;   // px/초 = 가장 짧은 박 488ms → 144px. 노트 길 오른쪽 끝(390)에서 맞춤 자리까지 1.105초
const FONT_KO = '"Pretendard Variable", Pretendard, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
const FONT_NOTE = '"M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", sans-serif';
const FONT_CARD = '"Klee One", "M PLUS Rounded 1c", "Hiragino Mincho ProN", serif';

let cv, g, dpr = 1, L = null, M = null, LIB = null, IMG = null, STG = null, AL = null, AM = null;
let pan = null, T = null, bg = null;
const bgCache = {};
let truck = null, HA = null, UA = null;
const fx = [];
const snow = [];
const S = {
  chip: null, combo: 0, comboT: -9, pads: { L: { down: false, t: -9 }, R: { down: false, t: -9 } }, lastPress: { t: -9, side: 'L' },
  shutterT: -9, flashT: -9, freezeUntil: -9, freezeAt: 0, shakeUntil: -9,
  endT: null, endShown: false, cells: {}, stampT: {}, holding: null, countFrom: null, countTo: null, rightOn: false,
  lastDrawMs: 0, tStage: -1e9, allowBack: true, missAlt: 0, idleMemo: [], demo: null, lightsPct: null,
};
export function getState() { return S; }

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
  HA = createAnimator(AL, M, 'hana'); UA = createAnimator(AL, M, 'uncle'); UA.scale = 1;
  for (let i = 0; i < M.snow.back + M.snow.front; i++) snow.push({ x: Math.random() * 420 - 15, ph: Math.random(), sw: Math.random() * PI * 2, rot: Math.random() * PI, front: i >= M.snow.back, sz: i >= M.snow.back ? 3 + Math.random() * 2 : 1.5 + Math.random() * 1.0 });
  resize();
}
export function animators() { return { HA, UA }; }
export function tintAtlas(img) {   // 아틀라스 그림자 판(남색 그늘)
  const c = document.createElement('canvas'); c.width = img.naturalWidth || img.width; c.height = img.naturalHeight || img.height;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = C.navyD; x.fillRect(0, 0, c.width, c.height);
  return c;
}

// 배경 굽기: 3안 물림(값은 motion.json bgFilter) + 창 불빛 판 두 무리(Lab으로 고름) + 노트 길 아래 어둡게 구운 판
function srgbLin(v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
const LIN = new Float32Array(256); for (let i = 0; i < 256; i++) LIN[i] = srgbLin(i);
function lab(r, g2, b) {
  const R = LIN[r], G = LIN[g2], B = LIN[b];
  let X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
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
  const la = document.createElement('canvas'), lb = document.createElement('canvas'); la.width = lb.width = w; la.height = lb.height = gy;
  const LA = la.getContext('2d').createImageData(w, gy), LB = lb.getContext('2d').createImageData(w, gy);
  const dk = document.createElement('canvas'); dk.width = w; dk.height = Math.max(1, h - gy);
  const DK = dk.getContext('2d').createImageData(w, Math.max(1, h - gy));
  const sat = s => [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s];
  const BF = Object.assign({}, M.bgFilter, (M.bgFilter.perBg || {})[id] || {}), LG = M.lights;
  const mS = sat(BF.sat), mW = sat(BF.warmSat || 0.7), cl = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const wl = LG.winLab; let nLight = 0, nTop = 0;
  const mask = new Uint8Array(w * gy);
  const nd = [0x1B / 255, 0x27 / 255, 0x45 / 255];
  for (let y = 0, i = 0; y < h; y++) for (let xx = 0; xx < w; xx++, i += 4) {
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
    } else {
      const j = i - gy * w * 4;
      DK.data[j] = (cr * 0.32 + nd[0] * 0.68) * 255; DK.data[j + 1] = (cg * 0.32 + nd[1] * 0.68) * 255; DK.data[j + 2] = (cb * 0.32 + nd[2] * 0.68) * 255; DK.data[j + 3] = 255;
    }
    d[i] = cr * 255; d[i + 1] = cg * 255; d[i + 2] = cb * 255;
  }
  // 이어진 덩어리 이름 붙이기(창 하나·유리면 하나가 통째로 켜지게) → 덩어리마다 두 무리 중 하나. 8px 넘는 덩어리만
  const lab2 = new Int32Array(w * gy), stack = new Int32Array(w * gy); let comp = 0;
  for (let p = 0; p < w * gy; p++) {
    if (!mask[p] || lab2[p]) continue;
    comp++; let sp = 0, pts = []; stack[sp++] = p; lab2[p] = comp;
    while (sp) { const q = stack[--sp]; pts.push(q); const qx = q % w, qy = (q / w) | 0;
      if (qx > 0 && mask[q - 1] && !lab2[q - 1]) { lab2[q - 1] = comp; stack[sp++] = q - 1; }
      if (qx < w - 1 && mask[q + 1] && !lab2[q + 1]) { lab2[q + 1] = comp; stack[sp++] = q + 1; }
      if (qy > 0 && mask[q - w] && !lab2[q - w]) { lab2[q - w] = comp; stack[sp++] = q - w; }
      if (qy < gy - 1 && mask[q + w] && !lab2[q + w]) { lab2[q + w] = comp; stack[sp++] = q + w; } }
    if (pts.length < 8) continue;
    const T2 = (comp * 2654435761 >>> 0) & 2 ? LB.data : LA.data;
    for (const q of pts) { const i4 = q * 4; T2[i4] = d0[i4]; T2[i4 + 1] = d0[i4 + 1] * 0.92; T2[i4 + 2] = d0[i4 + 2] * 0.7; T2[i4 + 3] = 255; nLight++; }
  }
  x.putImageData(id0, 0, 0);
  la.getContext('2d').putImageData(LA, 0, 0); lb.getContext('2d').putImageData(LB, 0, 0); dk.getContext('2d').putImageData(DK, 0, 0);
  return (bgCache[id] = { c, la, lb, dk, info, w, h, gy, lightsPct: Math.round(nLight / nTop * 1000) / 10 });
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
  const deckTop = Math.round(B - 256);
  L = { s, ox: (cw - 390 * s) / 2, oy: 0, cw, ch, W: 390, H, T: T0, B, deckTop, laneTop: deckTop + 12, laneBot: deckTop + 84, hitY: deckTop + 48,
    padY: B - 84, chipY: B - 140, pressTop: deckTop + 84, cardTop: T0 + 65, footY: deckTop + 6, hanaX: 112, callerX: 262, truckX: 262 };
  if (S.layoutB) L.footY = Math.round(H * 0.52);   // 2차 배치 시안(사용자 고름 전, 비교 그림용)
}
export function getLayout() { return L; }

// ── 판 ─────────────────────────────
export function setPan(p, t) {
  pan = p; T = p.T; bg = bake(p.bg);
  S.rightOn = p.notes.some(n => n.side === 'R');
  // 노트마다 치기 동작 고르기(같은 것 연속 없음, 되감아도 같게): 받는 덩어리 첫 노트 = 가리키기
  let prevL = null, prevR = null, k = 0, prevT = -1e9;
  for (const n of p.notes) {
    k++;
    // 예비 칸: 앞 노트와 0.75박 넘게 떨어졌으면 ready(−0.5) → wind(−0.25), 가까우면 wind만(V1)
    const gapB = (n.t - prevT) / T.beatInfo(n.t).beatLen; prevT = n.end || n.t;
    n.pre = n.type === 'hold' ? AM.hold.pre : gapB < AM.shortGap ? AM.preShort : AM.pre;
    if (n.side === 'R') { n.motion = HA.pickFrom(AM.hitR, k * 3.1, prevR); prevR = n.motion; continue; }
    const first = n.round && n.round[0] === n && AL.motions[AM.roundFirstL];
    n.motion = first ? AM.roundFirstL : HA.pickFrom(AM.hitL, k * 1.7, prevL);
    prevL = n.motion;
  }
  resetVisuals(t);
}
export function setTitleBg(id) { bg = bake(id); pan = null; T = null; S.endT = null; HA.clear(); UA.clear(); }
export function resetVisuals(t) {
  fx.length = 0; S.chip = null; S.combo = 0; S.cells = {}; S.stampT = {}; S.holding = null;
  S.countFrom = null; S.shutterT = -9; S.flashT = -9; S.freezeUntil = -9; S.shakeUntil = -9; S.allowBack = true; S.missAlt = 0;
  S.endT = pan ? pan.hitAt : null; S.endShown = false;
  HA.clear(); UA.clear(); HA.resetStats(); UA.resetStats();
  if (pan) {   // 글자 줄 카드가 펴질 때 놀람 한 칸(F2 sur)
    for (const ph of pan.phrases) if (AM.card.kinds.includes(ph.kind)) { const bl = T.beatInfo(ph.call0).beatLen; HA.add('card', ph.call0 + AM.card.frames[0][1] * bl, ph.call0 + AM.card.end * bl, AM.card.motion, AM.card.frames.map(f => [f[0], ph.call0 + f[1] * bl])); }
  }
}
export function setCountIn(from, to) { S.countFrom = from; S.countTo = to; fx.length = 0; S.allowBack = true; HA.cancel('hit', from); HA.cancel('react', from); }
export function setDemo(d) { S.demo = d; }
export function setLayoutB(on) { S.layoutB = !!on; resize(); }

// ── 사건(main 이 부름) ─────────────────────────────
export function press(side, t, empty) { const p = S.pads[side]; p.down = true; p.t = t; p.empty = !!empty; S.lastPress = { t, side }; }
export function release(side) { S.pads[side].down = false; }
function nextAfter(n) { for (const x of pan.notes) if (x !== n && !x.judged && x.t > n.t + 0.01) return x; return null; }
function anchorTime(kind, t) {
  if (kind === 'press') return t;
  const p = T.pos(t + 0.0625 * T.beatInfo(t).beatLen);
  return kind === 'next16' ? T.timeOfPos(Math.ceil(p * 4) / 4) : kind === 'next8' ? T.timeOfPos(Math.ceil(p * 2) / 2) : T.timeOfPos(Math.ceil(p));
}
function nextCall(t) { let c = Infinity; for (const ph of pan.phrases) if (ph.call0 > t + 0.01 && ph.call0 < c) c = ph.call0; return c; }
function preStart(n) { const bn = T.beatInfo(n.t).beatLen; return n.t + (n.pre || AM.pre)[0][1] * bn; }
// 판정 뒤 동작(움직임 재검토 V1·V6): 맞히면 hit 칸이 늘 먼저(0.125박 이상). 다음 노트가 1박 안이면 hit → bounce → settle → 다음 노트 예비(ready·wind)로 바로 이어 붙임(들을 때 칸으로 안 떨어짐).
// 1박 넘게 없으면 판정 반응(16분·8분 격자). 누른 MISS는 hit 대신 그 자리에서 미끄러짐·머리 긁기, 안 누른 MISS는 다음 박. 반응은 다음 부름 0.25박 전에 끊음.
function hitClip(n, res, t, pressed) {
  const bl = T.beatInfo(t).beatLen, nx = nextAfter(n), gap = nx ? (nx.t - t) / bl : 99;
  const motion = n.motion || AM.hitL[0], R = AM.react;
  const nxPre = nx ? preStart(nx) : Infinity, cut = Math.min(nxPre, nextCall(t) - R.beforeCall * bl);
  if (res === 'MISS') {
    const rx = R.MISS[(S.missAlt++) % R.MISS.length];
    const at = pressed ? t : anchorTime(R.missPass, t);
    const fr = (pressed ? [] : R.missPassPre.map(f => [f[0], at + f[1] * bl])).concat(rx.frames.map(f => [f[0], at + f[1] * bl]));
    const t0 = pressed ? t : fr[0][1], t1 = Math.min(at + rx.end * bl, cut);
    if (t1 > t0 + 0.02) HA.add('react', t0, t1, rx.motion, fr);
    const MR = AM.uncle.missRelax; UA.add('miss', t, t + MR.beats * bl, MR.motion, [[MR.key, t]]);   // MISS면 아저씨 손뼉 대신 1박 손 내림
    return;
  }
  if (!pressed) return;
  const rx = gap > AM.reactMinGap ? R[res] : null;
  if (rx) {
    const at = anchorTime(rx.anchor, t);
    const fr = rx.frames.map(f => [f[0], at + f[1] * bl]);
    const r0 = Math.max(t + 0.125 * bl, fr[0][1]);
    HA.add('hit', t, r0, motion, [['hit', t], ['bounce', t + 0.125 * bl], ['settle', t + 0.25 * bl]]);
    const t1 = Math.min(at + rx.end * bl, cut);
    if (t1 > r0 + 0.02) HA.add('react', r0, t1, rx.motion, fr);
    return;
  }
  const t1 = gap <= AM.nextWithin ? nxPre : t + AM.afterEnd * bl;
  HA.add('hit', t, Math.max(t + 0.125 * bl, t1), motion, AM.after.map(f => [f[0], t + f[1] * bl]));
}
export function judged(r, t) {
  const n = r.note, res = r.res;
  if (r.how === 'lift' || r.how === 'regrab') return;
  if (res) S.chip = { res, t0: t, delta: r.delta, side: n.side, hold: r.how === 'head' || r.how === 'lategrab', fastSlow: r.fastSlow !== false };
  if (res === 'MISS') { n.missT = t; hitClip(n, 'MISS', t, r.how !== 'pass'); return; }
  if (r.how === 'head' || r.how === 'lategrab') { S.holding = n; n.pressT = t; S.shutterT = t; burst(res, t); return; }
  if (r.how === 'release' || r.how === 'auto' || r.how === 'early-release') {
    S.holding = null;
    const bl = T.beatInfo(t).beatLen, H = AM.hold;
    HA.add('hit', t, t + H.releaseEnd * bl, H.motion, H.release.map(f => [f[0], t + f[1] * bl]));
    if (r.ok) burst(res, t);
    if (n.release === 'shutter' && r.ok) flash(t);
    return;
  }
  S.shutterT = t;
  hitClip(n, res, t, true);
  burst(res, t);
  fly(n, t);
  if (res === 'PERFECT') {
    const bi = T.beatInfo(n.t);
    S.freezeAt = t; S.freezeUntil = t + (bi.first && bi.phi < 0.1 ? M.stage.freezeBarMs : M.stage.freezePerfectMs) / 1000;
    if (bi.first && bi.phi < 0.1) S.shakeUntil = t + M.stage.freezeBarMs / 1000;
  }
}
// 자유 손뼉(판정·점수·콤보 없음): 가까운 표시를 터뜨리고, 하나 손뼉 칸, 작은 종이 꽃가루
export function freeClap(t) {
  const bl = T.beatInfo(t).beatLen;
  for (const fr of pan.free) { if (!fr.pop) fr.pop = {}; fr.at.forEach((ft, i) => { if (!fr.pop[i] && Math.abs(ft - t) < 0.2) fr.pop[i] = t; }); }
  HA.add('hit', t, t + 0.5 * bl, 'A2_clap', [['clap', t], ['open', t + 0.125 * bl], ['wide', t + 0.25 * bl], ['close', t + 0.375 * bl]]);
  for (let i = 0; i < 6; i++) { const a = (70 + i * 40) * PI / 180, v = 90 + Math.random() * 60; fx.push({ k: 'bit', t0: t, dur: 0.45, x: HIT_X + 30, y: L.hitY - 10, vx: Math.cos(a) * v, vy: -Math.sin(a) * v, rot: i, col: i % 2 ? C.paper : C.sky }); }
}
export function stamp(k, t) { if (!S.cells[k]) { S.cells[k] = true; S.stampT[k] = t; } }
export function setCombo(n, t) { if (n !== S.combo) { S.combo = n; S.comboT = t; } }
// 콤보 고비(V7): 다음 노트가 2박 넘게 없으면 강박(1·3박)에 점프. 부르는 구절과 겹치면 다음 빈 강박으로 미루고, 없으면 생략. 아저씨 군고구마도 부름과 안 겹칠 때만
function overlapsCall(a, b, bl) { for (const ph of pan.phrases) if (a < ph.resp0 && b > ph.call0 - 0.25 * bl) return true; return false; }
export function comboMilestone(t) {
  const C2 = AM.combo, bl = T.beatInfo(t).beatLen;
  let nx = null; for (const x of pan.notes) if (!x.judged && x.t > t) { nx = x; break; }
  let p = Math.ceil(T.pos(t + 0.06));
  for (let tries = 0; tries < 8; tries++, p++) {
    if ((((p - 2) % 4) + 4) % 4 % 2 !== 0) continue;
    const at = T.timeOfPos(p), endT = at + C2.end * bl;
    if (at > pan.hitAt - 1) return false;
    if (nx && ((nx.t - t) / bl < C2.minGap || preStart(nx) < endT)) return false;
    if (overlapsCall(at, endT, bl)) continue;
    HA.add('react', at, endT, C2.motion, C2.frames.map(f => [f[0], at + f[1] * bl]), { arc: { t0: at + C2.arc.from * bl, t1: at + C2.arc.to * bl, H: C2.arc.H } });
    const P = AM.uncle.potato; if (!overlapsCall(at, at + 2 * bl, bl)) UA.add('combo', at, at + 2 * bl, P.motion, P.order.map((k, i) => [k, at + i * P.per * bl]));
    return true;
  }
  return false;
}
export function endHit(t) { S.endShown = true; flash(t); }
function flash(t) { if (t - S.flashT > 1.0) S.flashT = t; }

function burst(res, t) {
  const x = HIT_X, y = L.hitY;
  if (res === 'PERFECT') {
    for (let i = 0; i < 8; i++) {
      const a = (100 + i * 160 / 7 + (Math.random() - 0.5) * 12) * PI / 180, v = 150 + Math.random() * 110;
      fx.push({ k: 'strip', t0: t, dur: 0.42, x, y, vx: Math.cos(a) * v, vy: -Math.sin(a) * v, rot: Math.random() * PI, vr: (Math.random() - 0.5) * 14, col: i % 2 ? C.paper : C.tan });
    }
  } else if (res === 'GREAT') fx.push({ k: 'ring', t0: t, dur: 0.26, x, y });
  else if (res === 'GOOD') for (let i = 0; i < 3; i++) { const a = (130 + i * 50) * PI / 180; fx.push({ k: 'bit', t0: t, dur: 0.3, x, y, vx: Math.cos(a) * 110, vy: -Math.sin(a) * 110, rot: i, col: C.paperD }); }
}
// 맞힌 글자는 하나 카메라 렌즈(지금 칸의 하늘색 덩어리)로 낮게 날아감(호 높이 20, 0.375박) → 얼굴을 안 가림(움직임 재검토 V2)
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
  if (r.who) return r;
  for (const l of pan.lyrics) if (t >= l.t0 && t < l.t1) return { who: 'sing', ly: l };
  return r;
}
const mot = () => settings.motion === 'less' ? 0.4 : 1;

// ── 인물 칸 고르기 ─────────────────────────────
function idleMotion(block) {
  const memo = S.idleMemo, list = Object.keys(AM.idle).filter(m => AL.motions[m]);
  if (!list.length) return null;
  if (block < 0) block = 0;
  while (memo.length <= block) { const k = memo.length; memo.push(k === 0 ? list[0] : HA.pickFrom(list, k * 5.3 + 1, memo[k - 1])); }
  return memo[block];
}
function lastKey(frames, t, t0, bl) { let k = null; for (const f of frames) if (t >= t0 + f[1] * bl) k = f[0]; return k; }
function arcOf(a, bl, t0) { return a ? { t0: t0 + a.from * bl, t1: t0 + a.to * bl, H: a.H } : null; }
function hanaSel(t, play) {
  if (S.demo) return S.demo;
  const bi = beatInfoAny(t), bl = bi.beatLen;
  const holding = S.holding && S.holding.hold && S.holding.hold.active && S.holding.hold.released == null;
  // 판 끝: 누르는 중이면 끝 −0.125박부터 뜀(판 2 셔터 길게 → 점프가 끊기지 않게, V5)
  if (play && pan && S.endT != null && t >= S.endT + AM.end.frames[0][1] * bl && !(holding && t < S.endT - 0.125 * bl)) {
    const fr = holding ? AM.end.frames.filter(f => f[1] >= -0.125) : AM.end.frames;
    const k = lastKey(fr, t, S.endT, bl); if (k) return { motion: AM.end.motion, key: k, kind: 'end', arc: arcOf(AM.end.arc, bl, S.endT) };
  }
  if (play) {
    const c = HA.active(t); if (c && c.kind !== 'card') return c;
    if (holding) {
      const h = S.holding, dt = (t - h.pressT) / bl, H = AM.hold;
      if (dt < 0.125) return { motion: H.motion, key: H.press, kind: 'hold' };
      return { motion: H.motion, key: H.sustain[Math.floor((dt - 0.125) / H.sustainEvery) % 2], kind: 'hold' };
    }
    if (pan) {
      let n = null; for (const x of pan.notes) if (!x.judged && !(x.hold && x.hold.active) && x.t > t - 0.25) { n = x; break; }
      if (n) {
        const bn = T.beatInfo(n.t).beatLen, mo = n.type === 'hold' ? AM.hold.motion : n.motion;
        const k = lastKey(n.pre || AM.pre, t, n.t, bn);
        if (k && AL.motions[mo]) return { motion: mo, key: k, kind: 'pre' };
      }
    }
    if (c) return c;
    // 아저씨가 부를 때: 듣기(박마다 두 칸) + 글자마다 끄덕(V7)
    if (pan) for (const ph of pan.phrases) {
      if (t >= ph.call0 && t < ph.resp0 - 0.5 * bl) {
        const Ls = AM.listen; let nod = false; for (const a of ph.at) if (t >= a && t < a + Ls.nodBeats * bl) nod = true;
        return { motion: Ls.motion, key: idleFrame(Ls, bi.p), kind: 'listen', nod };
      }
    }
  }
  const block = Math.floor((bi.bar - 1) / AM.idleSwitchBars);
  const m = idleMotion(block); if (!m) return null;
  return { motion: m, key: idleFrame(AM.idle[m], bi.p), kind: 'idle' };
}
// 아저씨: 끝 > 부르는 구절(부름·가리키기가 늘 먼저, 콤보가 입을 덮지 않음) > 덧붙임(콤보 군고구마·MISS 손 내림) > 받는 마디 응원 > 쉼 고리 셋(2마디마다, 하나와 1마디 엇갈림, V8)
function uncleSel(t, play) {
  const U = AM.uncle, bi = beatInfoAny(t), bl = bi.beatLen;
  if (play && pan && S.endT != null && t >= S.endT) return { motion: U.potato.motion, key: idleFrame(U.potato, T.pos(t) - T.pos(S.endT)), kind: 'end' };
  let ph = null, resp = false;
  if (play && pan) for (const p of pan.phrases) { if (t >= p.call0 + U.breatheAt * bl && t < p.resp0) ph = p; else if (t >= p.resp0 && t < p.resp1) resp = true; }
  if (ph) {
    const pk = lastKey(U.point.frames, t, ph.resp0, bl);
    if (pk) return { motion: U.point.motion, key: pk, kind: 'point' };
    const a0 = ph.at[0];
    if (t < a0) return { motion: U.call, key: 'breathe', kind: 'call' };
    let a = a0; const last = ph.at[ph.at.length - 1]; for (const x of ph.at) if (x <= t) a = x;
    if (t < a + U.holdAfter * bl) return { motion: U.call, key: 'call', kind: 'call' };
    if (a === last && t >= a + U.relaxAfter * bl) return { motion: U.call, key: 'relax', kind: 'call' };
    return { motion: U.call, key: 'hold', kind: 'call' };
  }
  if (play) { const c = UA.active(t); if (c) return c; }
  if (resp) return { motion: U.cheer.motion, key: idleFrame(U.cheer, bi.p), kind: 'cheer' };
  const R = U.rest, blk = Math.floor((bi.bar - 1 + U.restOffsetBars) / U.restSwitchBars), sp = R[((blk % R.length) + R.length) % R.length];
  return { motion: sp.motion, key: idleFrame(sp, bi.p), kind: 'rest' };
}

// ── 그리기 ─────────────────────────────
export function draw(t, mode, dbg, visualMs) {
  const t0 = performance.now();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = C.navyD; g.fillRect(0, 0, cv.width, cv.height);
  g.setTransform(dpr * L.s, 0, 0, dpr * L.s, L.ox * dpr, L.oy * dpr);
  g.save(); g.beginPath(); g.rect(0, 0, 390, L.H); g.clip();
  const play = mode === 'play' || mode === 'pause';
  // 무대 시간: 되감기·다시 하기 때만 뒤로 감(곡 시계 흔들림으로 칸이 왔다 갔다 하지 않게, 화면 검토 M11)
  let ts = t;
  if (play) { if (S.allowBack || t >= S.tStage) { S.tStage = t; S.allowBack = false; } ts = S.tStage; if (ts < S.freezeUntil) ts = S.freezeAt; }
  const tv = t + (visualMs || 0) / 1000;   // 노트·고리·박 눈금만 화면 지연 보정(리듬 검토 I5)
  drawStage(ts, play);
  drawDeck(tv, play);
  if (play && pan) { drawNotes(tv); drawTarget(tv, t); drawFx(t); drawPads(t); drawChip(t); drawCard(t); drawHud(t); if (S.countFrom != null && t < S.countTo) drawCount(t); }
  if (dbg) drawDebug(t, dbg);
  g.restore();
  S.lastDrawMs = performance.now() - t0;
}

function drawStage(t, play) {
  const bi = beatInfoAny(t), mk = mot(), bl = bi.beatLen;
  const bump = (M.stage.bumpScale - 1) * mk * Math.max(0, 1 - bi.phi / M.stage.bumpBeats) * (bi.first ? 1 : 0.35);
  let shake = 0; if (play && t < S.shakeUntil) shake = Math.sin(t * 90) * M.stage.shakePx * mk;
  g.save(); g.translate(shake, 0);
  if (bg) {
    const k = Math.max(390 / bg.w, L.footY / bg.info.groundY);
    const bw = bg.w * k, x0 = 195 - bg.info.focusX * k, y0 = L.footY - bg.info.groundY * k;
    const cx = 195, cy = L.footY;
    // 겹친 종이 층 흉내: 먼 층·가운데 층·앞 바닥 세 띠가 2박 주기로 서로 다르게 출렁 + 마디 첫 박 확대(먼 층일수록 작게)
    const sway = Math.sin(bi.p * PI) * mk;
    const bands = [[0, bg.gy - 520 / k * 0.98, 0.6, 0.4], [bg.gy - 520 / k, bg.gy - 150 / k, 1.2, 0.7], [bg.gy - 150 / k, bg.gy + 10 / k, 2.0, 1.0]];
    const yTop = Math.max(0, -y0 / k);
    for (const [s0, s1, amp, bf] of bands) {
      const a = Math.max(yTop, s0), b = Math.min(bg.h, s1); if (b <= a) continue;
      const sc = 1 + bump * bf, dx = sway * amp;
      g.drawImage(bg.c, 0, a, bg.w, b - a, cx + (x0 - cx) * sc + dx, cy + (y0 + a * k - cy) * sc, bw * sc, (b - a) * k * sc);
    }
    if (y0 > 0) { g.fillStyle = bg.info.sky; g.fillRect(0, 0, 390, y0 + 1); }
    if (S.layoutB) {   // 땅 아래도 장면(배경 끝 줄을 화면 끝까지 늘림)
      const a = bg.gy + 10 / k; g.drawImage(bg.c, 0, a, bg.w, bg.h - a, x0, y0 + a * k, bw, (bg.h - a) * k);
      const ye = y0 + bg.h * k; if (ye < L.H) g.drawImage(bg.c, 0, bg.h - 3, bg.w, 3, x0, ye - 1, bw, L.H - ye + 2);
    }
    // 창 불빛: 박마다 두 무리 번갈아, 마디 첫 박은 둘 다(콤보 10부터 더 밝게)
    const la = (S.combo >= 10 ? M.lights.comboAlpha : M.lights.alpha) * mk * Math.max(0, 1 - bi.phi / M.lights.decayBeats);
    if (la > 0.01) {
      g.globalCompositeOperation = 'lighter'; g.globalAlpha = la * 0.5;
      const dl = (img) => g.drawImage(img, 0, yTop, bg.w, bg.gy - yTop, x0 + sway * 0.6, y0 + yTop * k, bw, (bg.gy - yTop) * k);
      if (bi.first || S.combo >= 10) { dl(bg.la); dl(bg.lb); } else dl(bi.beat % 2 ? bg.la : bg.lb);
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    }
    S.bgGeom = { k, x0, y0 };
  }
  drawSnow(t, false, bi);
  // 트럭: 8분마다 1px 공회전, 마디 첫 박 화덕 불빛, 박마다 김
  const tk = truck.look(t).pose;
  if (tk && tk.img) {
    const sc = tk.cssPerPx, ph8 = (bi.p * 2) % 1, bob = ph8 < 0.25 ? 1 : 0;
    const x = L.truckX + tk.footX * sc, y = L.footY + bob;
    drawPose(tk, x, y, 1, 1, 0);
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
  // 아저씨 · 하나 (이어 그림)
  const us = uncleSel(t, play); UA.note(t, us, L.callerX, bl);
  drawAnim(UA, us, L.callerX, L.footY, t, AM.code.callerScale);
  const hs = hanaSel(t, play); HA.note(t, hs, L.hanaX, bl);
  drawAnim(HA, hs, L.hanaX, L.footY, t, 1);
  drawSnow(t, true, bi);
  const fa = (t - S.flashT) * 1000;
  if (fa >= 0 && fa < M.stage.flashMs) { g.fillStyle = C.paper; g.globalAlpha = M.stage.flashAlpha * (1 - fa / M.stage.flashMs) * mk; g.fillRect(0, 0, 390, L.deckTop); g.globalAlpha = 1; }
  g.restore();
}
function drawAnim(an, sel, X, groundY, t, codeMul) {
  if (!sel) return;
  const f = an.frame(sel.motion, sel.key); if (!f) return;
  const CD = AM.code, bi = beatInfoAny(t), bl = bi.beatLen, mk = mot() * codeMul;
  const sc = AL.cssPerPx;
  // 강박 눌림(가로 = 1 ÷ 세로) · 치기 눌림 3% · 착지 눌림 0.88 → 1.04 → 1(V4) · 듣기 끄덕 · 종이 흔들림은 동작이 바뀔 때만(S1)
  const u = bi.phi / CD.squashBeats;
  let sy = u < 1 ? 1 - (bi.beat % 2 ? CD.strongSquash : CD.weakSquash) * (1 - u) * (1 - u) * mk : 1;
  const u2 = (t - an.curT) / (CD.landBeats * bl);
  if (sel.key === 'land' && u2 >= 0) { if (u2 < 1) sy = 1 - CD.landSquash * mot(); else if (u2 < 2) sy = CD.landOver - (CD.landOver - 1) * (u2 - 1); }
  else if (sel.key === 'hit' && u2 >= 0 && u2 < 1) sy *= 1 - CD.hitSquash * (1 - u2) * mot();
  if (sel.nod) sy *= AM.listen.nodSy;
  const sx = 1 / sy;
  const sgn = bi.i % 2 ? -1 : 1;
  let tilt = CD.tiltDeg * sgn * Math.cos(PI * bi.phi) * mk;
  const dms = (t - an.motionT) * 1000; if (dms >= 0 && dms < CD.wobbleMs * 4) tilt += CD.wobbleDeg * Math.exp(-dms / CD.wobbleMs) * Math.cos(dms / 1000 * 2 * PI * 7) * mot();
  // 높이: 점프는 코드 포물선 H·4u(1−u)(칸은 자세만, V4), 그 밖은 그림의 lift
  let liftCss = f.lift * sc;
  if (sel.arc) { const ua = (t - sel.arc.t0) / (sel.arc.t1 - sel.arc.t0); liftCss = ua > 0 && ua < 1 ? sel.arc.H * 4 * ua * (1 - ua) * mot() : 0; }
  drawFootShadow(X, groundY, 32 * (1 - Math.min(0.4, liftCss / 120)));
  g.save(); g.translate(X, groundY - liftCss); g.rotate(tilt * PI / 180); g.scale(sx, sy);
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
function drawFootShadow(x, y, w) {
  g.fillStyle = C.navyD;
  g.beginPath(); g.moveTo(x - w, y + 1); g.lineTo(x - w * 0.6, y - 3); g.lineTo(x + w * 0.6, y - 3); g.lineTo(x + w, y + 1); g.lineTo(x + w * 0.6, y + 4); g.lineTo(x - w * 0.6, y + 4); g.closePath(); g.fill();
}
function drawSnow(t, front, bi) {
  const mk = mot(); if (!mk) return;
  const fall = (front ? M.snow.frontFallBeats : M.snow.backFallBeats) * idleBeat, maxY = L.deckTop - 8;
  g.fillStyle = front ? C.paper : C.paperD;
  for (const f of snow) {
    if (f.front !== front) continue;
    const u = ((t / fall + f.ph) % 1 + 1) % 1, y = -10 + u * (maxY + 10);
    if (y > maxY) continue;
    const x = f.x + Math.sin((t / (M.snow.swayBeats * idleBeat)) * 2 * PI + f.sw) * M.snow.swayPx;
    poly(x, y, f.sz, 6, f.rot + (front ? Math.floor(bi.p) * 0.26 : 0)); g.fill();
  }
}
function poly(x, y, r, n, rot) { g.beginPath(); for (let i = 0; i < n; i++) { const a = rot + i * 2 * PI / n; const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; i ? g.lineTo(px, py) : g.moveTo(px, py); } g.closePath(); }
function cutRect(x, y, w, h, tr, bl) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + w - tr, y); g.lineTo(x + w, y + tr); g.lineTo(x + w, y + h); g.lineTo(x + bl, y + h); g.lineTo(x, y + h - bl); g.closePath(); }

// ── 무대 판·노트 길·바닥 ─────────────────────────────
function drawDeck(t, play) {
  const ph = play && pan ? phaseAt(t) : { who: null }, bi = beatInfoAny(t), mk = mot();
  if (S.layoutB) {   // 2차 배치 시안: 무대 판 없음, 노트 길은 남색 0.82 띠로 장면 위에 얹음
    g.globalAlpha = 0.82; g.fillStyle = C.navy; g.fillRect(0, L.laneTop, 390, 72); g.globalAlpha = 1;
    g.fillStyle = ph.who === 'resp' ? C.paper : C.slate; g.fillRect(0, L.laneTop - 4, 390, 4);
  } else {
    g.fillStyle = C.wood; g.fillRect(0, L.deckTop, 390, 12);
    g.fillStyle = ph.who === 'resp' ? C.paper : C.slate; g.fillRect(0, L.deckTop + 8, 390, 4);
    g.fillStyle = C.navy; g.fillRect(0, L.laneTop, 390, 72);
    // 노트 길 아래 = 종이 인형극 '무대 앞판'(움직임 재검토 V3 1차): 남색 종이 두 장(위 모서리 직선 꺾임) + 맨 앞 회청 눈 둑(박에 출렁, 누른 쪽 반이 살짝 내려감)
    const y0 = L.laneBot + 8, H = L.H, sw = Math.sin(bi.p * PI) * mk, bump = (M.stage.bumpScale - 1) * Math.max(0, 1 - bi.phi) * (bi.first ? 1 : 0.35) * mk;
    g.fillStyle = C.navyD; g.fillRect(0, L.laneBot, 390, H - L.laneBot);
    g.fillStyle = C.navy;
    g.beginPath(); g.moveTo(-4, y0 + 10 + sw * 0.6); g.lineTo(108, y0 + 2); g.lineTo(232, y0 + 13 - sw * 0.6); g.lineTo(394, y0 + 4); g.lineTo(394, H); g.lineTo(-4, H); g.closePath(); g.fill();
    g.fillStyle = C.navyD;
    const y1 = y0 + 64;
    g.beginPath(); g.moveTo(-4, y1 + 8); g.lineTo(140 + sw, y1 - 4); g.lineTo(286 + sw, y1 + 10); g.lineTo(394, y1); g.lineTo(394, H); g.lineTo(-4, H); g.closePath(); g.fill();
    const by = H - 26, cx = 195;
    const dip = s => { const p = S.pads[s]; return p && p.down && t - p.t < 0.0625 * (T ? T.avgBeat : idleBeat) * 2 ? 2 : 0; };
    const dl = dip('L'), dr = dip('R'), sc = 1 + bump * 0.6, dx = sw * 2;
    const X = x => cx + (x - cx) * sc + dx;
    g.fillStyle = C.slateD;   // 눈 둑: 회청 그늘(바닥이 인물·노트보다 덜 띄게)
    g.beginPath(); g.moveTo(X(-6), by + 6 + dl); g.lineTo(X(92), by - 4 + dl); g.lineTo(X(196), by + 5 + (dl + dr) / 2); g.lineTo(X(300), by - 6 + dr); g.lineTo(X(396), by + 3 + dr); g.lineTo(396, H + 2); g.lineTo(-6, H + 2); g.closePath(); g.fill();
    g.fillStyle = C.navy; g.fillRect(-6, by + 18, 402, H - by);
    if (S.combo >= 10) {   // 콤보 10부터 눈 둑 위 종이 눈송이 셋이 박마다 튐
      g.fillStyle = C.paper;
      for (let i = 0; i < 3; i++) { const hop = Math.sin(Math.min(1, bi.phi * 2) * PI) * 10 * mk; poly(X(70 + i * 125), by - 4 - hop * (0.6 + 0.2 * i), 3.2, 6, bi.p + i); g.fill(); }
    }
  }
  g.fillStyle = C.navyD; g.fillRect(0, L.laneBot, 390, 8);
  if (play && T) {
    const p0 = Math.ceil(T.pos(t - 0.3)), p1 = Math.floor(T.pos(t + 1.3));
    for (let p = p0; p <= p1; p++) {
      const x = HIT_X + (T.timeOfPos(p) - t) * SPEED; if (x < -4 || x > 394) continue;
      const first = ((p - 2) % 4 + 4) % 4 === 0;
      g.fillStyle = first ? C.paper : C.slate;
      if (first) g.fillRect(x - 2, L.laneBot + 1, 4, 7); else g.fillRect(x - 1, L.laneBot + 1, 2, 5);
    }
  }
}

// ── 노트 ─────────────────────────────
function xOf(tn, t) { return HIT_X + (tn - t) * SPEED; }
function drawNotes(t) {
  const y = L.hitY, maxT = t + 1.3, minT = t - 0.6;
  // 자유 손뼉 표시(판정 없음): 옅은 회청 둥근 네모가 곡 박 자리로 흘러감, 누르면 터짐
  for (const fr of pan.free) fr.at.forEach((ft, i) => {
    if (ft > maxT || ft < minT || (fr.pop && fr.pop[i])) return;
    const x = xOf(ft, t); if (x < -30) return;
    g.strokeStyle = C.slate; g.lineWidth = 3; cutRect(x - 18, y - 18, 36, 36, 8, 8); g.stroke();
    g.fillStyle = C.slate; g.fillRect(x - 6, y - 6, 12, 12);
  });
  for (const grp of pan.groups) {
    const live = grp.filter(n => !(n.judged && n.res !== 'MISS') && !(n.ghost && t > n.t + 0.25) && !(n.res === 'MISS' && t < n.missT - 0.05));
    if (live.length < 2) continue;
    const a = live[0], b = live[live.length - 1];
    const xa = Math.max(HIT_X, xOf(a.t, t)), xb = xOf(b.tail || b.t, t);
    if (xb < 0 || xa > 420 || xb <= xa) continue;
    g.fillStyle = C.paperD; g.fillRect(xa, y + 20, xb - xa, 6);
  }
  for (const n of pan.ghosts) {
    if (n.t > maxT || n.t < minT) continue;
    const x = xOf(n.t, t); if (x < 8) continue;
    const ft = (t - n.t) * 1000, lit = ft >= 0 && ft < M.note.ghostFlashMs;
    const r = lit ? 27 : 23;
    g.fillStyle = C.navyD; poly(x, y + 2, r, 16, 0.1); g.fill();
    g.fillStyle = lit ? C.paper : C.slate; poly(x, y, r, 16, 0.1); g.fill();
    if (t >= n.reveal) { g.fillStyle = lit ? C.navy : C.navyD; g.font = '800 21px ' + FONT_NOTE; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(n.k, x, y + 1); }
  }
  for (const n of pan.notes) {
    if (n.type !== 'hold' || n.t > maxT) continue;
    if (n.judged && n.res !== 'MISS' && !(n.hold && n.hold.active)) continue;
    if (n.res === 'MISS' && t < n.missT - 0.05) continue;
    const active = n.hold && n.hold.active && n.hold.released == null;
    const xa = active ? HIT_X : xOf(n.t, t), xb = xOf(n.end, t);
    if (xb < -10) continue;
    const missed = n.res === 'MISS' || (n.hold && n.hold.released != null);
    g.fillStyle = missed ? C.slateD : active ? C.paperD : C.slate;
    g.fillRect(xa, y - 20, Math.max(0, xb - xa), 40);
    g.fillStyle = C.navyD;
    const p0 = Math.ceil(T.pos(n.t) * 2) / 2, p1 = T.pos(n.end);
    for (let p = p0 + 0.5; p < p1 - 0.01; p += 0.5) { const xx = xOf(T.timeOfPos(p), t); if (xx > xa + 4) g.fillRect(xx - 1, y - 14, 2, 28); }
    g.fillStyle = active && n.end - t < T.avgBeat ? C.tan : C.paper;
    g.beginPath(); g.moveTo(xb - 6, y - 24); g.lineTo(xb + 2, y - 24); g.lineTo(xb + 8, y - 18); g.lineTo(xb + 8, y + 24); g.lineTo(xb - 6, y + 24); g.closePath(); g.fill();
    if (n.release === 'shutter') { g.fillStyle = C.navy; g.fillRect(xb - 2, y - 6, 6, 12); }
  }
  for (let i = pan.notes.length - 1; i >= 0; i--) {
    const n = pan.notes[i];
    if (n.t > maxT) continue;
    if (n.judged && n.res !== 'MISS') continue;
    if (n.hold && n.hold.active && n.hold.released == null) { drawDisc(n, HIT_X, y, t, true); continue; }
    const x = xOf(n.t, t);
    if (n.res === 'MISS') { if (t < n.missT - 0.05) continue; const age = t - n.missT; if (age > 0.35 || x < -40) continue; }   // 되감아도 이미 놓친 노트는 다시 안 흐름(리듬 검토 I8)
    else if (x < -40) continue;
    if (n.type === 'pill') {
      const xb = xOf(n.tail, t);
      g.fillStyle = C.navyD; capsule(x, xb, y + 3, 32, 26); g.fill();
      g.fillStyle = n.res === 'MISS' ? C.slate : C.paper; capsule(x, xb, y, 32, 26); g.fill();
      drawKana(n, 0, x, y, t, n.res === 'MISS');
      drawKana(n, 1, xb, y, t, true, true);   // 꼬리 글자 = 들리는 글자(치지 않음): 회청·작게(리듬 검토 S4)
      continue;
    }
    drawDisc(n, x, y, t, false);
  }
}
function capsule(xa, xb, y, r, r2) { g.beginPath(); g.arc(xa, y, r, PI / 2, PI * 1.5); g.lineTo(xb, y - r2); g.arc(xb, y, r2, -PI / 2, PI / 2); g.lineTo(xa, y + r); g.closePath(); }
function drawDisc(n, x, y, t, pinned) {
  const miss = n.res === 'MISS';
  let sc = 1; const su = (t - n.reveal) / (M.note.stampBeats * T.avgBeat);
  if (su >= 0 && su < 1) sc = 1 + 0.25 * (1 - su);
  g.save(); g.translate(x, y); g.rotate(n.rot * PI / 180); g.scale(sc, sc);
  g.fillStyle = C.navyD; poly(0, 3, 32, 16, 0.2); g.fill();
  g.fillStyle = miss ? C.slate : C.paper; poly(0, 0, 32, 16, 0.2); g.fill();
  if (pinned) { g.strokeStyle = C.tan; g.lineWidth = 4; poly(0, 0, 30, 16, 0.2); g.stroke(); }
  g.restore();
  drawKana(n, 0, x, y, t, miss);
}
function drawKana(n, ci, x, y, t, miss, small) {
  if (t < n.reveal) { g.fillStyle = C.paperD; g.fillRect(x - 7, y - 2, 14, 4); return; }
  const k = n.kanaChars[ci] || n.kanaChars[0];
  g.textAlign = 'center'; g.textBaseline = 'middle';
  if (small) { g.fillStyle = C.slate; g.font = '800 21px ' + FONT_NOTE; g.fillText(k, x, y); return; }
  const mode = settings.sound, a = fadeAlpha(k), showSnd = mode !== 'off' && a > 0.01;
  g.fillStyle = miss ? C.navyD : C.navy;
  g.font = '800 30px ' + FONT_NOTE; g.fillText(k, x, showSnd ? y - 6 : y);
  if (showSnd) {
    const s = mode === 'ro' ? n.ro[ci] : mode === 'ko+ro' ? n.snd[ci] + ' ' + n.ro[ci] : n.snd[ci];
    g.globalAlpha = a; g.fillStyle = miss ? C.navyD : C.slateD;
    g.font = '700 ' + (mode === 'ko+ro' ? 11 : 14) + 'px ' + FONT_KO; g.fillText(s, x, y + 19);
    g.globalAlpha = 1;
  }
}

// ── 맞춤 자리(카메라 뷰파인더) + 다가오는 고리 ─────────────────────────────
// 노트마다 고리가 노트 1박 전에 r 64에서 시작해 같은 빠르기로 줄어 노트 시각에 말풍선 테두리(r 32)에 닿음(리듬 검토 I4, osu! 접근 원). 8분이면 고리 둘이 같이 보임.
function drawTarget(t, tReal) {
  const x = HIT_X, y = L.hitY, ab = T.avgBeat;
  const holding = S.holding && S.holding.hold && S.holding.hold.active && S.holding.hold.released == null;
  for (const n of pan.notes) {
    if (n.judged || (n.hold && n.hold.active)) continue;
    const d = n.t - t; if (d > ab) break; if (d < -0.05) continue;
    const r = 32 + 32 * Math.max(0, d) / ab;
    g.strokeStyle = C.navyD; g.lineWidth = 6; poly(x, y, r, 32, 0); g.stroke();
    g.strokeStyle = C.tan; g.lineWidth = 3; poly(x, y, r, 32, 0); g.stroke();
  }
  if (holding) {
    const n = S.holding, u = Math.min(1, Math.max(0, (t - n.t) / (n.end - n.t)));
    g.strokeStyle = C.navyD; g.lineWidth = 5; g.beginPath(); g.arc(x, y, 39, 0, 2 * PI); g.stroke();
    g.strokeStyle = C.tan; g.lineWidth = 5; g.beginPath(); g.arc(x, y, 39, -PI / 2, -PI / 2 + u * 2 * PI); g.stroke();
  }
  const ph = phaseAt(t);
  const lp = S.lastPress, pressCol = (tReal - lp.t) >= 0 && (tReal - lp.t) < 0.16 * ab ? (lp.side === 'R' ? C.sky : C.paper) : null;
  // 딱따기 자리에서 뷰파인더 모서리가 1/8박 귤색(귀 신호와 같이 보는 신호, 리듬 검토 10-19 I3)
  let knockCue = false; for (const k of pan.knocks) if (tReal >= k.t - 0.01 && tReal < k.t + 0.125 * ab) knockCue = true;
  g.fillStyle = pressCol || (knockCue ? C.tan : ph.who === 'call' ? C.slate : C.paper);
  const hs = 44, arm = 14, th = 4;
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const cx = x + sx * hs, cy = y + sy * hs;
    g.fillRect(sx < 0 ? cx : cx - arm, sy < 0 ? cy : cy - th, arm, th);
    g.fillRect(sx < 0 ? cx : cx - th, sy < 0 ? cy : cy - arm, th, arm);
  }
  if (tReal - S.shutterT >= 0 && tReal - S.shutterT < 0.035) { g.fillStyle = C.paper; poly(x, y, 44, 24, 0); g.fill(); }
}

// ── 터짐·날아가는 글자 ─────────────────────────────
function drawFx(t) {
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i], u = (t - f.t0) / f.dur;
    if (u >= 1 || u < -0.5) { fx.splice(i, 1); continue; }
    if (u < 0) continue;
    const dt = t - f.t0;
    if (f.k === 'strip' || f.k === 'bit') {
      const x = f.x + f.vx * dt, y = f.y + f.vy * dt + 160 * dt * dt;
      g.save(); g.translate(x, y); g.rotate(f.rot + (f.vr || 0) * dt); g.fillStyle = f.col;
      const s = 1 - u * 0.5;
      if (f.k === 'strip') g.fillRect(-2 * s, -7 * s, 4 * s, 14 * s); else g.fillRect(-4 * s, -4 * s, 8 * s, 8 * s);
      g.restore();
    } else if (f.k === 'ring') {
      g.strokeStyle = C.paper; g.lineWidth = 5 * (1 - u) + 1; poly(f.x, f.y, 32 + 26 * u, 24, 0); g.stroke();
    } else if (f.k === 'spark') {   // 렌즈 반짝: 종이 흰 4각 별 지름 10, 가산
      const lp = lensPos(), r = 5 + 3 * u; g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.6 * (1 - u); g.fillStyle = C.paper;
      g.beginPath(); g.moveTo(lp.x, lp.y - r); g.lineTo(lp.x + r * 0.25, lp.y - r * 0.25); g.lineTo(lp.x + r, lp.y); g.lineTo(lp.x + r * 0.25, lp.y + r * 0.25); g.lineTo(lp.x, lp.y + r); g.lineTo(lp.x - r * 0.25, lp.y + r * 0.25); g.lineTo(lp.x - r, lp.y); g.lineTo(lp.x - r * 0.25, lp.y - r * 0.25); g.closePath(); g.fill();
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    } else if (f.k === 'fly') {
      const e = 1 - Math.pow(1 - u, 2), lp = lensPos();
      const x = f.x0 + (lp.x - f.x0) * e, y = f.y0 + (lp.y - f.y0) * e - 20 * Math.sin(u * PI), r = 12 * (1 - 0.55 * u);
      if (u > 0.85 && !f.sp) { f.sp = true; fx.push({ k: 'spark', t0: t, dur: 0.125 * T.avgBeat }); }
      g.fillStyle = C.paper; poly(x, y, r, 12, 0); g.fill();
      g.fillStyle = C.navy; g.font = '800 ' + Math.round(15 * (1 - 0.4 * u)) + 'px ' + FONT_NOTE; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(f.txt, x, y + 1);
    }
  }
}

// ── 패드 ─────────────────────────────
function drawPads(t) {
  for (const side of ['L', 'R']) {
    const x = side === 'L' ? 104 : 286, y = L.padY, P = S.pads[side];
    const inFree = pan && pan.free && pan.free.some(fr => S.tStage >= fr.t0 - 0.5 && S.tStage < fr.t1);
    const on = side === 'L' || S.rightOn || inFree, down = P.down ? 4 : 0;
    g.fillStyle = C.slate; poly(x, y, 36, 24, 0); g.fill();
    g.fillStyle = C.navyD; poly(x, y + 4, 30, 24, 0); g.fill();
    g.fillStyle = on ? C.navy : C.navyD; poly(x, y - 4 + down, 30, 24, 0); g.fill();
    const iy = y - 4 + down;
    if (side === 'L') {
      g.strokeStyle = on ? C.paper : C.slate; g.lineWidth = 4;
      if (P.down && on) { g.fillStyle = C.paper; poly(x, iy, 12, 16, 0); g.fill(); } else { poly(x, iy, 10, 16, 0); g.stroke(); }
    } else {
      g.fillStyle = on ? C.sky : C.slate;
      if (P.down && on) g.fillRect(x - 12, iy - 12, 24, 24); else { g.fillRect(x - 11, iy - 11, 22, 4); g.fillRect(x - 11, iy + 7, 22, 4); g.fillRect(x - 11, iy - 11, 4, 22); g.fillRect(x + 7, iy - 11, 4, 22); }
    }
    const u = (t - P.t) / (0.24 * (T ? T.avgBeat : idleBeat));
    if (u >= 0 && u < 1 && !P.empty) { g.strokeStyle = side === 'L' ? C.paper : C.sky; g.lineWidth = 4 * (1 - u) + 1; g.beginPath(); g.arc(x, y, 40 + 24 * u, PI * 5 / 6, PI * 13 / 6); g.stroke(); }
  }
}

// ── 판정 딱지 ─────────────────────────────
const CHIP = { PERFECT: [C.tan, 32], GREAT: [C.paper, 28], GOOD: [C.paperD, 24], MISS: [C.slate, 24] };
function drawChip(t) {
  const c = S.chip; if (!c) return;
  const age = t - c.t0; if (age > 0.6 || age < 0) return;
  const [col, size] = CHIP[c.res];
  const e = T.avgBeat / 2;
  let sy = 1, sc = 1;
  if (age < 0.033) sy = 0.4 + age / 0.033 * 0.6; else if (age < e) sc = 1.1 - 0.1 * (age - 0.033) / (e - 0.033);
  const drop = c.res === 'MISS' ? Math.min(8, age * 40) : 0;
  g.save(); g.translate(104, L.chipY + drop); if (c.res === 'MISS') g.rotate(-8 * PI / 180); g.scale(sc, sy * sc);
  g.font = '900 ' + size + 'px ' + FONT_KO; g.textAlign = 'center'; g.textBaseline = 'middle';
  const w = g.measureText(c.res).width + 22, h = size + 6;
  g.fillStyle = C.navyD; cutRect(-w / 2, -h / 2, w, h, 6, 4); g.fill();
  g.fillStyle = col; g.fillText(c.res, 0, 1);
  if ((c.res === 'GREAT' || c.res === 'GOOD') && c.delta != null && c.fastSlow) { g.font = '700 13px ' + FONT_KO; g.fillStyle = C.paperD; g.fillText(c.delta < 0 ? '빠름' : '느림', 0, h / 2 + 10); }
  g.restore();
}

// ── 글자 카드 · 한국어 가사 ─────────────────────────────
function cardGeom(ph) {
  const n = ph.kana.length, row = ph.kind === 'row';
  const fs = row ? 40 : 46, step = row ? 52 : 54;
  const w = Math.max(160, Math.ceil((n * step + 32) / 8) * 8), h = row ? 104 : 124;
  return { fs, step, w, h, x0: 195 - (n - 1) * step / 2 };
}
function drawCard(t) {
  let ph = null;
  for (const p of pan.phrases) if (t >= p.call0 - 0.08 && t < p.resp1) ph = p;
  if (!ph) { drawLyric(t); return; }
  const G = cardGeom(ph), bl = T.avgBeat;
  const age = t - (ph.call0 - 0.08);
  const unfold = Math.min(1, age / (M.card.unfoldMs / 1000));
  const bounce = age < 0.25 ? -M.card.bounce * Math.sin(Math.min(1, age / 0.25) * PI) : 0;
  const ru = (t - (ph.resp0 - M.card.shrinkBeats * bl)) / (M.card.shrinkBeats * bl);
  const sc = 1 - (1 - M.card.respScale) * Math.max(0, Math.min(1, ru));
  const resp = t >= ph.resp0 - M.card.shrinkBeats * bl / 2;
  g.save(); g.translate(195, L.cardTop + bounce); g.scale(sc, sc * unfold);
  const x = -G.w / 2, y = 0;
  g.fillStyle = C.slate; cutRect(x + 3, y + 4, G.w, G.h, 16, 6); g.fill();
  g.fillStyle = C.navy; cutRect(x, y, G.w, G.h, 16, 6); g.fill();
  const tx = resp ? Math.max(x + 24, L.hanaX - 195) : Math.min(-x - 24, L.callerX - 195);
  g.beginPath(); g.moveTo(tx - 10, y + G.h); g.lineTo(tx + 10, y + G.h); g.lineTo(tx + (resp ? -6 : 6), y + G.h + 14); g.closePath(); g.fill();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const mode = settings.sound;
  for (let i = 0; i < ph.kana.length; i++) {
    const kx = (G.x0 - 195) + i * G.step, ky = y + 38;
    const at = ph.at[i], lit = t >= at && t < at + M.card.litBeats * bl, sung = t >= at;
    g.save(); g.translate(kx, ky); if (lit) g.scale(1.12, 1.12);
    g.fillStyle = sung ? C.paper : C.slate; g.font = '600 ' + G.fs + 'px ' + FONT_CARD; g.fillText(ph.kana[i], 0, 0);
    g.restore();
    if (ph.hitIdx.has(i)) { g.fillStyle = C.tan; g.fillRect(kx - 14, ky + G.fs / 2 + 2, 28, 4); }
    if (ph.kind === 'row' && mode !== 'off') {
      const a = fadeAlpha(ph.kana[i]); if (a > 0.01) {
        g.globalAlpha = a; g.fillStyle = sung ? C.paper : C.slate; g.font = '700 15px ' + FONT_KO;
        g.fillText(mode === 'ro' ? ph.ro[i] : mode === 'ko+ro' ? ph.snd[i] + ' ' + ph.ro[i] : ph.snd[i], kx, ky + 42); g.globalAlpha = 1;
      }
    }
  }
  if (ph.kind !== 'row') {
    let line = '';
    if (mode !== 'off') {
      const sep = ph.kind === 'sound' ? ' ' : '';
      const ko = ph.snd.join(sep), ro = ph.ro.join(sep);
      line = mode === 'ro' ? ro : mode === 'ko+ro' ? ko + ' · ' + ro : ko;
    }
    const a = Math.max(...ph.kana.map(fadeAlpha));
    g.font = '700 16px ' + FONT_KO; g.fillStyle = C.paper;
    if (line && a > 0.01) { g.globalAlpha = a; g.fillText(line, 0, y + 80); g.globalAlpha = 1; }
    if (ph.kind === 'word' && settings.meaning && ph.mean) { g.font = '700 15px ' + FONT_KO; g.fillStyle = C.paperD; g.fillText('뜻 · ' + ph.mean, 0, y + 104); }
    if (ph.kind === 'sound') { g.font = '600 13px ' + FONT_KO; g.fillStyle = C.paperD; g.fillText('들린 소리 그대로', 0, y + 104); }
  }
  g.restore();
}
function drawLyric(t) {
  let ly = null; for (const l of pan.lyrics) if (t >= l.t0 && t < l.t1) ly = l;
  if (!ly) return;
  const age = t - ly.t0, unfold = Math.min(1, age / 0.07);
  g.font = '700 17px ' + FONT_KO; const w = Math.ceil((g.measureText(ly.text).width + 36) / 8) * 8, h = 44;
  g.save(); g.translate(195, L.cardTop + 16); g.scale(1, unfold);
  g.fillStyle = C.slate; cutRect(-w / 2 + 3, 4, w, h, 10, 4); g.fill();
  g.fillStyle = C.navy; cutRect(-w / 2, 0, w, h, 10, 4); g.fill();
  const tx = L.hanaX - 195; g.beginPath(); g.moveTo(tx - 8, h); g.lineTo(tx + 8, h); g.lineTo(tx - 4, h + 12); g.closePath(); g.fill();
  g.fillStyle = C.paper; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ly.text, 0, h / 2 + 1);
  g.restore();
}

// ── HUD ─────────────────────────────
function drawHud(t) {
  const T0 = L.T;
  g.fillStyle = C.navyD; cutRect(20, T0 + 13, 40, 40, 8, 4); g.fill();
  g.fillStyle = C.paper; g.fillRect(32, T0 + 24, 5, 18); g.fillRect(43, T0 + 24, 5, 18);
  const p = Math.max(0, Math.min(1, (t - pan.from) / (pan.hitAt - pan.from)));
  g.fillStyle = C.navyD; g.fillRect(76, T0 + 13, 230, 4);
  g.fillStyle = C.paper; g.fillRect(76, T0 + 13, 230 * p, 4);
  poly(76 + 230 * p, T0 + 15, 6, 6, 0); g.fill();
  for (let i = 0; i < pan.letters.length; i++) {
    const k = pan.letters[i], on = !!S.cells[k], x = 88 + 29 * i, y = T0 + 35;
    const su = on ? (t - S.stampT[k]) / 0.2 : 1, sc = su < 1 ? 1.4 - 0.4 * Math.max(0, su) : 1;
    g.save(); g.translate(x, y); if (on) g.rotate(-4 * PI / 180); g.scale(sc, sc);
    g.fillStyle = on ? C.paper : C.navy; cutRect(-12, -12, 24, 24, 5, 2); g.fill();
    g.fillStyle = on ? C.navy : C.paperD; g.font = '600 15px ' + FONT_CARD; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(k, 0, 1);
    g.restore();
  }
  if (S.combo >= 3) {
    const bu = (t - S.comboT) / 0.1, sc = bu >= 0 && bu < 1 ? 1.15 - 0.15 * bu : 1;
    g.textAlign = 'right'; g.textBaseline = 'alphabetic';
    g.font = '700 13px ' + FONT_KO; g.fillStyle = C.navyD; g.fillText('콤보', 374, T0 + 24); g.fillStyle = C.paperD; g.fillText('콤보', 374, T0 + 22);
    g.save(); g.translate(374, T0 + 54); g.scale(sc, sc);
    g.font = '800 30px ' + FONT_NOTE; g.fillStyle = C.navyD; g.fillText(String(S.combo), 0, 2); g.fillStyle = C.paper; g.fillText(String(S.combo), 0, 0);
    g.restore();
  }
}
function drawCount(t) {
  const bl = T.avgBeat, left = Math.ceil((S.countTo - t) / bl);
  if (left < 1 || left > 3) return;
  const u = 1 - ((S.countTo - t) / bl - (left - 1));
  g.save(); g.translate(195, L.deckTop - 250); g.scale(1.2 - 0.2 * Math.min(1, u * 3), 1.2 - 0.2 * Math.min(1, u * 3));
  g.font = '900 96px ' + FONT_KO; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = C.navyD; g.fillText(String(left), 0, 5); g.fillStyle = C.paper; g.fillText(String(left), 0, 0);
  g.restore();
}
function drawDebug(t, d) {
  g.font = '600 11px ' + FONT_KO; g.textAlign = 'left'; g.textBaseline = 'top'; g.fillStyle = C.paper;
  const lines = ['곡 ' + t.toFixed(3) + 's', 'fps ' + d.fps + ' · 그리기 ' + S.lastDrawMs.toFixed(2) + 'ms', '보정 소리 ' + d.offsetMs + ' · 화면 ' + d.visualMs + 'ms · 출력 ' + d.lat];
  lines.forEach((s, i) => g.fillText(s, 70, L.T + 64 + i * 13));
}

// ── 시험용 ─────────────────────────────
export const LAY = { HIT_X, SPEED };
// 장면 보임: 무대 판 위(배경·인물)에서 HUD·카드를 뺀 넓이 ÷ 화면 전체. 노트 길·바닥·패드는 장면으로 안 셈(화면 검토 L1)
export function visibility(t) {
  const area = 390 * L.H, hud = 40 * 40 + 230 * 4 + 5 * 24 * 24 + (S.combo >= 3 ? 60 * 46 : 0);
  let card = 0;
  if (pan) for (const p of pan.phrases) if (t >= p.call0 && t < p.resp1) { const G = cardGeom(p); card = G.w * (G.h + 14); }
  const stage = 390 * (S.layoutB ? L.laneTop : L.deckTop);
  return { withCard: (stage - hud - card) / area, noCard: (stage - hud) / area, hanaH: 160 / L.H, lightsPct: bg ? bg.lightsPct : null };
}
export function capturePhoto(shake) {
  const top = Math.max(0, L.deckTop - 300), w = 240, h = Math.round(240 * (L.deckTop + 4 - top) / 390);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.drawImage(cv, L.ox * dpr, top * L.s * dpr, 390 * L.s * dpr, (L.deckTop + 4 - top) * L.s * dpr, 0, 0, w, h);
  if (shake) { x.globalAlpha = 0.45; x.drawImage(c, shake, Math.round(shake / 2)); x.globalAlpha = 1; }   // 셔터를 늦게·일찍 떼면 사진이 흔들림(벌 없음)
  return c;
}
