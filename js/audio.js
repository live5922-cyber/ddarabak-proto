// audio.js · 곡 길·효과음 길, 임시 반주 그리기, 치는 소리 층
// 지킬 것(CLAUDE.md 원칙 3·4):
//   - 치는 소리(몸통·어택·글자 목소리)는 누른 즉시 start(0). 미리 예약하지 않음.
//   - 꼬리(반짝·바닥 울림)는 판정이 정해진 뒤 '노트 시각 + 1/16박·1/8박'에 붙는 장식.
//   - 곡 길(bus.song)은 크기·필터·압축을 절대 바꾸지 않음(덕킹 금지). 효과음 길에만 크기 단계.
//   - 효과음 묶음 꼭대기는 곡 꼭대기보다 6dB 이상 작게('크게'에서도). 미리 그려 재고 자동으로 줄임.
import * as S from './synth.js';
import { getCtx, ctxOfSong, transport } from './clock.js';
import { settings } from './settings.js';

export const bus = { song: null, combo: null, fx: null };
export const bank = {};
export const level = { songPeak: 0.8, fxTrim: 1, perfectPeakDb: 0, loudPeakDb: 0 };
const SONG_TARGET = 0.8;          // 곡 꼭대기(합성 반주를 이 크기로 맞춤)
const SFX_STEP = { low: -4, mid: 0, high: 4 };

const dB = x => Math.pow(10, x / 20);

export function setupBuses() {
  const ctx = getCtx();
  bus.song = ctx.createGain(); bus.song.gain.value = 1; bus.song.connect(ctx.destination);
  bus.combo = ctx.createGain(); bus.combo.gain.value = 0; bus.combo.connect(ctx.destination);
  bus.fx = ctx.createGain(); bus.fx.connect(ctx.destination);
  applySfxLevel();
}
export function applySfxLevel() {
  if (bus.fx) bus.fx.gain.value = dB(SFX_STEP[settings.sfx] || 0);
}
// 곡 꼭대기 대비 dB → 효과음 버퍼(꼭대기 1)에 곱할 값
function lin(db) { return level.songPeak * dB(db) * level.fxTrim; }

// ── 임시 반주 ─────────────────────────────
// 밑음 위로 쌓은 자리바꿈(밑음보다 낮은 음은 한 옥타브 올림)
function chordFreqs(name, oct) {
  const tones = S.CHORDS[name] || S.CHORDS.C;
  const r = S.freq(tones[0], oct);
  return tones.map(n => { let f = S.freq(n, oct); while (f < r) f *= 2; return f; });
}

// 반주 사건 목록: at(시각, (ctx, 길, 그 조각 안 시각) => 악기)
function backingEvents(ch) {
  const T = ch.timeOf, VP = ch.vowelPitch;
  const ev = [];
  const at = (t, fn) => ev.push({ t, fn });
  const respBars = new Set(ch.notes.map(n => n.bar));

  for (let bar = 1; bar <= ch.song.bars; bar++) {
    const chord = ch.chords[bar - 1] || 'C';
    const root = S.chordRoot(chord), fifth = S.chordFifth(chord);
    const intro = bar <= 4;
    const cf = chordFreqs(chord, 4);
    // 건반: 전주는 길게, 그 뒤는 통통 튀는 엇박 찍기
    if (intro) at(T(bar, 1), (c, B, t) => S.epiano(c, B.music, t, cf, ch.bar * 0.95, 0.55));
    else {
      at(T(bar, 1), (c, B, t) => S.epiano(c, B.music, t, cf, 0.32, 0.5));
      at(T(bar, 2.5), (c, B, t) => S.epiano(c, B.music, t, cf, 0.18, 0.42));
      at(T(bar, 4.5), (c, B, t) => S.epiano(c, B.music, t, cf, 0.18, 0.42));
    }
    // 베이스
    if (bar >= 3) {
      at(T(bar, 1), (c, B, t) => S.bass(c, B.music, t, S.freq(root, 2), 0.42, 0.9));
      at(T(bar, 2.5), (c, B, t) => S.bass(c, B.music, t, S.freq(root, 3), 0.2, 0.6));
      at(T(bar, 3), (c, B, t) => S.bass(c, B.music, t, S.freq(fifth, 2), 0.42, 0.85));
      at(T(bar, 4.5), (c, B, t) => S.bass(c, B.music, t, S.freq(root, 3), 0.2, 0.6));
    }
    // 북
    if (intro) {
      at(T(bar, 2), (c, B, t) => S.clap(c, B.drums, t, 0.4)); at(T(bar, 4), (c, B, t) => S.clap(c, B.drums, t, 0.4));
      for (let e = 0; e < 8; e++) at(T(bar, 1 + e * 0.5), (c, B, t) => S.crunch(c, B.drums, t, e % 2 ? 0.25 : 0.4));
      if (bar >= 3) at(T(bar, 1), (c, B, t) => S.kick(c, B.drums, t, 0.55));
    } else {
      at(T(bar, 1), (c, B, t) => S.kick(c, B.drums, t, 0.95)); at(T(bar, 3), (c, B, t) => S.kick(c, B.drums, t, 0.85));
      at(T(bar, 2.5), (c, B, t) => S.kick(c, B.drums, t, 0.3));
      at(T(bar, 2), (c, B, t) => S.clap(c, B.drums, t, 0.55)); at(T(bar, 4), (c, B, t) => S.clap(c, B.drums, t, 0.55));
      for (let e = 0; e < 8; e++) at(T(bar, 1 + e * 0.5), (c, B, t) => S.hat(c, B.drums, t, e % 2 ? 0.18 : 0.28));
      // 받는 마디 4박 '쿵'(판 1·2는 노트 없는 쉼 자리, 판 3부터 오른쪽 노트)
      if (respBars.has(bar) && !ch.hits.some(h => h.t === T(bar, 4))) at(T(bar, 4), (c, B, t) => S.tom(c, B.drums, t, 98, 0.55));
    }
    // 글로켄: 전주 2·4마디 오르는 꾸밈
    if (bar === 2 || bar === 4) {
      const tones = (S.CHORDS[chord] || S.CHORDS.C);
      tones.concat([tones[0]]).forEach((n, i) => at(T(bar, 1 + i), (c, B, t) => S.glock(c, B.music, t, S.freq(n, i === 3 ? 7 : 6), 0.45)));
    }
  }
  // 한국어 줄 자리(5~6마디)는 글로켄 가락으로 메움(목소리 없음, 화면에 가사)
  const mel = [[5, 1, 'E'], [5, 2, 'G'], [5, 3, 'A'], [5, 4, 'G'], [6, 1, 'E'], [6, 2, 'D'], [6, 3, 'C'], [6, 4.5, 'D']];
  for (const [bar, b, n] of mel) if (bar <= ch.song.bars) at(T(bar, b), (c, B, t) => S.glock(c, B.music, t, S.freq(n, 6), 0.5));

  // 아저씨: 전주 확성기 부름 + せーの (듣기만 하는 줄)
  for (const l of ch.listen) {
    const mega = l.cue !== 'seino';
    for (const s of l.sing) {
      at(s.t, (c, B, t) => S.voice(c, B.vox, t, { v: s.info.v, c: s.info.c, f: S.freq(VP[s.info.v], 3), dur: Math.max(0.2, s.len * (mega ? 0.92 : 0.8)), vel: mega ? 0.85 : 0.9, mega, fShift: 1 }));
    }
  }
  // 아저씨 부름(한 박에 한 글자, 또박또박) + 끝 신호 딱따기 두 번
  for (const cl of ch.calls) {
    for (const s of cl.syl) at(s.t, (c, B, t) => S.voice(c, B.vox, t, { v: s.info.v, c: s.info.c, f: S.freq(VP[s.info.v], 3), dur: 0.36, vel: 1, fShift: 1 }));
    if (cl.end === 'knock') { at(T(cl.bar, 4), (c, B, t) => S.knock(c, B.drums, t, 1)); at(T(cl.bar, 4.5), (c, B, t) => S.knock(c, B.drums, t, 0.95)); }
  }
  // 떼창: 받는 마디에서 같은 글자를 같은 칸·같은 음으로 → 노트가 놓인 자리 = 실제로 소리 나는 자리(원칙 1)
  for (const n of ch.notes) {
    if (n.btn !== 'L') continue;
    at(n.t, (c, B, t) => S.voice(c, B.vox, t, { v: n.info.v, c: n.info.c, f: S.freq(VP[n.info.v], 4), dur: 0.36, vel: 0.9, crowd: true, fShift: 1.1 }));
  }
  // 장면 닫는 한 방
  for (const h of ch.hits) {
    at(h.t, (c, B, t) => {
      S.kick(c, B.drums, t, 1); S.crash(c, B.drums, t, 0.9); S.tom(c, B.drums, t, 82, 0.8);
      S.epiano(c, B.music, t, chordFreqs('C', 4).concat([S.freq('C', 5)]), 0.9, 0.9);
      S.glock(c, B.music, t, S.freq('C', 7), 0.6);
    });
  }
  return ev;
}
function backingBus(c, out) {
  const mk = v => { const g = c.createGain(); g.gain.value = v; g.connect(out); return g; };
  return { drums: mk(0.8), music: mk(0.75), vox: mk(1.15) };
}

// 콤보 10에 여는 층: 손뼉 더하기 + 마디 첫 박 글로켄. 곡과 같은 길이로 처음부터 소리 0으로 같이 돎
function comboEvents(ch) {
  const T = ch.timeOf, ev = [];
  const at = (t, fn) => ev.push({ t, fn });
  for (let bar = 5; bar <= ch.song.bars; bar++) {
    at(T(bar, 2), (c, B, t) => S.clap(c, B.out, t, 0.6)); at(T(bar, 4), (c, B, t) => S.clap(c, B.out, t, 0.6));
    at(T(bar, 4.5), (c, B, t) => S.clap(c, B.out, t, 0.45));
    const r = S.chordRoot(ch.chords[bar - 1] || 'C');
    at(T(bar, 1), (c, B, t) => S.glock(c, B.out, t, S.freq(r, 6), 0.5));
  }
  return ev;
}

// 4초 조각마다 따로(동시에) 그려 합침. 한 번에 그리면 모든 악기 마디가 곡 끝까지 계산돼 느림(5초 → 조각 그리기)
async function renderSegmented(sr, total, events, makeBus, channels) {
  const SEG = 4, PRE = 0.15, TAIL = 1.8;
  const out = getCtx().createBuffer(channels, Math.ceil(total * sr), sr);
  const jobs = [];
  for (let s = 0; s < total; s += SEG) {
    const evs = events.filter(e => e.t >= s && e.t < s + SEG);
    if (!evs.length) continue;
    const start = Math.max(0, s - PRE);
    const len = Math.min(total - start, s + SEG + TAIL - start);
    jobs.push(S.renderBuffer(sr, len, (c, o) => { const B = makeBus(c, o); for (const e of evs) e.fn(c, B, e.t - start); }, channels)
      .then(buf => ({ buf, start })));
  }
  const parts = await Promise.all(jobs);
  for (const { buf, start } of parts) {
    const o = Math.round(start * sr);
    for (let c = 0; c < channels; c++) {
      const d = out.getChannelData(c), p = buf.getChannelData(Math.min(c, buf.numberOfChannels - 1));
      const n = Math.min(p.length, d.length - o);
      for (let i = 0; i < n; i++) d[o + i] += p[i];
    }
  }
  return out;
}

// 곡 버퍼 만들기: 파일이 있으면 파일, 없으면 합성
export async function makeSong(ch, baseUrl) {
  const ctx = getCtx();
  const sr = ctx.sampleRate;
  const len = ch.end + (ch.song.tail || 1.2) + 0.3;
  let song = null, combo = null, source = 'synth';
  if (ch.song.kind === 'file' && ch.song.file) {
    try {
      const r = await fetch(new URL(ch.song.file, baseUrl), { cache: 'no-store' });
      if (r.ok) { song = await ctx.decodeAudioData(await r.arrayBuffer()); source = 'file'; }
    } catch (e) { console.warn('곡 파일을 못 읽어 임시 반주로 돎', e); }
  }
  if (source === 'synth') {
    // 임시 반주 + 콤보 반주 층(합성)
    const [synthSong, comboBuf] = await Promise.all([
      renderSegmented(sr, len, backingEvents(ch), backingBus, 2),
      renderSegmented(sr, len, comboEvents(ch), (c, o) => ({ out: o }), 1),
    ]);
    song = synthSong; combo = comboBuf;
    S.normalize(song, SONG_TARGET); level.songPeak = SONG_TARGET;
    S.normalize(combo, level.songPeak * dB(-14));
  } else {
    // 진짜 곡: 크기는 건드리지 않고 재기만 함. 콤보 층은 따로 준 파일(스템으로 만든 것)이 있을 때만
    level.songPeak = S.peakOf(song);
    if (ch.song.combo_layer_file) {
      try {
        const r = await fetch(new URL(ch.song.combo_layer_file, baseUrl), { cache: 'no-store' });
        if (r.ok) combo = await ctx.decodeAudioData(await r.arrayBuffer());
      } catch (e) { console.warn('콤보 층 파일 없음', e); }
    }
  }
  return { song, combo, source };
}

// ── 효과음 재료(미리 그림, 꼭대기 1로 맞춤) ───────────────
async function one(name, seconds, draw, ch = 1) {
  const b = await S.renderBuffer(getCtx().sampleRate, seconds, draw, ch);
  S.normalize(b, 1);
  bank[name] = b;
}
export async function makeBank(ch) {
  const VP = ch.vowelPitch;
  const jobs = [];
  // ① 몸통: 왼쪽 낮은 북, 오른쪽 높은 타악(반주 북과 같은 음색)
  jobs.push(one('bodyL', 0.4, (c, o) => { S.tom(c, o, 0, 104, 1); S.kick(c, o, 0, 0.55); }));
  jobs.push(one('bodyR', 0.35, (c, o) => { S.tom(c, o, 0, 196, 0.8); S.clap(c, o, 0, 0.7); }));
  // 빈 터치: 몸통 음색의 고역만
  jobs.push(one('emptyL', 0.2, (c, o) => { const h = c.createBiquadFilter(); h.type = 'highpass'; h.frequency.value = 3000; h.connect(o); S.tom(c, h, 0, 104, 1); S.paperTick(c, h, 0, 0.6); }));
  jobs.push(one('emptyR', 0.2, (c, o) => { const h = c.createBiquadFilter(); h.type = 'highpass'; h.frequency.value = 3000; h.connect(o); S.clap(c, h, 0, 1); }));
  // ② 어택: 종이 '탁' 5kHz 위
  jobs.push(one('attack', 0.05, (c, o) => S.paperTick(c, o, 0, 1)));
  jobs.push(one('missTick', 0.05, (c, o) => S.paperTick(c, o, 0, 0.7, 6000)));
  // ③ 글자 목소리: 떼창과 같은 음(모음 = 음), 짧게. 자음이 있으면 자음부터 바로 시작
  const ks = new Set(ch.notes.map(n => n.k));
  for (const k of ks) {
    const inf = ch.info(k);
    const pre = inf.c === 'k' ? 0.03 : (inf.c === 's' || inf.c === 'sh') ? 0.09 : (inf.c === 'm' || inf.c === 'n') ? 0.06 : 0.002;
    jobs.push(one('v_' + k, 0.32, (c, o) => S.voice(c, o, pre, { v: inf.v, c: inf.c, f: S.freq(VP[inf.v], 4), dur: 0.2, vel: 1, fShift: 1.15, vib: false })));
  }
  // ④ 반짝 꼬리(음마다), ⑤ 바닥 울림(밑음마다)
  for (const n of ['C', 'D', 'E', 'F', 'G', 'A', 'B']) {
    jobs.push(one('spk_' + n, 0.55, (c, o) => S.sparkle(c, o, 0, S.freq(n, 8), 1)));
    jobs.push(one('thm_' + n, 0.3, (c, o) => S.thump(c, o, 0, S.freq(n, 3), 1)));
  }
  // MISS 개그(판 1: 미끄러짐 + 털썩)
  jobs.push(one('gag', 0.6, (c, o) => S.gagSlip(c, o, 0, 1)));
  // 지연 보정 메트로놈
  jobs.push(one('metro', 0.12, (c, o) => S.knock(c, o, 0, 1, 1)));
  jobs.push(one('metroHi', 0.12, (c, o) => S.knock(c, o, 0, 1, 1.35)));
  await Promise.all(jobs);
  await measureTrim(ch);
}

// '크게'에서 PERFECT 몸통 + 어택 + 가장 큰 목소리를 겹친 꼭대기가 곡 −6dB를 넘으면 효과음 길 전체를 줄임
async function measureTrim(ch) {
  const ks = Array.from(new Set(ch.notes.map(n => n.k)));
  let worst = 0;
  for (const side of ['bodyL', 'bodyR']) {
    for (const k of ks.length ? ks : [null]) {
      const b = await S.renderBuffer(getCtx().sampleRate, 0.45, (c, o) => {
        const add = (buf, g) => { if (!buf) return; const s = c.createBufferSource(); s.buffer = buf; const gg = c.createGain(); gg.gain.value = g; s.connect(gg).connect(o); s.start(0); };
        const loud = dB(SFX_STEP.high);
        add(bank[side], level.songPeak * dB(-10) * loud);
        add(bank.attack, level.songPeak * dB(-16) * loud);
        if (k && side === 'bodyL') add(bank['v_' + k], level.songPeak * dB(-10) * loud);
      }, 1);
      worst = Math.max(worst, S.peakOf(b));
    }
  }
  const limit = level.songPeak * dB(-6);
  level.fxTrim = worst > limit ? limit / worst : 1;
  level.loudPeakDb = 20 * Math.log10((worst * level.fxTrim) / level.songPeak);
  level.perfectPeakDb = level.loudPeakDb - SFX_STEP.high;
}

// ── 재생 ─────────────────────────────────
function play(name, when, gain, filterHz) {
  const ctx = getCtx(), b = bank[name];
  if (!b || gain <= 0) return null;
  const s = ctx.createBufferSource(); s.buffer = b;
  const g = ctx.createGain(); g.gain.value = gain;
  if (filterHz) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filterHz; s.connect(f).connect(g); }
  else s.connect(g);
  g.connect(bus.fx);
  s.start(when);
  return s;
}

// 판정별 층(기획안 v0.5 6절 표). side 'L'|'R', res 'PERFECT'|'GREAT'|'GOOD'|'MISS'|'EMPTY'
export function hitNow(side, res, kana) {
  const body = side === 'R' ? 'bodyR' : 'bodyL';
  const voiced = side === 'L' && kana && bank['v_' + kana];
  switch (res) {
    case 'PERFECT':
      play(body, 0, lin(-10)); play('attack', 0, lin(-16)); if (voiced) play('v_' + kana, 0, lin(-10)); break;
    case 'GREAT':
      play(body, 0, lin(-12)); play('attack', 0, lin(-22)); if (voiced) play('v_' + kana, 0, lin(-12)); break;
    case 'GOOD':
      play(body, 0, lin(-15), 2600); if (voiced) play('v_' + kana, 0, lin(-16), 3000); break;
    case 'MISS':
      play('missTick', 0, lin(-18)); break;
    default:
      play(side === 'R' ? 'emptyR' : 'emptyL', 0, lin(-30));
  }
}

// 꼬리: 노트 시각 기준. 누른 뒤 40ms 안에 울릴 꼬리는 뺌. 같은 1/16 칸 중복은 하나만.
const tailSlots = new Set();
export function resetTails() { tailSlots.clear(); }
export function tails(res, noteT, ch) {
  if (res !== 'PERFECT' && res !== 'GREAT') return;
  const ctx = getCtx(), now = ctx.currentTime;
  const chord = ch.chordAt(noteT), root = S.chordRoot(chord), fifth = S.chordFifth(chord);
  const q = ch.beat / 4, e = ch.beat / 2;
  const put = (name, songT, g) => {
    const when = ctxOfSong(songT);
    if (when - now < 0.04) return;
    const slot = Math.round(songT / q) + ':' + name.slice(0, 3);
    if (tailSlots.has(slot)) return;
    tailSlots.add(slot);
    play(name, when, g);
  };
  if (res === 'PERFECT') {
    put('spk_' + root, noteT + q, lin(-20));
    put('thm_' + root, noteT + q, lin(-22));
    put('spk_' + fifth, noteT + e, lin(-20));
  } else {
    put('spk_' + root, noteT + e, lin(-20));
  }
}

// MISS 개그: 다음 박에. 곡 대비 −14dB(규칙 −12dB 이하)
export function gagAt(songT) { play('gag', ctxOfSong(songT), lin(-14)); }

// 콤보 반주 층: 다음 마디 첫 박에 10ms로 엶 / 1박 동안 닫음
export function comboLayer(open, songT, beat) {
  const g = bus.combo.gain, when = ctxOfSong(songT);
  g.cancelScheduledValues(when);
  g.setValueAtTime(open ? 0 : 1, when);
  g.linearRampToValueAtTime(open ? 1 : 0, when + (open ? 0.01 : beat));
}
export function comboReset() { const g = bus.combo.gain; g.cancelScheduledValues(0); g.value = 0; }

export function metro(when, hi) { play(hi ? 'metroHi' : 'metro', when, lin(-8)); }
