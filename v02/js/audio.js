// audio.js · 곡·효과음 (원칙 3·4)
// - 곡 길: 크기·필터·압축 변화 0(덕킹 없음). 판 1·2 끝 = 원곡을 N마디 4&에서 40ms로 줄여 끊고 다음 마디 1박에 곡 자신의 마지막 한 방을 붙인
//   '판별 곡'을 불러올 때 메모리에서 한 번 만듦(재생 중 이어 붙이지 않음, 원칙 5).
// - 효과음: 불러올 때 앞 무음 자르기 → 필터 → 실제 곡 꼭대기 대비 크기. 판정별 '누르는 즉시' 소리는 층을 미리 섞어 한 버퍼(리미터 지연 없음),
//   '크게'(+3dB)에서도 섞인 꼭대기가 곡 꼭대기 −6.5dB를 넘지 않게 깎음.
// - 10-19 소리 검토: 폰 스피커에서 묻힘(C1) → 북 사본에서 만든 500Hz~1kHz 배음 층 + 어택 −12dB · GOOD 2층(I1) · 콤보 무리 손뼉 고역만(I3)
//   · 결과·메뉴 소리(I4, ui 길은 곡 길과 따로) · 디코드 정렬 자동 대조(I6).
import * as Clock from './clock.js';
import { settings } from './settings.js';

const dbl = db => Math.pow(10, db / 20);
export const AU = { ctx: null, master: null, songBus: null, sfxBus: null, uiBus: null, full: null, peak: 0.64, snd: {}, hit: {}, panBuf: null, muted: false, stats: {}, pending: [], loops: [] };
export function stopPending() { for (const s of AU.pending) { try { s.stop(); } catch (e) { /* 이미 끝남 */ } } AU.pending.length = 0; }

export function setup(muted) {
  const ctx = Clock.createContext(); AU.ctx = ctx; AU.muted = !!muted;
  AU.master = ctx.createGain(); AU.master.gain.value = muted ? 0 : 1; AU.master.connect(ctx.destination);
  AU.songBus = ctx.createGain(); AU.songBus.gain.value = 1; AU.songBus.connect(AU.master);
  AU.sfxBus = ctx.createGain(); AU.sfxBus.connect(AU.master);
  AU.uiBus = ctx.createGain(); AU.uiBus.gain.value = 1; AU.uiBus.connect(AU.master);
  AU.voiceBus = ctx.createGain(); AU.voiceBus.gain.value = settings.voice === false ? 0 : 1; AU.voiceBus.connect(AU.master);
  applySfxLevel();
}
export function applySfxLevel() { if (AU.sfxBus) AU.sfxBus.gain.value = dbl({ low: -4, mid: 0, high: 3 }[settings.sfx] || 0); if (AU.voiceBus) AU.voiceBus.gain.value = settings.voice === false ? 0 : 1; }

async function fetchDecode(url) {
  const r = await fetch(url); if (!r.ok) throw new Error('소리 없음: ' + url);
  const ab = await r.arrayBuffer();
  return await new Promise((ok, no) => { const p = AU.ctx.decodeAudioData(ab, ok, no); if (p && p.then) p.then(ok, no); });
}

// 디코드 정렬 대조(소리 검토 I6): 전주 킥(1~4마디 박) 자리에서 가장 큰 에너지 오름이 곡 지도 박과 얼마나 다른지 → 가운데값이 3ms 넘으면 버퍼를 그만큼 옮김
function decodeShift(b, beatsMs) {
  const sr = b.sampleRate, d0 = b.getChannelData(0), d1 = b.numberOfChannels > 1 ? b.getChannelData(1) : d0, hop = Math.round(sr * 0.002);
  const E = t => { const s = Math.round(t * sr); let e = 0; for (let i = s; i < s + hop; i++) { const x = d0[i] + d1[i]; e += x * x; } return e + 1e-12; };
  const offs = [];
  for (let p = 2; p < 18; p++) {
    const t = beatsMs[p] / 1000; let best = -99, at = 0;
    for (let k = -20; k <= 20; k++) { const tt = t + k * 0.002; let pr = 0; for (let j = 2; j <= 10; j++) pr += E(tt - j * 0.002); pr /= 9; const db = 10 * Math.log10(E(tt) / pr); if (db > best) { best = db; at = k * 2; } }
    offs.push(at);
  }
  offs.sort((a, b2) => a - b2);
  return offs[Math.floor(offs.length / 2)];
}
export async function loadSong(url, beatsMs) {
  let b = await fetchDecode(url);
  const sh = beatsMs ? decodeShift(b, beatsMs) : 0;
  AU.stats.decodeShiftMs = sh;
  if (Math.abs(sh) >= 3) {   // 해독된 소리가 sh ms 늦으면 앞을 잘라 당김(이르면 앞에 무음)
    const n = Math.round(Math.abs(sh) / 1000 * b.sampleRate), out = AU.ctx.createBuffer(b.numberOfChannels, b.length, b.sampleRate);
    for (let c = 0; c < b.numberOfChannels; c++) { const a = b.getChannelData(c), o = out.getChannelData(c); if (sh > 0) o.set(a.subarray(n)); else o.set(a.subarray(0, a.length - n), n); }
    b = out;
  }
  AU.full = b;
  let pk = 0;
  for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) { const v = d[i] < 0 ? -d[i] : d[i]; if (v > pk) pk = v; } }
  AU.peak = pk || 0.64;
  AU.stats.songPeakDb = Math.round(20 * Math.log10(AU.peak) * 10) / 10;
  AU.stats.songSec = Math.round(b.duration * 100) / 100;
  return b;
}

export function buildPanBuffer(pan) {
  const F = AU.full, sr = F.sampleRate, eh = pan.endHit;
  const lenSec = pan.hitAt + (eh.until - eh.attack) + 0.05;
  const out = AU.ctx.createBuffer(F.numberOfChannels, Math.ceil(lenSec * sr), sr);
  const cutS = Math.round(pan.cut * sr), fadeS = Math.round(pan.cutFadeMs / 1000 * sr);
  const srcS = Math.round(eh.srcFrom * sr), dstS = Math.round((pan.hitAt - (eh.attack - eh.srcFrom)) * sr);
  const tailS = Math.min(F.length - srcS, out.length - dstS);
  for (let c = 0; c < F.numberOfChannels; c++) {
    const a = F.getChannelData(c), o = out.getChannelData(c);
    o.set(a.subarray(0, cutS));
    for (let i = 0; i < fadeS; i++) o[cutS - fadeS + i] *= 0.5 * (1 + Math.cos(Math.PI * (i + 1) / fadeS));
    o.set(a.subarray(srcS, srcS + tailS), dstS);
    const f2 = Math.round(0.0015 * sr); for (let i = 0; i < f2; i++) o[dstS + i] *= i / f2;
  }
  AU.panBuf = out;
  return out;
}

// ── 효과음 재료 ─────────────────────────────
const FS = 'assets/sfx/fs/', ST = 'assets/sfx/stem/';
const ROLES = {
  tom:    { file: ST + 'body_tom.wav',  db: -10, max: 0.17, fade: 0.06, chain: [['pk', 2300, -3, 0.8]] },
  clap:   { file: ST + 'body_clap.wav', db: -10, max: 0.16, fade: 0.05, chain: [['pk', 2300, -3, 0.8]] },
  crash:  { file: ST + 'crash.wav',     db: -14, max: 0.42, fade: 0.25, chain: [['hp', 5000, 0.707], ['hp', 5000, 0.707]] },
  attack: { file: FS + '140459_packaging_paper_finger_flick.mp3', db: -12, max: 0.035, fade: 0.014, chain: [['hp', 5000, 0.707], ['hp', 5000, 0.707]] },
  glock:  { file: FS + '373366_glockenspiel_c7_glock_medium.mp3', db: -20, max: 0.7, fade: 0.35, chain: [['hp', 5000, 0.707], ['hp', 5000, 0.707]], pc: 0 },
  tick:   { file: FS + '115503_ppk_tick_06.mp3', db: -18, max: 0.15, fade: 0.03, chain: [['hp', 4000, 0.707]] },
  gag:    { file: FS + '388031_medium_pillow_hit.mp3', db: -12, max: 0.8, fade: 0.15, chain: [['lp', 600, 0.707], ['lp', 600, 0.707]] },
  clave:  { file: FS + '94027_llfclave.mp3', db: -14, max: 0.3, fade: 0.05, chain: [], pc: 0 },
  claveHi:{ file: FS + '94027_llfclave.mp3', db: -20, max: 0.06, fade: 0.03, chain: [['hp', 5000, 0.707], ['hp', 5000, 0.707]] },   // 노래 위 딱따기: 5kHz 위 짧은 '딱'(리듬 검토 10-19 I3)
  crowd:  { file: FS + '561088_clap_2.mp3', db: -18, max: 1.2, fade: 0.1, chain: [['hp', 4000, 0.707], ['hp', 4000, 0.707]] },
  pen:    { file: FS + '323747_pen_click.mp3', db: -14, max: 0.2, fade: 0.04, chain: [['hp', 1500, 0.707]] },
  wood:   { file: FS + '547414_wood_hit.mp3', db: -12, max: 0.25, fade: 0.08, chain: [['hp', 400, 0.707], ['lp', 1400, 0.707]] },
  page:   { file: FS + '397548_page_turn_01.mp3', db: -14, max: 0.7, fade: 0.08, chain: [] },
  click:  { file: FS + '171697_menu_selection_click.mp3', db: -16, max: 0.25, fade: 0.03, chain: [] },
};
const OAC = () => window.OfflineAudioContext || window.webkitOfflineAudioContext;
function biq(oc, type, f, a, q) {
  const bq = oc.createBiquadFilter();
  if (type === 'pk') { bq.type = 'peaking'; bq.frequency.value = f; bq.gain.value = a; bq.Q.value = q; }
  else { bq.type = type === 'hp' ? 'highpass' : type === 'lp' ? 'lowpass' : 'bandpass'; bq.frequency.value = f; bq.Q.value = a; }
  return bq;
}
function norm(buf, db) {
  const od = buf.getChannelData(0); let p2 = 0; for (let i = 0; i < od.length; i++) p2 = Math.max(p2, Math.abs(od[i]));
  const k = p2 > 0 ? AU.peak * dbl(db) / p2 : 1; for (let i = 0; i < od.length; i++) od[i] *= k;
  return buf;
}
async function process(raw, role) {
  const sr = raw.sampleRate, ch = raw.numberOfChannels;
  const n = raw.length, mono = new Float32Array(n);
  for (let c = 0; c < ch; c++) { const d = raw.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / ch; }
  let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(mono[i]));
  let s0 = 0; const thr = pk * dbl(-30); while (s0 < n && Math.abs(mono[s0]) < thr) s0++;
  s0 = Math.max(0, s0 - Math.round(0.0015 * sr));
  const len = Math.min(n - s0, Math.round(role.max * sr));
  const oc = new (OAC())(1, len, sr);
  const b = oc.createBuffer(1, len, sr); const bd = b.getChannelData(0);
  bd.set(mono.subarray(s0, s0 + len));
  const fs = Math.min(len, Math.round(role.fade * sr)); for (let i = 0; i < fs; i++) bd[len - fs + i] *= 0.5 * (1 + Math.cos(Math.PI * (i + 1) / fs));
  const src = oc.createBufferSource(); src.buffer = b;
  let node = src;
  for (const [type, f, a, q] of role.chain) { const bq = biq(oc, type, f, a, q); node.connect(bq); node = bq; }
  node.connect(oc.destination); src.start(0);
  return norm(await oc.startRendering(), role.db);
}
// 폰 스피커용 중역 층(소리 검토 C1): 몸통 사본을 tanh(4배)로 배음을 만든 뒤 500Hz~1kHz(4차)만 남김 → 북 음의 3~5배음이라 음이 안 어긋남
async function midLayer(src, db) {
  const sr = src.sampleRate, oc = new (OAC())(1, src.length, sr);
  const s = oc.createBufferSource(); s.buffer = src;
  const pre = oc.createGain(); pre.gain.value = 4 / (AU.peak * dbl(-10));
  const ws = oc.createWaveShaper(); const curve = new Float32Array(1025); for (let i = 0; i < 1025; i++) { const x = (i - 512) / 512 * 4; curve[i] = Math.tanh(x); } ws.curve = curve;
  let node = ws; s.connect(pre); pre.connect(ws);
  for (const [t2, f] of [['hp', 500], ['hp', 500], ['lp', 1000], ['lp', 1000]]) { const bq = biq(oc, t2, f, 0.707); node.connect(bq); node = bq; }
  node.connect(oc.destination); s.start(0);
  return norm(await oc.startRendering(), db);
}
// 층 섞기: [[이름, dB(역할 기준 더함), 저역 통과 Hz 또는 0]]. 섞은 뒤 '크게'(+3dB)에서도 곡 꼭대기 −6.5dB 안으로
async function mix(layers) {
  const sr = AU.snd.tom.sampleRate;
  let len = 0; for (const [nm] of layers) len = Math.max(len, AU.snd[nm].length);
  const oc = new (OAC())(1, len, sr);
  for (const [nm, db, lp] of layers) {
    const s = oc.createBufferSource(); s.buffer = AU.snd[nm];
    const g = oc.createGain(); g.gain.value = dbl(db);
    if (lp) { const f = oc.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; s.connect(f); f.connect(g); } else s.connect(g);
    g.connect(oc.destination); s.start(0);
  }
  const out = await oc.startRendering();
  const d = out.getChannelData(0); let pk = 0; for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
  const cap = AU.peak * dbl(-6.5 - 3);
  if (pk > cap) { const k = cap / pk; for (let i = 0; i < d.length; i++) d[i] *= k; pk = cap; }
  out._peakDb = Math.round(20 * Math.log10(pk / AU.peak) * 10) / 10;
  return out;
}

export async function loadSfx() {
  const names = Object.keys(ROLES);
  const raws = await Promise.all(names.map(nm => fetchDecode(ROLES[nm].file).catch(e => { console.warn('효과음 못 읽음', nm, e); return null; })));
  for (let i = 0; i < names.length; i++) if (raws[i]) AU.snd[names[i]] = await process(raws[i], ROLES[names[i]]);
  if (!AU.snd.tom) throw new Error('맞힘 몸통 소리 없음');
  AU.snd.midL = await midLayer(AU.snd.tom, -16);
  if (AU.snd.clap) AU.snd.midR = await midLayer(AU.snd.clap, -16);
  const H = {
    // 폰 스피커 흉내(500Hz 위)에서 PERFECT가 곡 대비 −6dB 이상인 노트 93%(소리 검토 C1 기준 80%): 북은 줄이고 나무 덩어리·배음 층을 키움(시험 조합 C)
    L_PERFECT: [['tom', -6], ['wood', 2], ['midL', 6], ['attack', 2]], L_PERFECT_C: [['tom', -6], ['wood', 2], ['midL', 6], ['attack', 2], ['crash', 0]],
    L_GREAT: [['tom', -7], ['wood', 0], ['midL', 4], ['attack', -2]], L_GREAT_C: [['tom', -7], ['wood', 0], ['midL', 4], ['attack', -2], ['crash', -3]],
    L_GOOD: [['tom', -8, 3000], ['wood', -3], ['midL', 2], ['tick', -8]], L_GOOD_C: [['tom', -8, 3000], ['wood', -3], ['midL', 2], ['tick', -8], ['crash', -8]],
    R_PERFECT: [['clap', 0], ['midR', 6], ['attack', 2]], R_GREAT: [['clap', -2], ['midR', 4], ['attack', -2]], R_GOOD: [['clap', -2, 3000], ['midR', 2], ['tick', -8]],
    TOK: [['tick', 0]], EMPTY: [['tick', -12]], HOLD_TICK: [['tick', -6]],
    REL: [['attack', 0], ['wood', -4], ['midL', 0]], SHUTTER: [['pen', 0], ['attack', -2]],
    STAMP: [['wood', 0], ['attack', -2]],
  };
  for (const k in H) { const ok = H[k].every(([nm]) => AU.snd[nm]); if (ok) AU.hit[k] = await mix(H[k]); }
  AU.stats.hitPeakDb = {}; for (const k in AU.hit) AU.stats.hitPeakDb[k] = AU.hit[k]._peakDb;
}

// 시험용: 판정별 층 표를 바꿔 다시 섞음(크기 맞추기 실험)
export async function tuneHits(H) { for (const k in H) { if (H[k].every(([nm]) => AU.snd[nm])) AU.hit[k] = await mix(H[k]); } const o = {}; for (const k in H) o[k] = AU.hit[k] && AU.hit[k]._peakDb; return o; }

function play(buf, when, gainDb, rate, bus) {
  if (!buf) return null;
  const ctx = AU.ctx;
  const s = ctx.createBufferSource(); s.buffer = buf;
  if (rate && rate !== 1) s.playbackRate.value = rate;
  let node = s;
  if (gainDb) { const g = ctx.createGain(); g.gain.value = dbl(gainDb); s.connect(g); node = g; }
  node.connect(bus || AU.sfxBus);
  s.start(when || 0);
  if (when && when > ctx.currentTime + 0.003) { AU.pending.push(s); if (AU.pending.length > 64) AU.pending.splice(0, 32); }
  return s;
}

export function hitNow(side, res, crash) {
  if (res === 'EMPTY') return play(AU.hit.EMPTY, 0);
  if (res === 'MISS') return play(AU.hit.TOK, 0);
  const key = side + '_' + res + (crash && side === 'L' ? '_C' : '');
  return play(AU.hit[key] || AU.hit[side + '_' + res] || AU.hit.L_GOOD, 0);
}
export function holdTick() { play(AU.hit.HOLD_TICK, 0); }
export function releaseNow(kind) { return play(kind === 'shutter' ? AU.hit.SHUTTER : AU.hit.REL, 0); }
// 길게 끝 소리를 곡 시각에 미리 예약(리듬 검토 I2). 손을 먼저 떼면 멈추고 그 자리에서 소리(원칙 3)
export function releaseAt(kind, songT) { return play(kind === 'shutter' ? AU.hit.SHUTTER : AU.hit.REL, Clock.ctxOfSong(songT)); }
export function cancel(src) { if (src) try { src.stop(); } catch (e) { /* 이미 끝남 */ } }
export function ui(name) { if (AU.snd[name]) play(AU.snd[name], 0, 0, 1, AU.uiBus); }
export function stampAt(sec) { play(AU.hit.STAMP, AU.ctx.currentTime + sec, 0, 1, AU.uiBus); }

function rateTo(basePc, targetPc) { let d = ((targetPc - basePc) % 12 + 12) % 12; if (d > 5) d -= 12; return Math.pow(2, d / 12); }
function chordPcs(tones) { return tones.map(m => ((m % 12) + 12) % 12); }
function rootFifth(tones) { const pcs = chordPcs(tones), r = pcs[0]; const f = pcs.includes((r + 7) % 12) ? (r + 7) % 12 : (pcs[2] != null ? pcs[2] : pcs[1]); return [r, f]; }
export function tails(res, noteSongT, beatLen, tones, pressCtx) {
  const g = AU.snd.glock; if (!g || !tones) return;
  const [r, f] = rootFifth(tones);
  const base = Clock.ctxOfSong(noteSongT);
  const now = AU.ctx.currentTime, min = Math.max(now + 0.005, (pressCtx || now) + 0.04);
  const put = (dt, pc, db) => { const w = base + dt; if (w >= min) play(g, w, db, rateTo(ROLES.glock.pc, pc)); };
  if (res === 'PERFECT') { put(beatLen / 4, r, 0); put(beatLen / 2, f, -2); }
  else if (res === 'GREAT') put(beatLen / 2, r, -3);
}
export function gagAt(songT) { play(AU.snd.gag, Clock.ctxOfSong(songT)); }
export function knockHiAt(songT) { play(AU.snd.claveHi, Clock.ctxOfSong(songT)); }
export function freeClap() { return play(AU.snd.clap, 0, -2); }   // 자유 손뼉: 곡 손뼉 낱소리, 곡 대비 −12dB
export function knockAt(songT, tones) {
  const pcs = chordPcs(tones || [60]); let best = pcs[0], bd = 99;
  for (const pc of pcs) { let d = ((pc - ROLES.clave.pc) % 12 + 12) % 12; if (d > 6) d = 12 - d; if (d < bd) { bd = d; best = pc; } }
  play(AU.snd.clave, Clock.ctxOfSong(songT), 0, rateTo(ROLES.clave.pc, best));
}
export function crowdAt(songT) { play(AU.snd.crowd, Clock.ctxOfSong(songT)); }
export function comboClapAt(songT) { play(AU.snd.clap, Clock.ctxOfSong(songT), -8); }

// ── 메뉴·결과 고리 음악(소리 검토 I4): 곡 조각을 잘라 끝 30ms를 앞과 교차해 고리로. ui 길(곡 길과 따로, 덕킹 아님)
export function loopStart(fromSec, toSec, db, delay) {
  loopStop();
  const F = AU.full; if (!F) return;
  const sr = F.sampleRate, a = Math.round(fromSec * sr), b = Math.round(toSec * sr), X = Math.round(0.03 * sr), N = b - a;
  const out = AU.ctx.createBuffer(F.numberOfChannels, N, sr);
  for (let c = 0; c < F.numberOfChannels; c++) {
    const s = F.getChannelData(c), o = out.getChannelData(c);
    o.set(s.subarray(a, b));
    for (let j = 0; j < X; j++) { const u = j / X; o[N - X + j] = s[a + N - X + j] * (1 - u) + s[a - X + j] * u; }
  }
  const src = AU.ctx.createBufferSource(); src.buffer = out; src.loop = true;
  const g = AU.ctx.createGain(); g.gain.value = 0; src.connect(g); g.connect(AU.uiBus);
  const t0 = AU.ctx.currentTime + (delay || 0.05);
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(dbl(db), t0 + 0.4);
  src.start(t0);
  AU.loops.push({ src, g });
}
export function loopStop() {
  for (const L of AU.loops) { try { const t = AU.ctx.currentTime; L.g.gain.cancelScheduledValues(t); L.g.gain.setValueAtTime(L.g.gain.value, t); L.g.gain.linearRampToValueAtTime(0, t + 0.15); L.src.stop(t + 0.2); } catch (e) { /* 이미 멈춤 */ } }
  AU.loops.length = 0;
}

// ── 시험: 폰 스피커 흉내(500Hz 4차 고역 통과, 50ms RMS)로 맞힘 소리 − 그 자리 곡(소리 검토 C1 ⑤) ─────────────────────────────
function hp500(x, sr) {
  const w = 2 * Math.PI * 500 / sr, cs = Math.cos(w), al = Math.sin(w) / (2 * 0.7071);
  const b0 = (1 + cs) / 2, b1 = -(1 + cs), b2 = (1 + cs) / 2, a0 = 1 + al, a1 = -2 * cs, a2 = 1 - al;
  let y = x;
  for (let pass = 0; pass < 2; pass++) {
    const o = new Float32Array(y.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < y.length; i++) { const v = (b0 * y[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = y[i]; y2 = y1; y1 = v; o[i] = v; }
    y = o;
  }
  return y;
}
function rmsDb(a, s, n) { let e = 0; for (let i = s; i < s + n && i < a.length; i++) e += a[i] * a[i]; return 10 * Math.log10(e / n + 1e-12); }
export function loudCheck(notes) {
  const F = AU.full, sr = F.sampleRate, n50 = Math.round(0.05 * sr), pre = Math.round(0.1 * sr);
  const hitDb = {};
  for (const k of ['L_PERFECT', 'L_GOOD', 'L_PERFECT_C', 'L_GOOD_C']) { const h = AU.hit[k]; if (!h) continue; const pad = new Float32Array(pre + h.length); pad.set(h.getChannelData(0), pre); hitDb[k] = rmsDb(hp500(pad, sr), pre, n50); }
  const out = [];
  for (const n of notes) {
    const s = Math.round(n.t * sr), seg = new Float32Array(pre + n50);
    const c0 = F.getChannelData(0), c1 = F.numberOfChannels > 1 ? F.getChannelData(1) : c0;
    for (let i = 0; i < seg.length; i++) seg[i] = (c0[s - pre + i] + c1[s - pre + i]) / 2;
    const song = rmsDb(hp500(seg, sr), pre, n50);
    const P = hitDb[n.crash ? 'L_PERFECT_C' : 'L_PERFECT'], G = hitDb[n.crash ? 'L_GOOD_C' : 'L_GOOD'];
    out.push({ id: n.id, songDb: +song.toFixed(1), perfDiff: +(P - song).toFixed(1), goodDiff: +(G - song).toFixed(1) });
  }
  const passP = out.filter(o => o.perfDiff >= -6).length / out.length, passG = out.filter(o => o.goodDiff >= -9).length / out.length;
  return { hitDb, passPerfect: +(passP * 100).toFixed(0), passGood: +(passG * 100).toFixed(0), notes: out };
}

// ── 글자 목소리(VOICEVOX:雨晴はう, 시험판 임시 → 출시판 원어민 녹음) ─────────────────────────────
// assets/voice/ch1/voice.json: 노트 id → 파일·권장 이득(곡 대비 RMS −12dB·꼭대기 −6dB·1~4kHz −10dB 안). 거르개 = 150Hz 고역 통과 + 2.5kHz −6dB(Q 0.7)
AU.voice = { buf: {}, notes: {}, ok: false };
export async function loadVoice(base) {
  const r = await fetch(base + 'voice.json'); if (!r.ok) return false;
  const vj = await r.json();
  for (const n of vj.notes) AU.voice.notes[n.id] = { file: n.file, gainDb: n.gainDb, type: n.type, holdMs: n.holdMs };
  const files = [...new Set(vj.notes.map(n => n.file))];
  await Promise.all(files.map(async f => {
    try {
      const raw = await fetchDecode(base + f), sr = raw.sampleRate;
      const oc = new (OAC())(1, raw.length, sr), s = oc.createBufferSource(); s.buffer = raw;
      const hp = oc.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 150; hp.Q.value = 0.7071;
      const pk = oc.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 2500; pk.gain.value = -6; pk.Q.value = 0.7;
      s.connect(hp); hp.connect(pk); pk.connect(oc.destination); s.start(0);
      AU.voice.buf[f] = await oc.startRendering();
    } catch (e) { console.warn('목소리 못 읽음', f, e); }
  }));
  AU.voice.ok = Object.keys(AU.voice.buf).length > 0;
  AU.stats.voiceFiles = Object.keys(AU.voice.buf).length;
  return AU.voice.ok;
}
// 맞힌 누름(노트 창 안)이면 누르는 즉시 함께 울림(원칙 3). 돌려준 핸들로 길게를 일찍 떼면 30ms 페이드
export function voiceNow(noteId) {
  const v = AU.voice.notes[noteId]; if (!v) return null;
  const b = AU.voice.buf[v.file]; if (!b) return null;
  const ctx = AU.ctx, s = ctx.createBufferSource(); s.buffer = b;
  const g = ctx.createGain(); g.gain.value = dbl(v.gainDb); s.connect(g); g.connect(AU.voiceBus); s.start(0);
  return { s, g };
}
export function voiceCut(h) { if (!h) return; try { const t = AU.ctx.currentTime; h.g.gain.cancelScheduledValues(t); h.g.gain.setValueAtTime(h.g.gain.value, t); h.g.gain.linearRampToValueAtTime(0, t + 0.03); h.s.stop(t + 0.04); } catch (e) { /* 이미 끝남 */ } }
// 시험: 노트마다 목소리(거르개·이득 적용) 꼭대기·RMS를 그 자리 곡과 비교 + 앞 무음
export function voiceCheck(notes) {
  const F = AU.full, sr = F.sampleRate, c0 = F.getChannelData(0), c1 = F.numberOfChannels > 1 ? F.getChannelData(1) : c0;
  const out = [];
  for (const n of notes) {
    const v = AU.voice.notes[n.id]; if (!v || !AU.voice.buf[v.file]) { out.push({ id: n.id, missing: true }); continue; }
    const d = AU.voice.buf[v.file].getChannelData(0), g = dbl(v.gainDb);
    let pk = 0, e = 0, lead = -1; for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i] * g); if (a > pk) pk = a; if (lead < 0 && Math.abs(d[i]) > dbl(-40)) lead = i; e += (d[i] * g) ** 2; }
    const L = d.length, s = Math.round(n.t * sr); let es = 0, sp = 0; for (let i = s; i < s + L && i < c0.length; i++) { const x = (c0[i] + c1[i]) / 2; es += x * x; sp = Math.max(sp, Math.abs(x)); }
    out.push({ id: n.id, peakRelSongDb: +(20 * Math.log10(pk / AU.peak)).toFixed(1), rmsRelSongDb: +(10 * Math.log10(e / (es + 1e-12))).toFixed(1), leadMs: +(lead / sr * 1000).toFixed(2) });
  }
  return out;
}