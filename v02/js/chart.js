// chart.js · 채보 자료(data/ch1_chart.json) + 곡 자료(data/song_ch1.json) → 판 하나의 초 단위 시각표
// 시각 = 곡 지도 beatsMs(박마다 잰 시각)로 계산. 박 번호 = 2 + 4 × (마디 − 1) + (박 − 1), 소수 박은 앞뒤 박 사이를 나눔.
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

export function buildPan(chart, song, kanaTab, panId) {
  const T = makeTime(song);
  const P = chart.pans[panId];
  const pid = +panId;
  const has = arr => !arr || arr.includes(pid);
  const pre = new Set(P.preprint || []);
  const phrases = chart.phrases.filter(p => has(p.pans)).map(p => ({
    id: p.id, kind: p.kind, word: p.word || null, mean: p.mean || null, heard: p.heard || null, twice: !!p.twice,
    kana: p.kana, at: p.at.map(T.t), call0: T.t(p.call[0]), call1: T.t(p.call[1]), resp0: T.t(p.resp[0]), resp1: T.t(p.resp[1]),
    preprint: pre.has(p.id), hitIdx: new Set(),
    snd: p.kana.map(k => (kanaTab[k] || {}).ko || ''), ro: p.kana.map(k => (kanaTab[k] || {}).ro || ''),
  }));
  const phById = {}; for (const p of phrases) phById[p.id] = p;
  const notes = [], ghosts = [];
  for (const n of chart.notes) {
    const isGhost = n.ghost && n.ghost.includes(pid);
    if (!isGhost && !has(n.pans)) continue;
    const ph = phById[n.ph] || null;
    const t = n.ms != null ? n.ms / 1000 : T.t(n.at);
    const idx = n.i || [0];
    const reveal = ph ? (ph.preprint ? -1e9 : Math.min(...idx.map(i => ph.at[i]))) : -1e9;
    const kanaChars = Array.from(n.k);
    const o = {
      id: n.id, t, k: n.k, kanaChars, side: n.btn || 'L', type: n.type || 'tap',
      end: n.end ? T.t(n.end) : null, tail: n.tail ? T.t(n.tail) : null, release: n.release || null,
      ph, idx, reveal, crash: !!n.crash, rot: (hash(n.id) - 0.5) * 6,
      snd: kanaChars.map(k => (kanaTab[k] || {}).ko || ''), ro: kanaChars.map(k => (kanaTab[k] || {}).ro || ''),
      judged: false, res: null, delta: null,
    };
    if (isGhost) { o.ghost = true; ghosts.push(o); } else notes.push(o);
  }
  notes.sort((a, b) => a.t - b.t); ghosts.sort((a, b) => a.t - b.t);
  // 낱말 묶음(같은 말 노트를 종이 띠로 이음): word 구절의 노트·보기 글자
  const groups = [];
  for (const ph of phrases) {
    if (ph.kind !== 'word') continue;
    const items = notes.concat(ghosts).filter(n => n.ph === ph).sort((a, b) => a.t - b.t);
    // 두 번 받는 구절(いいえ いいえ)은 시간 틈으로 나눔
    let cur = [];
    for (const it of items) {
      if (cur.length && it.t - (cur[cur.length - 1].tail || cur[cur.length - 1].end || cur[cur.length - 1].t) > T.avgBeat * 1.6) { groups.push(cur); cur = []; }
      cur.push(it);
    }
    if (cur.length) groups.push(cur);
  }
  for (const g of groups) for (const n of g) n.group = g;
  const lyrics = chart.lyrics.filter(l => has(l.pans)).map(l => ({ t0: T.t(l.at), t1: T.t(l.at) + l.durMs / 1000, text: l.text }));
  const knocks = chart.knocks.filter(k => has(k.pans)).map(k => ({ t: T.t(k.at), hi: !!k.hi }));
  // 자유 손뼉 구간(판정·점수·콤보 없음)
  const free = (chart.free || []).filter(f => has(f.pans)).map(f => ({ t0: T.t(f.from), t1: T.t(f.to), at: f.at.map(T.t) }));
  // 따라 친 글자 흡수 자리(보기 글자·두 글자 말풍선 꼬리, 리듬 검토 10-19 C1)
  const echoes = ghostsEcho(notes, ghosts);
  const from = T.t(P.from), retryFrom = T.t(P.retryFrom), cut = T.t(P.cut), hitAt = T.t(P.hitAt);
  const eh = chart.endHit;
  const end = hitAt + (eh.until - eh.attack);
  const lastNote = notes.length ? Math.max(...notes.map(n => n.end || n.t)) : hitAt;
  return {
    id: pid, name: P.name, row: P.row, bg: P.bg, newMove: P.newMove, letters: P.letters,
    words: (chart.words && chart.words[panId]) || [],
    from, retryFrom, cut, hitAt, end, lastNote, endHit: eh, cutFadeMs: chart.cutFadeMs || 40,
    phrases, notes, ghosts, groups, lyrics, knocks, free, echoes, T,
    pass: Math.floor(notes.length / 2) + 1,
  };
}
