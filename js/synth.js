// synth.js · 임시 소리 합성기 (진짜 곡·스템·목소리가 오기 전까지만 씀)
// 모든 악기는 (ctx, 출력, 시각, ...) 꼴. OfflineAudioContext에 미리 그려 AudioBuffer로 만들어 씀.
// 목소리는 모음 공명(포먼트) 합성: 톱니파 → 공명 필터 3개. 모음마다 정한 음(あ단 도 · い단 레 · う단 미 · え단 솔 · お단 라).

const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
export function freq(name, octave) { return 440 * Math.pow(2, (NOTE[name] + (octave - 4) * 12 - 9) / 12); }

export const CHORDS = {
  C: ['C', 'E', 'G'], Am: ['A', 'C', 'E'], F: ['F', 'A', 'C'], G: ['G', 'B', 'D'],
  Dm: ['D', 'F', 'A'], Em: ['E', 'G', 'B'],
};
export function chordRoot(ch) { return CHORDS[ch] ? CHORDS[ch][0] : 'C'; }
export function chordFifth(ch) { return CHORDS[ch] ? CHORDS[ch][2] : 'G'; }

// 모음 공명(Hz) · 일본어 남자 목소리 근사
const FORMANT = {
  a: [800, 1250, 2600], i: [300, 2250, 3000], u: [350, 1350, 2500],
  e: [480, 1900, 2650], o: [520, 900, 2600],
};

const noiseCache = new WeakMap();
function noise(ctx) {
  let b = noiseCache.get(ctx);
  if (!b) {
    const n = Math.floor(ctx.sampleRate * 1.0);
    b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < n; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; d[i] = seed / 0x3fffffff - 1; }
    noiseCache.set(ctx, b);
  }
  return b;
}
function noiseSrc(ctx, t, dur) {
  const s = ctx.createBufferSource(); s.buffer = noise(ctx); s.loop = true;
  s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  return s;
}
function env(ctx, t, peak, a, d, sustainLevel, hold, r) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  if (hold !== undefined) {
    g.gain.setTargetAtTime(peak * sustainLevel, t + a, d / 3);
    g.gain.setValueAtTime(peak * sustainLevel, t + a + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + r);
  } else {
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  return g;
}
function filt(ctx, type, f, q) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q !== undefined) b.Q.value = q; return b; }

// ── 북·타악 ───────────────────────────────
export function kick(ctx, out, t, vel = 1) {
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
  const g = env(ctx, t, 0.9 * vel, 0.002, 0.32);
  o.connect(g).connect(out); o.start(t); o.stop(t + 0.4);
  const n = noiseSrc(ctx, t, 0.01), hp = filt(ctx, 'highpass', 1800), ng = env(ctx, t, 0.25 * vel, 0.001, 0.012);
  n.connect(hp).connect(ng).connect(out);
}
export function tom(ctx, out, t, f = 110, vel = 1) {
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(f * 1.7, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.07);
  const g = env(ctx, t, 0.75 * vel, 0.002, 0.26);
  o.connect(g).connect(out); o.start(t); o.stop(t + 0.32);
  const n = noiseSrc(ctx, t, 0.02), bp = filt(ctx, 'bandpass', 900, 1.2), ng = env(ctx, t, 0.2 * vel, 0.001, 0.03);
  n.connect(bp).connect(ng).connect(out);
}
export function clap(ctx, out, t, vel = 1) {
  const n = noiseSrc(ctx, t, 0.25), bp = filt(ctx, 'bandpass', 1300, 1.1), hp = filt(ctx, 'highpass', 600);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
  for (let k = 0; k < 3; k++) { const tk = t + k * 0.011; g.gain.setValueAtTime(0.55 * vel, tk); g.gain.exponentialRampToValueAtTime(0.06 * vel, tk + 0.009); }
  g.gain.setValueAtTime(0.5 * vel, t + 0.034); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
  n.connect(bp).connect(hp).connect(g).connect(out);
}
export function hat(ctx, out, t, vel = 1, open = false) {
  const n = noiseSrc(ctx, t, open ? 0.25 : 0.06), hp = filt(ctx, 'highpass', 7500), g = env(ctx, t, 0.3 * vel, 0.001, open ? 0.22 : 0.04);
  n.connect(hp).connect(g).connect(out);
}
export function crunch(ctx, out, t, vel = 1) { // 눈 밟는 소리
  for (let k = 0; k < 3; k++) {
    const tk = t + k * 0.018 + Math.random() * 0.01;
    const n = noiseSrc(ctx, tk, 0.03), bp = filt(ctx, 'bandpass', 2600 + Math.random() * 1500, 1.5), g = env(ctx, tk, 0.3 * vel, 0.001, 0.025);
    n.connect(bp).connect(g).connect(out);
  }
}
export function crash(ctx, out, t, vel = 1) {
  const n = noiseSrc(ctx, t, 1.6), hp = filt(ctx, 'highpass', 4500), g = env(ctx, t, 0.35 * vel, 0.002, 1.4);
  n.connect(hp).connect(g).connect(out);
}
// 나무 딱따기(부름 끝 신호): 짧고 마른 '딱'
export function knock(ctx, out, t, vel = 1, pitch = 1) {
  const n = noiseSrc(ctx, t, 0.05), bp = filt(ctx, 'bandpass', 2400 * pitch, 7), g = env(ctx, t, 1.3 * vel, 0.0008, 0.045);
  n.connect(bp).connect(g).connect(out);
  for (const [f, a, d] of [[1750, 0.5, 0.06], [3150, 0.25, 0.03], [960, 0.18, 0.05]]) {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * pitch;
    const og = env(ctx, t, a * vel, 0.0008, d);
    o.connect(og).connect(out); o.start(t); o.stop(t + d + 0.05);
  }
}

// ── 음 있는 악기 ─────────────────────────────
export function bass(ctx, out, t, f, dur, vel = 1) {
  const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
  const s = ctx.createOscillator(); s.type = 'sine'; s.frequency.value = f;
  const lp = filt(ctx, 'lowpass', 900, 2); lp.frequency.setValueAtTime(1100, t); lp.frequency.exponentialRampToValueAtTime(320, t + dur);
  const g = env(ctx, t, 0.38 * vel, 0.004, 0.12, 0.6, Math.max(0.02, dur - 0.06), 0.05);
  const sg = env(ctx, t, 0.45 * vel, 0.004, 0.12, 0.7, Math.max(0.02, dur - 0.06), 0.05);
  o.connect(lp).connect(g).connect(out); s.connect(sg).connect(out);
  o.start(t); o.stop(t + dur + 0.1); s.start(t); s.stop(t + dur + 0.1);
}
export function epiano(ctx, out, t, freqs, dur, vel = 1) {
  for (const f of freqs) {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f * 2;
    const g = env(ctx, t, 0.16 * vel, 0.005, 0.35, 0.35, Math.max(0.02, dur - 0.05), 0.12);
    const g2 = env(ctx, t, 0.035 * vel, 0.003, 0.12);
    o.connect(g).connect(out); o2.connect(g2).connect(out);
    o.start(t); o.stop(t + dur + 0.2); o2.start(t); o2.stop(t + 0.2);
  }
}
export function glock(ctx, out, t, f, vel = 1) {
  for (const [m, a, d] of [[1, 0.32, 1.1], [2.76, 0.1, 0.35], [5.4, 0.05, 0.12]]) {
    if (f * m > ctx.sampleRate * 0.45) continue;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * m;
    const g = env(ctx, t, a * vel, 0.001, d);
    o.connect(g).connect(out); o.start(t); o.stop(t + d + 0.05);
  }
}

// ── 목소리(모음 공명 합성) ─────────────────────────
// opt: { v:'a'|'i'|'u'|'e'|'o', c:''|'k'|'s'|'sh'|'m'|'n'|'y', f, dur, vel, crowd, mega, fShift, vib }
// 모음이 시각 t에 정확히 시작함(자음은 그 앞에 붙음) → 노트 시각 = 실제 소리 자리(원칙 1)
export function voice(ctx, out, t, opt) {
  const v = opt.v || 'a', f = opt.f, dur = opt.dur || 0.36, vel = opt.vel === undefined ? 1 : opt.vel;
  const shift = opt.fShift || 1;
  const F = FORMANT[v].map(x => x * shift);
  const mix = ctx.createGain(); mix.gain.value = 1;
  const srcs = [];
  const det = opt.crowd ? [[1, 0], [1, 9], [1, -8], [0.5, 4], [0.5, -5]] : [[1, 0]];
  for (const [mul, cents] of det) {
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.value = f * mul; o.detune.value = cents;
    if (opt.vib !== false && !opt.crowd && dur > 0.3) {
      const l = ctx.createOscillator(); l.frequency.value = 5.5;
      const lg = ctx.createGain(); lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * 0.006, t + dur * 0.8);
      l.connect(lg).connect(o.frequency); l.start(t); l.stop(t + dur + 0.1);
    }
    const og = ctx.createGain(); og.gain.value = (opt.crowd ? 0.3 : 1) * (mul < 1 ? 0.8 : 1);
    o.connect(og).connect(mix); o.start(Math.max(0, t - 0.002)); o.stop(t + dur + 0.12); srcs.push(o);
  }
  // 숨소리 조금(떼창만)
  if (opt.crowd) {
    const n = noiseSrc(ctx, t, dur + 0.1), ng = ctx.createGain(); ng.gain.value = 0.05;
    n.connect(ng).connect(mix);
  }
  const sum = ctx.createGain(); sum.gain.value = 1;
  const amps = [1.0, 0.62, 0.22], qs = [6, 9, 11];
  const bands = [];
  for (let i = 0; i < 3; i++) {
    const bp = filt(ctx, 'bandpass', F[i], qs[i]);
    const bg = ctx.createGain(); bg.gain.value = amps[i] * 3.2;
    mix.connect(bp).connect(bg).connect(sum); bands.push(bp);
  }
  // や: い → あ 미끄러짐
  if (opt.c === 'y') {
    const Fi = FORMANT.i.map(x => x * shift);
    for (let i = 0; i < 3; i++) { bands[i].frequency.setValueAtTime(Fi[i], t); bands[i].frequency.linearRampToValueAtTime(F[i], t + 0.07); }
  }
  const g = env(ctx, t, 0.5 * vel, 0.018, 0.1, 0.85, Math.max(0.03, dur - 0.08), 0.07);
  let tail = sum;
  if (opt.mega) { // 확성기: 좁은 대역 + 살짝 찌그러짐
    const hp = filt(ctx, 'highpass', 450, 0.7), lp = filt(ctx, 'lowpass', 3300, 0.9);
    const ws = ctx.createWaveShaper(); ws.curve = shaper(2.2); ws.oversample = '2x';
    const pre = ctx.createGain(); pre.gain.value = 1.4;
    sum.connect(hp).connect(pre).connect(ws).connect(lp); tail = lp;
  }
  tail.connect(g).connect(out);
  // 자음
  const c = opt.c || '';
  // 자음은 모음 앞에 붙되 0초보다 앞으로 나가지 않게
  if (c === 'k') {
    const tk = Math.max(0, t - 0.03), n = noiseSrc(ctx, tk, 0.03), bp = filt(ctx, 'bandpass', v === 'i' || v === 'e' ? 2800 : 1700, 1.4), ng = env(ctx, tk, 0.55 * vel, 0.001, 0.025);
    n.connect(bp).connect(ng).connect(out);
  } else if (c === 's' || c === 'sh') {
    const ts = Math.max(0, t - 0.09), n = noiseSrc(ctx, ts, 0.1), f2 = c === 'sh' ? filt(ctx, 'bandpass', 3200, 1.2) : filt(ctx, 'highpass', 4800, 0.8);
    const ng = env(ctx, ts, 0.32 * vel, 0.02, 0.05, 0.9, 0.05, 0.02);
    n.connect(f2).connect(ng).connect(out);
  } else if (c === 'm' || c === 'n') {
    const tm = Math.max(0, t - 0.06), o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f * 2;
    const lp = filt(ctx, 'lowpass', c === 'm' ? 380 : 520, 1), ng = env(ctx, tm, 0.35 * vel, 0.01, 0.04, 0.9, 0.035, 0.015);
    o.connect(lp); o2.connect(lp); lp.connect(ng).connect(out);
    o.start(tm); o.stop(t + 0.02); o2.start(tm); o2.stop(t + 0.02);
  }
}
const shaperCache = {};
function shaper(k) {
  if (shaperCache[k]) return shaperCache[k];
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
  return (shaperCache[k] = c);
}

// ── 장식·개그 재료 ─────────────────────────────
// 반짝 꼬리: 종 소리를 그린 뒤 5kHz 아래를 깎아 반짝이는 부분만 남김(노래 대역을 가리지 않음)
export function sparkle(ctx, out, t, f, vel = 1) {
  const hp = filt(ctx, 'highpass', 5000, 0.7); hp.connect(out);
  for (const [m, a, d] of [[1, 0.5, 0.5], [2.76, 0.35, 0.25], [5.4, 0.3, 0.12], [8.9, 0.2, 0.06]]) {
    if (f * m > ctx.sampleRate * 0.45) continue;   // 재생 한계(표본률의 절반) 위 배음은 뺌
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * m;
    const g = env(ctx, t, a * vel, 0.001, d);
    o.connect(g).connect(hp); o.start(t); o.stop(t + d + 0.05);
  }
  const n = noiseSrc(ctx, t, 0.02), nh = filt(ctx, 'highpass', 8000), ng = env(ctx, t, 0.25 * vel, 0.001, 0.015);
  n.connect(nh).connect(ng).connect(out);
}
// 바닥 울림: 그 마디 화음 밑음 짧은 '퉁'(800Hz 아래만)
export function thump(ctx, out, t, f, vel = 1) {
  const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
  const lp = filt(ctx, 'lowpass', 700, 0.7), g = env(ctx, t, 0.8 * vel, 0.004, 0.22);
  o.connect(lp).connect(g).connect(out); o.start(t); o.stop(t + 0.3);
}
// 어택: 종이 '탁' 고역(5kHz 위만, 20ms 이하)
export function paperTick(ctx, out, t, vel = 1, hpF = 5000) {
  const n = noiseSrc(ctx, t, 0.02), hp = filt(ctx, 'highpass', hpF, 0.8), pk = filt(ctx, 'peaking', 7000, 1.5); pk.gain.value = 6;
  const g = env(ctx, t, 0.9 * vel, 0.0005, 0.016);
  n.connect(hp).connect(pk).connect(g).connect(out);
}
// MISS 개그(판 1): 빙판에서 미끄러지는 '쭉' + 털썩(500Hz 아래 위주) + 모래 '사락'(아주 작게)
export function gagSlip(ctx, out, t, vel = 1) {
  const n = noiseSrc(ctx, t, 0.35), lp = filt(ctx, 'lowpass', 600, 4);
  lp.frequency.setValueAtTime(520, t); lp.frequency.exponentialRampToValueAtTime(140, t + 0.22);
  const g = env(ctx, t, 0.5 * vel, 0.01, 0.2, 0.8, 0.12, 0.08);
  n.connect(lp).connect(g).connect(out);
  const tt = t + 0.24, o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(110, tt); o.frequency.exponentialRampToValueAtTime(42, tt + 0.12);
  const og = env(ctx, tt, 0.9 * vel, 0.003, 0.22); o.connect(og).connect(out); o.start(tt); o.stop(tt + 0.3);
  const n2 = noiseSrc(ctx, tt, 0.06), lp2 = filt(ctx, 'lowpass', 400), g2 = env(ctx, tt, 0.4 * vel, 0.002, 0.06);
  n2.connect(lp2).connect(g2).connect(out);
  const ts = t + 0.36, n3 = noiseSrc(ctx, ts, 0.2), hp3 = filt(ctx, 'highpass', 6000), g3 = env(ctx, ts, 0.06 * vel, 0.03, 0.15);
  n3.connect(hp3).connect(g3).connect(out);
}

// ── 오프라인으로 그려 AudioBuffer 만들기 ─────────────────
export async function renderBuffer(sampleRate, seconds, draw, channels = 2) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const len = Math.ceil(seconds * sampleRate);
  const off = new OAC(channels, len, sampleRate);
  const out = off.createGain(); out.connect(off.destination);
  draw(off, out);
  const buf = await off.startRendering();
  return buf;
}
export function peakOf(buf) {
  let p = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) { const a = d[i] < 0 ? -d[i] : d[i]; if (a > p) p = a; }
  }
  return p;
}
export function normalize(buf, target) {
  const p = peakOf(buf);
  if (p <= 0) return 0;
  const k = target / p;
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= k; }
  return k;
}
