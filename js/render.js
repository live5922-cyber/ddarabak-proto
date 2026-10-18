// render.js · Canvas 2D 그리기. 시간은 받기만 함(시계는 clock.js).
// 좌표는 아이폰 12 화면(390×844 CSS px) 기준 '무대 좌표'. 화면 크기에 맞춰 통째로 늘리고, 배경은 화면 끝까지 덮음.
// 캐릭터는 생성 그림(art/v0.5에서 자른 PNG)만 씀. 코드로 그리는 것은 화면 도형(노트·버튼·고리·카드·눈송이)과 글자뿐.
import { cardAt } from './chart.js';
import { settings, fadeAlpha, fadeLevel } from './settings.js';

export const C = {
  navy: '#283A66', tan: '#FF6C2F', scarlet: '#F65058', apricot: '#F7C6A8', sun: '#FFB511', sky: '#62A8E5',
  mint: '#82D8D5', slate: '#8C96B4', paper: '#FFF8EC', ink: '#1D2A4C', muted: '#5A6283',
  scarletBase: '#B53A40', sunBase: '#C08408',
};
export const JCOLOR = { PERFECT: C.tan, GREAT: C.sky, GOOD: C.mint, MISS: C.slate };
export const FONT_KANA = '"M PLUS Rounded 1c","Hiragino Maru Gothic ProN","Hiragino Sans","Yu Gothic",sans-serif';
export const FONT_KO = '"Pretendard Variable",Pretendard,"Apple SD Gothic Neo","Malgun Gothic",sans-serif';

// 자리(기획안 v0.5 5절 표, 아이폰 12)
export const LAY = {
  W: 390, H: 844, safeTop: 47, safeBot: 810,
  laneTop: 488, laneBot: 560, laneY: 524, targetX: 56, pxPerBeat: 144, laneEndX: 416,
  noteR: 31, beatNote: 56,
  btnY: 712, btnX: { L: 104, R: 286 }, btnR: 60, ringStart: 96, ringEnd: 66,
  judgeY: 592, cardTop: 112, footY: 472, groundY: 468, dollX: { hana: 96, caller: 294 },
  pause: { x: 16, y: 56, w: 48, h: 48 }, combo: { x: 302, y: 56, w: 72, h: 48 },
};

const R = {
  canvas: null, g: null, dpr: 1, L: { s: 1, ox: 0, oy: 0, W: 390, H: 844 },
  stage: null, img: {}, dolls: {}, bgCache: null, ch: null,
  noteCache: new Map(), cardCache: { key: '', cv: null, lay: null },
  pressed: { L: false, R: false }, releaseT: { L: -9, R: -9 },
  fx: [], judgeText: null, pops: [], falls: [], complete: null,
  hana: { pose: 'hana_beat', until: 0, hop: 0, hopT: -9 },
  caller: { hop: 0, hopT: -9 },
  reg: { amt: 0, t0: -9, dur: 0.5 },
  freeze: { at: 0, until: -9 }, shake: { t0: -9, dur: 0.12 },
  snow: null, flake: [],
  probe: null, lastT: 0, combo: 0, fps: 0, debug: false,
};
export function getLayout() { return R.L; }

// ── 준비 ───────────────────────────────
export function initRender(canvas, stage, images, opts) {
  R.canvas = canvas; R.g = canvas.getContext('2d', { alpha: false });
  R.stage = stage; R.img = images; R.debug = !!(opts && opts.debug);
  for (const id in stage.dolls) {
    const d = stage.dolls[id], im = images[id];
    R.dolls[id] = { info: d, img: im, shadow: tint(im, C.navy, 0.28), tan: tint(im, C.tan, 1), sky: tint(im, C.sky, 1) };
  }
  makeSnow();
  resize();
}
function tint(img, color, alpha) {
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'source-in'; g.globalAlpha = alpha; g.fillStyle = color; g.fillRect(0, 0, c.width, c.height);
  return c;
}
export function setChart(ch) { R.ch = ch; R.noteCache.clear(); R.cardCache.key = ''; }
export function enableProbe(on) { R.probe = on ? [] : null; return R.probe; }
export function getProbe() { return R.probe; }

export function resize() {
  const W = window.innerWidth, H = window.innerHeight;
  R.dpr = Math.min(2, window.devicePixelRatio || 1);
  R.canvas.width = Math.round(W * R.dpr); R.canvas.height = Math.round(H * R.dpr);
  R.canvas.style.width = W + 'px'; R.canvas.style.height = H + 'px';
  const ins = safeInsets();
  let s = Math.min(W / LAY.W, H / LAY.H);
  let oy = (H - LAY.H * s) / 2;
  if (oy + LAY.safeTop * s < ins.top) oy = ins.top - LAY.safeTop * s;
  if (oy + LAY.safeBot * s > H - ins.bottom) {
    s = Math.min(s, (H - ins.top - ins.bottom) / (LAY.safeBot - LAY.safeTop));
    oy = ins.top - LAY.safeTop * s;
  }
  const ox = (W - LAY.W * s) / 2;
  R.L = { s, ox, oy, W, H, ins };
  R.noteCache.clear(); R.cardCache.key = '';
  buildBg();
}
function safeInsets() {
  const el = document.getElementById('safe-probe');
  if (!el) return { top: 0, bottom: 0 };
  const cs = getComputedStyle(el);
  return { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
}

// 보이는 무대 좌표 범위
function vis() {
  const L = R.L;
  return { x0: -L.ox / L.s, x1: (L.W - L.ox) / L.s, y0: -L.oy / L.s, y1: (L.H - L.oy) / L.s };
}

// 배경 한 장을 화면 크기로 미리 그려 둠(땅 선 = 무대 y 468, 초점 = 가운데 x 195). 모자란 아래는 맨 아래 줄을 늘림
function buildBg() {
  const im = R.img.bg; if (!im) return;
  const b = R.stage.bg, L = R.L, v = vis();
  let k = b.cssPerPx;
  k = Math.max(k, (195 - v.x0) / b.focusX, (v.x1 - 195) / (b.w - b.focusX), (LAY.groundY - v.y0) / b.groundY);
  k = Math.min(k, b.cssPerPx * 1.8);
  const dx = 195 - b.focusX * k, dy = LAY.groundY - b.groundY * k, dw = b.w * k, dh = b.h * k;
  const cv = document.createElement('canvas'); cv.width = R.canvas.width; cv.height = R.canvas.height;
  const g = cv.getContext('2d', { alpha: false });
  const S = R.dpr * L.s;
  g.setTransform(S, 0, 0, S, R.dpr * L.ox, R.dpr * L.oy);
  g.imageSmoothingQuality = 'high';
  g.fillStyle = C.mint; g.fillRect(v.x0 - 2, v.y0 - 2, v.x1 - v.x0 + 4, v.y1 - v.y0 + 4);
  if (v.y0 < dy) g.drawImage(im, 0, 0, b.w, 2, dx, v.y0 - 1, dw, dy - v.y0 + 2);
  g.drawImage(im, dx, dy, dw, dh);
  if (v.y1 > dy + dh) g.drawImage(im, 0, b.h - 2, b.w, 1, dx, dy + dh - 1, dw, v.y1 - (dy + dh) + 2);
  // 가로로 넓은 화면(컴퓨터): 모자란 옆은 가장자리 세로줄을 늘리고, 폰 폭(390) 바깥은 조금 어둡게
  if (v.x0 < dx) g.drawImage(im, 0, 0, 1, b.h, v.x0 - 1, dy, dx - v.x0 + 2, dh);
  if (v.x1 > dx + dw) g.drawImage(im, b.w - 1, 0, 1, b.h, dx + dw - 1, dy, v.x1 - dx - dw + 2, dh);
  if (v.x0 < -4 || v.x1 > LAY.W + 4) {
    g.fillStyle = 'rgba(29,42,76,0.35)';
    g.fillRect(v.x0 - 2, v.y0 - 2, -v.x0 + 2, v.y1 - v.y0 + 4);
    g.fillRect(LAY.W, v.y0 - 2, v.x1 - LAY.W + 2, v.y1 - v.y0 + 4);
  }
  R.bgCache = cv;
}

function makeSnow() {
  const n = 34; const a = new Float32Array(n * 6);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < n; i++) {
    a[i * 6] = rnd() * 520 - 65;   // x0
    a[i * 6 + 1] = rnd() * 700;    // y0
    a[i * 6 + 2] = 16 + rnd() * 26;// 떨어지는 빠르기
    a[i * 6 + 3] = 6 + rnd() * 12; // 흔들림 폭
    a[i * 6 + 4] = rnd() * 6.28;   // 위상
    a[i * 6 + 5] = Math.floor(rnd() * 3); // 모양
  }
  R.snow = a;
  // 각진 종이 눈송이 3가지(도형)
  for (let s = 0; s < 3; s++) {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d'); g.translate(16, 16); g.fillStyle = C.paper;
    g.beginPath();
    const sides = s === 0 ? 6 : s === 1 ? 4 : 5, r = s === 1 ? 11 : 13;
    for (let i = 0; i < sides; i++) { const an = i / sides * Math.PI * 2 + s; g.lineTo(Math.cos(an) * r, Math.sin(an) * r * (s === 2 ? 0.8 : 1)); }
    g.closePath(); g.fill();
    R.flake.push(c);
  }
}

// ── 그리기 도우미 ─────────────────────────────
function rr(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function cutRect(g, x, y, w, h, cut) {
  g.beginPath(); g.moveTo(x, y); g.lineTo(x + w - cut, y); g.lineTo(x + w, y + cut); g.lineTo(x + w, y + h); g.lineTo(x, y + h); g.closePath();
}
function circle(g, x, y, r) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); }
const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
const easeOut = p => 1 - (1 - p) * (1 - p) * (1 - p);
const easeInOut = p => p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;

function soundParts(info, kana) {
  const m = settings.sound;
  if (m === 'off') return null;
  if (m === 'ko') return [info.ko, null];
  if (m === 'ro') return [null, info.ro];
  return [info.ko, info.ro];
}
// 말풍선 속 소리 한 줄: 한글 우선, 한글을 끄고 로마자를 켰으면 로마자
function bubbleSound(info) {
  const m = settings.sound;
  if (m === 'off') return '';
  return m === 'ro' ? info.ro : info.ko;
}

// ── 노트 말풍선(미리 그린 조각) ───────────────────────
function noteSprite(n, alphaSound, back) {
  const key = (back ? 'B' : n.btn) + n.k + '|' + bubbleSound(n.info) + '|' + alphaSound;
  let c = R.noteCache.get(key);
  if (c) return c;
  const S = R.dpr * R.L.s, size = 72;
  c = document.createElement('canvas'); c.width = Math.ceil(size * S); c.height = Math.ceil(size * S);
  const g = c.getContext('2d'); g.scale(S, S); g.translate(size / 2, size / 2);
  if (n.btn === 'R') {
    rr(g, -28, -28, 56, 56, 14); g.fillStyle = C.paper; g.fill(); g.lineWidth = 4; g.strokeStyle = C.sun; g.stroke();
    rr(g, -10, -10, 20, 20, 5); g.lineWidth = 3; g.strokeStyle = C.navy; g.stroke();
  } else {
    circle(g, 0, 0, LAY.noteR); g.fillStyle = back ? C.slate : C.paper; g.fill();
    g.lineWidth = 2; g.strokeStyle = C.navy; g.stroke();
    if (!back) {
      const snd = bubbleSound(n.info);
      g.fillStyle = C.navy; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `800 28px ${FONT_KANA}`;
      g.fillText(n.k, 0, snd && alphaSound > 0 ? -6 : 1);
      if (snd && alphaSound > 0) {
        g.globalAlpha = alphaSound; g.fillStyle = C.muted; g.font = `800 13px ${FONT_KO}`;
        g.fillText(snd, 0, 16); g.globalAlpha = 1;
      }
    }
  }
  R.noteCache.set(key, c);
  return c;
}

// ── 글자 카드(내용이 바뀔 때만 다시 그림) ────────────────
function cardLayout(card) {
  if (card.kind === 'letter') return { w: 160, h: 184, kana: 104, ky: 72, sy: 150, my: 0 };
  if (card.kind === 'word' || card.kind === 'complete') {
    const n = Array.from(card.word.kana.replace(/\s/g, '')).length;
    const w = n <= 2 ? 192 : n === 3 ? 264 : n === 4 ? 336 : 352;
    return { w, h: 160, kana: n >= 5 ? 56 : 72, ky: 46, sy: 100, my: 138 };
  }
  if (card.kind === 'listen') return { w: 352, h: 104, kana: 40, ky: 44, sy: 82 };
  return { w: 352, h: 56, sy: 28 };   // 가사 줄
}
function drawSoundLine(g, ko, ro, size, cx, y, alpha) {
  g.textBaseline = 'middle';
  const parts = [];
  if (ko) parts.push([ko, `800 ${size}px ${FONT_KO}`, C.navy]);
  if (ko && ro) parts.push(['·', `500 ${size}px ${FONT_KO}`, C.muted]);
  if (ro) parts.push([ro, `600 ${size}px ${FONT_KO}`, ko ? C.muted : C.navy]);
  if (!parts.length) return;
  const gap = 8; let tot = 0; const ws = [];
  for (const p of parts) { g.font = p[1]; const w = g.measureText(p[0]).width; ws.push(w); tot += w; }
  tot += gap * (parts.length - 1);
  let x = cx - tot / 2;
  g.globalAlpha = alpha; g.textAlign = 'left';
  parts.forEach((p, i) => { g.font = p[1]; g.fillStyle = p[2]; g.fillText(p[0], x, y); x += ws[i] + gap; });
  g.globalAlpha = 1; g.textAlign = 'center';
}
function wave(g, cx, cy, w, color) {
  g.beginPath();
  for (let i = 0; i <= 12; i++) { const x = cx - w / 2 + w * i / 12, y = cy + Math.sin(i / 12 * Math.PI * 3) * w * 0.12; i ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.lineWidth = 3; g.lineCap = 'round'; g.strokeStyle = color; g.stroke();
}

function renderCard(card, t) {
  const lay = cardLayout(card);
  let revealed = 0, flown = 0;
  if (card.glyphs) card.glyphs.forEach((gl, i) => {
    if (gl.tReveal <= t) revealed |= 1 << i;
    if (gl.note && gl.note.flightStart <= t) flown |= 1 << i;
  });
  const fl = card.kind === 'letter' ? fadeLevel(card.glyphs[0].k) : 0;
  const key = card.id + '|' + card.kind + '|' + revealed + '|' + flown + '|' + settings.sound + settings.meaning + '|' + fl + '|' + R.L.s;
  if (R.cardCache.key === key) return R.cardCache;
  const S = R.dpr * R.L.s, pad = 8;
  let cv = R.cardCache.cv;
  if (!cv) cv = R.cardCache.cv = document.createElement('canvas');
  cv.width = Math.ceil((lay.w + pad * 2) * S); cv.height = Math.ceil((lay.h + pad * 2) * S);
  const g = cv.getContext('2d'); g.setTransform(S, 0, 0, S, pad * S, pad * S);
  g.clearRect(-pad, -pad, lay.w + pad * 2, lay.h + pad * 2);
  // 판 두께 그림자 + 종이(오른쪽 위 12px 사선)
  cutRect(g, 3, 4, lay.w, lay.h, 12); g.fillStyle = 'rgba(40,58,102,0.28)'; g.fill();
  cutRect(g, 0, 0, lay.w, lay.h, 12); g.fillStyle = C.paper; g.fill();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const cx = lay.w / 2;
  const glyphPos = [];
  if (card.kind === 'lyric') {
    g.fillStyle = C.navy; g.font = `700 18px ${FONT_KO}`; g.fillText(card.text, cx, lay.sy);
  } else if (card.kind === 'listen') {
    const it = card.item, known = R.ch ? R.ch.known : '';
    // 귀 표시
    rr(g, 10, 10, 58, 24, 12); g.fillStyle = C.navy; g.fill();
    g.fillStyle = C.paper; g.font = `800 13px ${FONT_KO}`; g.fillText('듣기만', 39, 22.5);
    const chars = Array.from(it.kana);
    g.font = `800 ${lay.kana}px ${FONT_KANA}`;
    const cw = lay.kana * 0.92, sp = lay.kana * 0.45;
    let tot = 0; chars.forEach(c => tot += c === ' ' ? sp : cw);
    let x = cx - tot / 2 + 30; let prevShown = false;
    for (const ch of chars) {
      if (ch === ' ') { x += sp; prevShown = false; continue; }
      const show = known.includes(ch) || (ch === 'ー' && prevShown);
      if (show) { g.fillStyle = C.navy; g.fillText(ch, x + cw / 2, lay.ky + 2); }
      else wave(g, x + cw / 2, lay.ky, cw * 0.62, C.slate);
      prevShown = show; x += cw;
    }
    const line = [it.ko, settings.meaning ? it.mean : ''].filter(Boolean).join(' · ');
    g.fillStyle = C.navy; g.font = `700 18px ${FONT_KO}`; g.fillText(line, cx, lay.sy);
  } else {
    // 글자·낱말: 부른 글자부터 나타남. 노트 길로 내려간 글자는 옅게 남김
    const kanaStr = card.kind === 'letter' ? card.glyphs[0].k : card.word.kana.replace(/\s/g, '');
    const chars = Array.from(kanaStr);
    g.font = `800 ${lay.kana}px ${FONT_KANA}`;
    const ws = chars.map(c => g.measureText(c).width), tot = ws.reduce((a, b) => a + b, 0);
    let x = cx - tot / 2;
    chars.forEach((c, i) => {
      const gx = x + ws[i] / 2;
      glyphPos.push({ x: gx, y: lay.ky, size: lay.kana });
      const rev = card.kind === 'complete' ? true : (revealed >> i) & 1;
      const gone = card.kind !== 'complete' && (flown >> i) & 1;
      if (rev) { g.globalAlpha = gone ? 0.22 : 1; g.fillStyle = C.navy; g.fillText(c, gx, lay.ky + lay.kana * 0.04); g.globalAlpha = 1; }
      x += ws[i];
    });
    const allRev = card.kind === 'complete' || revealed === (1 << chars.length) - 1;
    if (card.kind === 'letter') {
      const sp = soundParts(card.glyphs[0].info);
      if (sp && revealed) drawSoundLine(g, sp[0], sp[1], 24, cx, lay.sy, [1, 0.35, 0][fl]);
    } else {
      const w = card.word;
      const sp = settings.sound === 'off' ? null : settings.sound === 'ko' ? [w.ko, null] : settings.sound === 'ro' ? [null, w.ro] : [w.ko, w.ro];
      if (sp && allRev) drawSoundLine(g, sp[0], sp[1], 20, cx, lay.sy, 1);
      if (settings.meaning && allRev && w.mean) {
        g.font = `800 18px ${FONT_KO}`;
        const mw = g.measureText(w.mean).width + 28;
        rr(g, cx - mw / 2, lay.my - 14, mw, 28, 14); g.fillStyle = C.apricot; g.fill();
        g.fillStyle = C.navy; g.fillText(w.mean, cx, lay.my + 0.5);
      }
    }
  }
  R.cardCache.key = key; R.cardCache.lay = lay; R.cardCache.glyphPos = glyphPos; R.cardCache.pad = pad;
  return R.cardCache;
}
// 카드 안 글자 i의 화면 자리(무대 좌표). 카드마다 한 번만 재서 기억(그리기 캐시와 따로)
let measureCtx = null;
function cardGlyphPos(card, i) {
  if (!card._gp) {
    const lay = cardLayout(card);
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    const kanaStr = card.kind === 'letter' ? card.glyphs[0].k : card.word.kana.replace(/\s/g, '');
    const chars = Array.from(kanaStr);
    measureCtx.font = `800 ${lay.kana}px ${FONT_KANA}`;
    const ws = chars.map(c => measureCtx.measureText(c).width), tot = ws.reduce((a, b) => a + b, 0);
    let x = 195 - tot / 2;
    card._gp = ws.map(w => { const p = { x: x + w / 2, y: LAY.cardTop + lay.ky, size: lay.kana }; x += w; return p; });
  }
  return card._gp[i] || card._gp[0];
}

// ── 효과 신호(main에서 부름) ─────────────────────────
export function setCombo(c) { R.combo = c; }
export function pressVisual(side, down, t) {
  R.pressed[side] = down;
  if (!down) R.releaseT[side] = t;
}
// r: { note, res, delta }, t: 지금 곡 시각
export function judgeVisual(r, t, side) {
  const n = r.note, res = r.res;
  R.judgeText = { res, side, t0: t };
  R.fx.push({ type: 'flash', res, t0: t });
  if (res === 'MISS') {
    R.falls.push({ k: n.k, info: n.info, x: Math.max(LAY.targetX - 30, 56 + (n.t - t) / R.ch.beat * LAY.pxPerBeat), t0: t, btn: n.btn });
    regPulse(8, t, R.ch.beat);
  } else {
    R.fx.push({ type: res, side, t0: t });
    R.pops.push({ k: n.k, info: n.info, res, t0: t, btn: n.btn });
    if (res === 'PERFECT') {
      const barFirst = Math.abs(((n.t / R.ch.beat) % R.ch.bpb)) < 0.01;
      R.freeze = { at: t, until: t + (barFirst ? 0.066 : 0.033) };
      if (barFirst) R.shake = { t0: t, dur: 0.12 };
      R.hana.pose = 'hana_photo'; R.hana.until = n.t + R.ch.beat * 0.95;
      R.hana.hop = 6; R.hana.hopT = t; R.caller.hop = 4; R.caller.hopT = t;
    } else if (res === 'GREAT') {
      R.hana.hop = 4; R.hana.hopT = t; R.caller.hop = 4; R.caller.hopT = t;
      regPulse(1, t, R.ch.beat);
    } else regPulse(2, t, R.ch.beat);
  }
}
function regPulse(px, t, dur) { if (px >= R.reg.amt * (1 - clamp01((t - R.reg.t0) / R.reg.dur))) R.reg = { amt: px, t0: t, dur }; }
export function gagVisual(tBeat) { R.hana.pose = 'hana_slip'; R.hana.until = tBeat + R.ch.beat; R.hana.slipFrom = tBeat; }
export function wordCompleteVisual(word, t) { R.complete = { kind: 'complete', id: 'c' + word.kana, word, t0: t }; }
export function resetVisuals() {
  R.fx.length = 0; R.pops.length = 0; R.falls.length = 0; R.judgeText = null; R.complete = null;
  R.hana = { pose: 'hana_beat', until: 0, hop: 0, hopT: -9 }; R.caller = { hop: 0, hopT: -9 };
  R.reg = { amt: 0, t0: -9, dur: 0.5 }; R.freeze = { at: 0, until: -9 }; R.shake = { t0: -9, dur: 0.12 };
  R.pressed.L = R.pressed.R = false; R.combo = 0;
}

// ── 한 프레임 ───────────────────────────────
// mode: 'idle'(제목·보정·결과 뒤 무대) | 'play' | 'pause'
export function draw(t, mode, extra) {
  const g = R.g, L = R.L, S = R.dpr * L.s;
  const ch = R.ch, beat = ch ? ch.beat : 0.5;
  // 무대 시각: PERFECT 때 무대만 2~4프레임 멈춤(곡·노트·버튼은 멈추지 않음)
  let st = t;
  if (mode === 'play' && t >= R.freeze.at && t < R.freeze.until) st = R.freeze.at;
  let shx = 0;
  if (mode === 'play') { const p = (t - R.shake.t0) / R.shake.dur; if (p >= 0 && p < 1) shx = Math.sin(p * Math.PI * 6) * 4 * (1 - p); }
  // 박 맥박(배경이 늘 박에 맞춰 움직임, 원칙 6)
  const bph = st >= 0 ? (st / beat) % 1 : ((st / beat) % 1 + 1) % 1;
  const pulse = Math.exp(-bph * beat / 0.11);

  // 1) 배경
  g.setTransform(1, 0, 0, 1, 0, 0);
  if (R.bgCache) {
    const z = 1 + 0.007 * pulse;
    const px = R.dpr * (L.ox + 195 * L.s), py = R.dpr * (L.oy + LAY.groundY * L.s);
    g.setTransform(z, 0, 0, z, px * (1 - z) + shx * S, py * (1 - z));
    g.drawImage(R.bgCache, 0, 0);
  } else { g.fillStyle = C.mint; g.fillRect(0, 0, R.canvas.width, R.canvas.height); }
  g.setTransform(S, 0, 0, S, R.dpr * L.ox, R.dpr * L.oy);

  // 2) 눈송이(무대 위쪽만)
  drawSnow(g, st, shx);

  // 3) 종이 인형
  drawDolls(g, st, t, mode, beat, shx);

  if (mode === 'play' || mode === 'pause') {
    // 4) 카드
    drawCard(g, t);
    // 5) 노트 길
    drawLane(g, t);
    // 6) 판정 글자·버튼·고리·터짐
    drawJudgeText(g, t);
    drawButtons(g, t);
    drawRings(g, t);
    drawBursts(g, t);
    // 7) 일시정지·콤보
    drawHud(g);
  }
  if (R.debug && extra) drawDebug(g, t, extra);
}

function drawSnow(g, t, shx) {
  const v = vis(), a = R.snow, n = a.length / 6, H = LAY.laneTop + 30 - v.y0;
  for (let i = 0; i < n; i++) {
    const o = i * 6;
    let y = (a[o + 1] + t * a[o + 2]) % H; if (y < 0) y += H; y += v.y0 - 15;
    const x = a[o] + Math.sin(t * 0.9 + a[o + 4]) * a[o + 3] + shx;
    const sz = 5 + (i % 4) * 1.6;
    g.globalAlpha = 0.9;
    g.drawImage(R.flake[a[o + 5]], x - sz / 2, y - sz / 2, sz, sz);
  }
  g.globalAlpha = 1;
}

function dollDraw(g, id, cx, footY, ang, scale, regPx) {
  const d = R.dolls[id]; if (!d) return;
  const k = d.info.cssPerPx * scale, w = d.info.w * k, h = d.info.h * k;
  const fy = d.info.footY * k;
  g.save();
  g.translate(cx, footY); g.rotate(ang);
  g.drawImage(d.shadow, -w / 2 + 3, -fy + 4, w, h);
  if (regPx > 0.4) { g.drawImage(d.tan, -w / 2 - regPx, -fy, w, h); g.drawImage(d.sky, -w / 2 + regPx, -fy, w, h); }
  g.drawImage(d.img, -w / 2, -fy, w, h);
  g.restore();
}

function drawDolls(g, st, t, mode, beat, shx) {
  const ch = R.ch;
  const ph = st >= 0 ? (st / beat) % 1 : 0;
  const bi = Math.floor(st / beat);
  // 박마다 살짝 튐(앞 30%) + 박마다 좌우로 2° 기울기
  const hop = ph < 0.3 ? Math.sin(ph / 0.3 * Math.PI) * 5 : 0;
  const sway = (bi % 2 ? 1 : -1) * 2 * (1 - easeInOut(clamp01(ph / 0.5)) * 0.4);
  // 카드가 떠 있는 동안 바깥으로 8°
  let tilt = 0;
  if ((mode === 'play' || mode === 'pause') && ch) {
    const c = cardAt(ch, t);
    if (c && c.kind !== 'lyric') {
      const inP = clamp01((t - c.tShow) / 0.12), outP = clamp01((c.tEnd - t) / 0.12);
      tilt = 8 * Math.min(inP, outP);
    }
  }
  const reg = R.reg.amt * (1 - clamp01((t - R.reg.t0) / R.reg.dur));
  const extraHop = (o) => { const p = (t - o.hopT) / 0.18; return p >= 0 && p < 1 ? Math.sin(p * Math.PI) * o.hop : 0; };
  // 아저씨: 딱따기 칠 때 · せーの 때는 딱따기 포즈, 그 밖에는 확성기 포즈
  let cPose = 'caller_call';
  if (ch && (mode === 'play' || mode === 'pause')) {
    for (const c of ch.calls) {
      if (c.end === 'knock' && t >= c.endT - 0.06 && t < c.endT + ch.beat * 1.6) cPose = 'caller_clap';
    }
  } else if (mode === 'idle') cPose = Math.floor(st / (beat * 8)) % 2 ? 'caller_clap' : 'caller_call';
  const D = (deg) => deg * Math.PI / 180;
  dollDraw(g, cPose, LAY.dollX.caller + shx, LAY.footY - hop - extraHop(R.caller), D(tilt + sway * 0.6), 1, reg);
  // 하나: 기본 '박 맞추기', PERFECT 뒤 1박 '사진 찍기', 받는 마디 첫 MISS의 다음 박에 '미끄러짐'
  let hPose = 'hana_beat';
  if (mode !== 'idle' && t < R.hana.until && t >= (R.hana.slipFrom && R.hana.pose === 'hana_slip' ? R.hana.slipFrom : -1e9)) hPose = R.hana.pose;
  if (mode === 'idle' && R.idlePose) hPose = R.idlePose;
  dollDraw(g, hPose, LAY.dollX.hana + shx, LAY.footY - hop - extraHop(R.hana), D(-tilt - sway * 0.6), 1, reg);
}
export function setIdlePose(p) { R.idlePose = p; }

function drawCard(g, t) {
  const ch = R.ch;
  let c = cardAt(ch, t);
  // 낱말 완성(받는 마디에서 다 맞힘): 다음 카드가 나오기 전까지 1박 동안 크게
  if (R.complete && (!c || c.tShow < R.complete.t0)) {
    const p = (t - R.complete.t0) / ch.beat;
    if (p >= 0 && p < 1.6) { drawCardAt(g, R.complete, t, 1 + 0.18 * (1 - easeOut(clamp01(p / 0.3))), p > 1.3 ? (1.6 - p) / 0.3 : 1); c = null; }
    else if (p >= 1.6) R.complete = null;
  }
  if (c) {
    const inP = easeOut(clamp01((t - c.tShow) / 0.1));
    let sc = 0.85 + 0.15 * inP, al = inP;
    if (t > c.tOut) { const p = clamp01((t - c.tOut) / c.outDur); sc *= 1 - 0.35 * p; al *= 1 - p; }
    drawCardAt(g, c, t, sc, al);
  }
  // 날아가는 글자: 카드 → 노트 길 오른쪽 끝
  for (const n of ch.notes) {
    if (n.card === null || t < n.flightStart || t >= n.flightEnd) continue;
    const p = clamp01((t - n.flightStart) / (n.flightEnd - n.flightStart)), e = easeOut(p);
    const from = cardGlyphPos(n.card, n.glyph);
    // 가로: 카드 → x 416(곡선), 도착 순간의 속도를 노트 길 속도(1박 144px)와 이어 붙임 → 내려앉자마자 같은 빠르기로 흐름
    const dur = n.flightEnd - n.flightStart, m1 = -LAY.pxPerBeat / R.ch.beat * dur;
    const p2 = p * p, p3 = p2 * p;
    const x = (2 * p3 - 3 * p2 + 1) * from.x + (-2 * p3 + 3 * p2) * LAY.laneEndX + (p3 - p2) * m1;
    const y = from.y + (LAY.laneY - from.y) * e;
    const size = from.size + (28 - from.size) * e;
    const r = LAY.noteR * e;
    if (r > 1) { circle(g, x, y, r); g.fillStyle = C.paper; g.fill(); g.lineWidth = 2; g.strokeStyle = C.navy; g.stroke(); }
    g.fillStyle = C.navy; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `800 ${size.toFixed(1)}px ${FONT_KANA}`;
    g.fillText(n.k, x, y - 6 * e);
  }
}
function drawCardAt(g, c, t, sc, al) {
  if (al <= 0) return;
  const cc = renderCard(c, t), lay = cc.lay, pad = cc.pad;
  const cx = 195, cy = LAY.cardTop + lay.h / 2;
  g.save(); g.globalAlpha = al;
  g.translate(cx, cy); g.scale(sc, sc);
  g.drawImage(cc.cv, -lay.w / 2 - pad, -lay.h / 2 - pad, lay.w + pad * 2, lay.h + pad * 2);
  g.restore();
}

export function laneX(n, t) { return LAY.targetX + (n.t - t) / R.ch.beat * LAY.pxPerBeat; }

function drawLane(g, t) {
  const v = vis();
  g.fillStyle = 'rgba(255,248,236,0.85)'; g.fillRect(v.x0, LAY.laneTop, v.x1 - v.x0, LAY.laneBot - LAY.laneTop);
  g.fillStyle = C.navy; g.fillRect(v.x0, LAY.laneTop, v.x1 - v.x0, 2); g.fillRect(v.x0, LAY.laneBot - 2, v.x1 - v.x0, 2);
  // 맞춤 고리 (56, 524) 바깥 지름 80, 선 6 + 판정 색으로 한 번 참
  for (let i = R.fx.length - 1; i >= 0; i--) {
    const f = R.fx[i]; if (f.type !== 'flash') continue;
    const p = (t - f.t0) / 0.2;
    if (p >= 0 && p < 1) { circle(g, LAY.targetX, LAY.laneY, 34); g.globalAlpha = 0.45 * (1 - p); g.fillStyle = JCOLOR[f.res]; g.fill(); g.globalAlpha = 1; }
    break;
  }
  circle(g, LAY.targetX, LAY.laneY, 37); g.lineWidth = 6; g.strokeStyle = C.tan; g.stroke();
  // 노트(시각순). 노트 길 위 거리 = 시간 × 같은 속도
  const ch = R.ch, probe = R.probe;
  for (const n of ch.notes) {
    if (n.judged || t < n.flightEnd) continue;
    const x = laneX(n, t);
    if (x < -40) continue;
    if (x > v.x1 + 40) break;
    const spr = noteSprite(n, fadeAlpha(n.k), false);
    g.drawImage(spr, x - 36, LAY.laneY - 36, 72, 72);
    if (probe && Math.abs(n.t - t) < 0.3) probe.push({ id: n.id, t, T: n.t, x, kind: 'x' });
  }
  // 맞힌 글자: 맞춤 고리 자리에서 커지며 사라짐(PERFECT 1.8배)
  for (let i = R.pops.length - 1; i >= 0; i--) {
    const p0 = R.pops[i], p = (t - p0.t0) / 0.26;
    if (p >= 1 || p < 0) { if (p >= 1) R.pops.splice(i, 1); continue; }
    const big = p0.res === 'PERFECT' ? 1.8 : p0.res === 'GREAT' ? 1.5 : 1.25;
    const sc = 1 + (big - 1) * easeOut(p);
    g.save(); g.translate(LAY.targetX, LAY.laneY - 6); g.scale(sc, sc); g.globalAlpha = 1 - p * p;
    g.fillStyle = JCOLOR[p0.res] === C.mint ? C.navy : C.navy; g.textAlign = 'center'; g.textBaseline = 'middle';
    if (p0.btn === 'L') {
      g.font = `800 28px ${FONT_KANA}`; g.fillText(p0.k, 0, 0);
      const snd = bubbleSound(p0.info), fa = fadeAlpha(p0.k);
      if (snd && fa > 0) { g.globalAlpha *= fa; g.fillStyle = C.muted; g.font = `800 13px ${FONT_KO}`; g.fillText(snd, 0, 22); }
    }
    g.restore();
  }
  // 놓친 말풍선: 반 바퀴 뒤집혀(180ms, 뒷면 회청) 아래로 팔랑 떨어짐(400ms)
  for (let i = R.falls.length - 1; i >= 0; i--) {
    const f = R.falls[i], dt = t - f.t0;
    if (dt > 0.6) { R.falls.splice(i, 1); continue; }
    if (dt < 0) continue;
    const flip = clamp01(dt / 0.18), fall = Math.max(0, dt - 0.18);
    const sx = Math.cos(flip * Math.PI), back = sx < 0;
    const y = LAY.laneY + 900 * fall * fall, x = f.x - 40 * fall;
    g.save(); g.translate(x, y); g.rotate(-0.6 * fall / 0.4); g.scale(Math.abs(sx) < 0.05 ? 0.05 : Math.abs(sx), 1);
    g.globalAlpha = 1 - clamp01((dt - 0.4) / 0.2);
    if (back) { circle(g, 0, 0, LAY.noteR); g.fillStyle = C.slate; g.fill(); g.lineWidth = 2; g.strokeStyle = C.navy; g.stroke(); }
    else {
      // 놓쳤을 때는 흐려짐을 무시하고 소리를 또렷이 한 번
      const spr = noteSprite({ k: f.k, info: f.info, btn: f.btn }, 1, false);
      g.drawImage(spr, -36, -36, 72, 72);
    }
    g.restore();
  }
}

function drawJudgeText(g, t) {
  const j = R.judgeText; if (!j) return;
  const dt = t - j.t0; if (dt > 0.45 || dt < 0) { if (dt > 0.45) R.judgeText = null; return; }
  const x = LAY.btnX[j.side || 'L'], y = LAY.judgeY;
  const pop = dt < 0.08 ? 1.2 - 0.2 * (dt / 0.08) : 1;
  const al = dt > 0.35 ? 1 - (dt - 0.35) / 0.1 : 1;
  g.save(); g.globalAlpha = al; g.translate(x, y); g.scale(pop, pop);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  if (j.res === 'MISS') {
    g.rotate(-8 * Math.PI / 180);
    rr(g, -40, -18, 80, 36, 6); g.fillStyle = C.slate; g.fill();
    g.fillStyle = C.navy; g.font = `700 28px ${FONT_KO}`; g.fillText('MISS', 0, 1);
  } else {
    const spec = { PERFECT: [900, 40], GREAT: [800, 34], GOOD: [700, 28] }[j.res];
    g.font = `${spec[0]} ${spec[1]}px ${FONT_KO}`;
    g.lineJoin = 'round'; g.lineWidth = 4; g.strokeStyle = C.navy; g.strokeText(j.res, 0, 0);
    g.fillStyle = JCOLOR[j.res]; g.fillText(j.res, 0, 0);
  }
  g.restore();
}

function drawButtons(g, t) {
  for (const side of ['L', 'R']) {
    const x = LAY.btnX[side], y = LAY.btnY, down = R.pressed[side];
    const pr = t - R.releaseT[side];
    const sc = !down && pr >= 0 && pr < 0.08 ? 1 + 0.03 * Math.sin(pr / 0.08 * Math.PI) : 1;
    const top = side === 'L' ? C.scarlet : C.sun, base = side === 'L' ? C.scarletBase : C.sunBase;
    circle(g, x, y, 68); g.fillStyle = 'rgba(40,58,102,0.6)'; g.fill();
    circle(g, x, y + 6, 60 * sc); g.fillStyle = base; g.fill();
    const ty = y + (down ? 6 : 0);
    circle(g, x, ty, 60 * sc); g.fillStyle = top; g.fill();
    circle(g, x, ty, 58.5 * sc); g.lineWidth = 3; g.strokeStyle = C.paper; g.stroke();
    g.lineWidth = 4; g.strokeStyle = C.paper; g.fillStyle = C.paper;
    if (side === 'L') { circle(g, x, ty, 15); down ? g.fill() : g.stroke(); }
    else { rr(g, x - 17, ty - 17, 34, 34, 8); down ? g.fill() : g.stroke(); }
  }
}

// 버튼 고리: 노트 1박 전 바깥 지름 192 → 같은 빠르기로 줄어 노트 시각에 버튼 가장자리(지름 120)에 닿음
function drawRings(g, t) {
  const ch = R.ch, beat = ch.beat, probe = R.probe;
  for (const side of ['L', 'R']) {
    let shown = 0;
    for (const n of ch.notes) {
      if (n.btn !== side || n.judged) continue;
      const dt = n.t - t;
      if (dt > beat) break;
      if (dt < -0.08) continue;
      const outer = dt >= 0 ? LAY.ringEnd + (LAY.ringStart - LAY.ringEnd) * (dt / beat) : LAY.ringEnd;
      let al = shown === 0 ? 1 : 0.4;
      if (dt < 0) al *= 1 + dt / 0.08;
      g.globalAlpha = al;
      circle(g, LAY.btnX[side], LAY.btnY, outer - 2); g.lineWidth = 4; g.strokeStyle = C.navy; g.stroke();
      circle(g, LAY.btnX[side], LAY.btnY, outer - 5); g.lineWidth = 2; g.strokeStyle = C.paper; g.stroke();
      g.globalAlpha = 1;
      if (probe && Math.abs(dt) < 0.3) probe.push({ id: n.id, t, T: n.t, r: outer, kind: 'r' });
      if (++shown >= 2) break;
    }
  }
}

// 터짐(반지름 96 안): PERFECT 종이 띠 8장 · GREAT 하늘 고리 · GOOD 민트 조각 3개
function drawBursts(g, t) {
  for (let i = R.fx.length - 1; i >= 0; i--) {
    const f = R.fx[i], dt = t - f.t0;
    if (dt > 0.5) { R.fx.splice(i, 1); continue; }
    if (dt < 0 || f.type === 'flash') continue;
    const x = LAY.btnX[f.side], y = LAY.btnY;
    if (f.type === 'PERFECT') {
      let r, wsc;
      if (dt < 0.06) { r = 65 + 30 * easeOut(dt / 0.06); wsc = 1; }
      else { const p = clamp01((dt - 0.06) / 0.18); r = 95 - 30 * p; wsc = 1 - p; }
      if (wsc <= 0) continue;
      g.save(); g.translate(x, y);
      for (let k = 0; k < 8; k++) {
        g.save(); g.rotate(k * Math.PI / 4);
        g.beginPath(); g.rect(-5 * wsc, -r, 10 * wsc, Math.min(30, r - 60)); g.fillStyle = k % 2 ? C.paper : C.tan; g.fill();
        g.lineWidth = 1.2; g.strokeStyle = C.navy; g.stroke();
        g.restore();
      }
      g.restore();
    } else if (f.type === 'GREAT') {
      const p = clamp01(dt / 0.2); if (p >= 1) continue;
      circle(g, x, y, 66 + 30 * easeOut(p) - 2.5); g.globalAlpha = 1 - p * 0.7; g.lineWidth = 5; g.strokeStyle = C.sky; g.stroke(); g.globalAlpha = 1;
    } else if (f.type === 'GOOD') {
      const p = clamp01(dt / 0.35); if (p >= 1) continue;
      const tris = [[-24, -70, -40], [0, -84, 0], [24, -70, 40]];
      for (const [ox, oy, vx] of tris) {
        const px = x + ox + vx * p * 0.5, py = y + oy - 40 * p + 120 * p * p;
        g.save(); g.translate(px, py); g.rotate(p * 3 + ox);
        g.beginPath(); g.moveTo(-7, -6); g.lineTo(8, -2); g.lineTo(-2, 8); g.closePath();
        g.globalAlpha = 1 - p; g.fillStyle = C.mint; g.fill(); g.lineWidth = 1.2; g.strokeStyle = C.navy; g.stroke();
        g.restore();
      }
    }
  }
}

function drawHud(g) {
  const P = LAY.pause, M = LAY.combo;
  rr(g, P.x, P.y, P.w, P.h, 14); g.fillStyle = C.paper; g.fill(); g.lineWidth = 2; g.strokeStyle = C.navy; g.stroke();
  g.fillStyle = C.navy; rr(g, P.x + 15, P.y + 14, 6, 20, 2); g.fill(); rr(g, P.x + 27, P.y + 14, 6, 20, 2); g.fill();
  rr(g, M.x, M.y, M.w, M.h, 12); g.fillStyle = C.paper; g.fill(); g.lineWidth = 2; g.strokeStyle = C.navy; g.stroke();
  g.fillStyle = R.combo ? C.navy : C.slate; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `800 28px ${FONT_KO}`; g.fillText(String(R.combo), M.x + M.w / 2, M.y + M.h / 2 + 1);
}

function drawDebug(g, t, ex) {
  g.save(); g.fillStyle = 'rgba(29,42,76,0.75)'; g.fillRect(8, 112, 150, 64);
  g.fillStyle = '#fff'; g.font = `600 11px ${FONT_KO}`; g.textAlign = 'left'; g.textBaseline = 'top';
  g.fillText(`t ${t.toFixed(3)}  fps ${ex.fps}`, 14, 118);
  g.fillText(`보정 ${ex.offsetMs}ms  지연 ${ex.lat}`, 14, 134);
  g.fillText(ex.note || '', 14, 150);
  g.restore();
}
