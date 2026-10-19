// chart.js · 채보 자료(data/ch1_chart.json, 0.3) + 곡 자료(data/song_ch1.json) → 한 판(곡 전체) 또는 연습 구간의 초 단위 시각표
// 시각 = 곡 지도 beatsMs(박마다 잰 시각)로 계산. 박 번호 = 2 + 4 × (마디 − 1) + (박 − 1), 소수 박은 앞뒤 박 사이를 나눔.
// 노트 한 줄 = '마디:박[@ms] 가나[#번호] [pill:끝 | hold:끝 (free|shutter|flick)] [ghost] [both]'. 가나 'R' = 오른손 박, '-' = 글자 없음.
export async function loadJSON(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error('자료 없음: ' + url + ' (' + r.status + ')');
  return r.json();
}

export function makeTime(song) {
  const B = song.beatsMs;
  const n = B.length;
  const avg = (B[n - 1] - B[0]) / (n - 1);
  function msOfPos(pos) {
    if (pos <= 0) return B[0] + pos * avg;
    if (pos >= n - 1) return B[n - 1] + (pos - (n - 1)) * avg;
    const i = Math.floor(pos), f = pos - i;
    return B[i] + (B[i + 1] - B[i]) * f;
  }
  // '마디:박' 또는 ms 숫자 → 초
  function t(spec) {
    if (typeof spec === 'number') return spec / 1000;
    const [a, b] = String(spec).split(':');
    return msOfPos(2 + 4 * (+a - 1) + (+b - 1)) / 1000;
  }
  // 초 → 박 위치(소수). 0 = 0마디 3박(첫 기록 박)
  function pos(sec) {
    const ms = sec * 1000;
    if (ms <= B[0]) return (ms - B[0]) / avg;
    if (ms >= B[n - 1]) return n - 1 + (ms - B[n - 1]) / avg;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (B[m] <= ms) lo = m; else hi = m; }
    return lo + (ms - B[lo]) / (B[hi] - B[lo]);
  }
  // 박 위치 → { bar, beat(1~4), phi(박 안 0~1), first(마디 첫 박?) }
  function beatInfo(sec) {
    const p = pos(sec), i = Math.floor(p), phi = p - i;
    const k = i - 2, bar = Math.floor(k / 4) + 1, beat = ((k % 4) + 4) % 4 + 1;
    return { p, i, phi, bar, beat, first: beat === 1, beatLen: (msOfPos(i + 1) - msOfPos(i)) / 1000 };
  }
  function timeOfPos(p) { return msOfPos(p) / 1000; }
  return { t, pos, beatInfo, timeOfPos, avgBeat: avg / 1000 };
}

// 그 시각의 화음 음(MIDI 배열)
export function makeChordAt(song) {
  const C = song.chords;
  return function chordAt(sec) {
    let c = null;
    for (const x of C) { if (x.t <= sec + 0.01) c = x; else break; }
    if (!c) return [60, 64, 67];
    if (c.half2 && sec + 0.01 >= c.half2.t) return c.half2.tones;
    return c.tones && c.tones.length ? c.tones : [60, 64, 67];
  };
}

function ghostsEcho(notes, ghosts) { const e = ghosts.map(g => g.t); for (const n of notes) if (n.tail) e.push(n.tail); return e.sort((a, b) => a - b); }
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; }
const info = (kanaTab, k) => kanaTab[k] || {};

function mkPhrase(p, tt, kanaTab) {
  return {
    id: p.id, kind: p.kind, word: p.word || null, mean: p.mean || null, all: !!p.all,
    kana: p.kana, at: p.at.map(tt), call0: tt(p.call[0]), call1: tt(p.call[1]), resp0: tt(p.resp[0]), resp1: tt(p.resp[1]),
    hitIdx: new Set(), ptr: 0, rot: (hash(p.id) - 0.5) * 4,
    snd: p.kana.map(k => info(kanaTab, k).ko || ''), ro: p.kana.map(k => info(kanaTab, k).ro || ''),
  };
}
// 노트 한 줄 읽기. tt = '마디:박' → 초(연습은 구간 되풀이 시각으로 바꿈), idp = id 앞붙이
function parseNote(str, tt, kanaTab, phrases, out, idp) {
  const parts = str.trim().split(/\s+/);
  const [pos, msPart] = parts[0].split('@');
  const t = msPart ? tt(+msPart, true) : tt(pos);
  let kTok = parts[1] || '-', fix = null;
  if (kTok.includes('#')) { const a = kTok.split('#'); kTok = a[0]; fix = +a[1]; }
  let type = 'tap', end = null, tail = null, release = null, ghost = false, both = false;
  for (const f of parts.slice(2)) {
    if (f.startsWith('pill:')) { type = 'pill'; tail = tt(f.slice(5)); }
    else if (f.startsWith('hold:')) { type = 'hold'; end = tt(f.slice(5)); }
    else if (f === 'ghost') ghost = true;
    else if (f === 'both') both = true;
    else if (f === 'free' || f === 'shutter' || f === 'flick') release = f;
  }
  if (type === 'hold' && !release) release = 'free';
  const isR = kTok === 'R', k = isR || kTok === '-' ? '' : kTok;
  const [bar, beat] = pos.split(':');
  const vid = bar + '-' + beat + (type === 'pill' ? 'p' : type === 'hold' ? 'h' : '');
  const kanaChars = Array.from(k);
  // 받는 마디 안이면 그 구절. 글자 번호 = 구절 가나 순서대로(#번호로 고정 가능), 다 쓰면 처음부터(いいえ 두 번)
  let ph = null, idx = [0];
  if (!isR && k) {
    for (const p of phrases) if (t >= p.resp0 - 0.02 && t < p.resp1) ph = p;
    if (ph) {
      let i0 = fix;
      if (i0 == null) {
        const find = from => { for (let i = from; i < ph.kana.length; i++) if (ph.kana[i] === kanaChars[0]) return i; return -1; };
        i0 = find(ph.ptr); if (i0 < 0) i0 = find(0); if (i0 < 0) i0 = 0;
      }
      idx = kanaChars.map((_, j) => Math.min(ph.kana.length - 1, i0 + j));
      ph.ptr = idx[idx.length - 1] + 1;
    }
  }
  const reveal = ph ? Math.min(...idx.map(i => ph.at[i])) : -1e9;
  const mk = (side, id) => ({
    id, vid, t, k: side === 'R' ? '' : k, kanaChars: side === 'R' ? [] : kanaChars, side, type: side === 'R' ? 'tap' : type,
    end: side === 'R' ? null : end, tail: side === 'R' ? null : tail, release: side === 'R' ? null : release,
    ph: side === 'R' ? null : ph, idx, reveal: side === 'R' ? -1e9 : reveal, crash: false, rot: (hash(id) - 0.5) * 6, noKana: side === 'L' && !k,
    snd: side === 'R' ? [] : kanaChars.map(c => info(kanaTab, c).ko || ''), ro: side === 'R' ? [] : kanaChars.map(c => info(kanaTab, c).ro || ''),
    judged: false, res: null, delta: null,
  });
  const base = (idp || '') + vid;
  if (isR && !both) { out.notes.push(mk('R', base + 'R')); return; }
  const n = mk('L', base);
  if (ghost) { n.ghost = true; out.ghosts.push(n); return; }
  out.notes.push(n);
  if (both) { const r = mk('R', base + 'R'); r.both = n; n.both = r; out.notes.push(r); }
}
// 낱말 묶음(같은 말 노트를 종이 띠로 이음): word 구절의 노트·보기 글자, 두 번 받는 구절은 시간 틈으로 나눔
function makeGroups(phrases, notes, ghosts, beat) {
  const groups = [];
  for (const ph of phrases) {
    if (ph.kind !== 'word') continue;
    const items = notes.concat(ghosts).filter(n => n.ph === ph && n.side === 'L').sort((a, b) => a.t - b.t);
    let cur = [];
    for (const it of items) {
      const last = cur[cur.length - 1];
      if (cur.length && it.t - (last.tail || last.end || last.t) > beat * 1.6) { groups.push(cur); cur = []; }
      cur.push(it);
    }
    if (cur.length) groups.push(cur);
  }
  for (const g of groups) for (const n of g) n.group = g;
  return groups;
}

// 곡 전체 한 판(난이도 level = easy · normal · hard)
export function buildRun(chart, song, kanaTab, level) {
  const T = makeTime(song), tt = s => T.t(s);
  const phrases = chart.phrases.map(p => mkPhrase(p, tt, kanaTab));
  const out = { notes: [], ghosts: [] };
  for (const s of chart.notes[level]) parseNote(s, (v, isMs) => isMs ? v / 1000 : T.t(v), kanaTab, phrases, out);
  const notes = out.notes.sort((a, b) => a.t - b.t || (a.side === 'L' ? -1 : 1)), ghosts = out.ghosts.sort((a, b) => a.t - b.t);
  const groups = makeGroups(phrases, notes, ghosts, T.avgBeat);
  const lyrics = chart.lyrics.map(l => ({ t0: T.t(l.at), t1: T.t(l.at) + l.durMs / 1000, text: l.text, jp: !!l.jp }));
  const knocks = chart.knocks.map(k => ({ t: T.t(k.at), hi: !!k.hi }));
  const free = (chart.free[level] || []).map(f => ({ t0: T.t(f.from), t1: T.t(f.to), at: f.at.map(tt) }));
  // 장면: t0 = 시작 박, f0 = 그 1박 전(종이 넘김 시작, 명세 2절)
  const scenes = chart.scenes.map(s => { const t0 = s.from === '1:1' ? -1 : T.t(s.from); return { id: s.id, t0, f0: t0 > 0 ? T.timeOfPos(T.pos(t0) - 1) : -2, bg: s.bg, cast: s.cast, lead: s.lead || s.cast[0], truck: !!s.truck, name: s.name }; });
  const from = T.t(chart.from), retryFrom = T.t(chart.retryFrom), hitAt = T.t(chart.hitAt);
  const lastNote = notes.length ? Math.max(...notes.map(n => n.end || n.t)) : hitAt;
  const LV = chart.levels[level];
  return {
    id: level, level, kind: 'run', name: LV.name, move: LV.move, letters: chart.letters, words: chart.words || [],
    from, retryFrom, hitAt, end: chart.end, lastNote,
    phrases, notes, ghosts, groups, lyrics, knocks, free, scenes, echoes: ghostsEcho(notes, ghosts), T,
    pass: Math.floor(notes.length / 2) + 1,
  };
}

// 연습 구간(명세 4절): 곡 [lead] 한 번 + [seg] × reps 를 이어 붙인 버퍼의 시각표. 박 번호 2 = 버퍼 0초(마디 첫 박)
export function buildPractice(chart, song, kanaTab, key) {
  const P = chart.practice[key], T0 = makeTime(song), B = song.beatsMs;
  const bi = spec => { const [a, b] = String(spec).split(':'); return 2 + 4 * (+a - 1) + (+b - 1); };
  const la = bi(P.lead[0]), lb = bi(P.lead[1]), sa = bi(P.seg[0]), sb = bi(P.seg[1]);
  const leadMs = B[lb] - B[la], segMs = B[sb] - B[sa];
  const beats = [];
  for (let i = la; i < lb; i++) beats.push(B[i] - B[la]);
  for (let r = 0; r < P.reps; r++) for (let i = sa; i < sb; i++) beats.push(leadMs + r * segMs + B[i] - B[sa]);
  beats.push(leadMs + P.reps * segMs);
  const pre = beats[1] - beats[0]; beats.unshift(-pre); beats.unshift(-2 * pre);
  const T = makeTime({ beatsMs: beats });
  const segA = B[sa] / 1000;
  const toRep = (songSec, r) => (leadMs + r * segMs) / 1000 + songSec - segA;
  const phrases = [], out = { notes: [], ghosts: [] }, knocks = [];
  for (let r = 0; r < P.reps; r++) {
    const tt = s => toRep(T0.t(s), r);
    const phs = chart.phrases.filter(p => P.phrases.includes(p.id)).map(p => { const o = mkPhrase(p, tt, kanaTab); o.id = p.id + '_' + r; return o; });
    phrases.push(...phs);
    for (const s of P.notes) parseNote(s, (v, isMs) => isMs ? toRep(v / 1000, r) : tt(v), kanaTab, phs, out, 'pr' + r + '_');
    for (const k of P.knocks || []) knocks.push({ t: tt(k.at), hi: !!k.hi });
  }
  const notes = out.notes.sort((a, b) => a.t - b.t), ghosts = out.ghosts.sort((a, b) => a.t - b.t);
  const groups = makeGroups(phrases, notes, ghosts, T.avgBeat);
  // 장면 = 그 구간이 속한 곡 장면
  let sc = chart.scenes[0]; for (const s of chart.scenes) if (T0.t(s.from) <= segA + 0.01) sc = s;
  const end = (leadMs + P.reps * segMs) / 1000;
  const repEnd = t => { const r = Math.floor((t * 1000 - leadMs) / segMs); return Math.min(end, (leadMs + (Math.max(0, r) + 1) * segMs) / 1000); };
  const songOf = t => { const ms = t * 1000; if (ms < leadMs) return B[la] / 1000 + t; return segA + ((ms - leadMs) % segMs) / 1000; };
  return {
    id: 'practice-' + key, kind: 'practice', key, line: P.line, icon: P.icon, need: P.need, count: P.count, name: '연습',
    letters: chart.letters, words: [], from: 0, retryFrom: 0, hitAt: end, end, lastNote: end,
    phrases, notes, ghosts, groups, lyrics: [], knocks, free: [], echoes: ghostsEcho(notes, ghosts), T,
    scenes: [{ id: sc.id, t0: -1, f0: -2, bg: sc.bg, cast: sc.cast, lead: sc.lead || sc.cast[0], truck: !!sc.truck, name: sc.name }],
    pieces: [[B[la] / 1000, B[lb] / 1000]].concat(Array.from({ length: P.reps }, () => [B[sa] / 1000, B[sb] / 1000])),
    repEnd, songOf, pass: 1,
  };
}
