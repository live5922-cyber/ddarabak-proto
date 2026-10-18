// chart.js · 자료 파일(data/*.json)을 읽어 초 단위 시각표로 바꿈. 코드에는 곡 내용이 없음.
// 시각 규칙(기획안 v0.5 5절 · 조사 play_song_v4 2-5):
//   부를 때(T − 4박) 글자 카드 → T − 2.75박부터 0.25박 동안 가나만 노트 길 오른쪽 끝(x 416)으로 내려감
//   → T − 2.5박부터 1박 144px로 맞춤 고리(x 56)까지 → T − 1박에 버튼 고리가 나타남
//   카드가 다음 카드로 바뀌면 남은 가나는 그때 바로 내려가기 시작함(도착 시각 T − 2.5박은 그대로)

export async function loadJSON(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(url + ' ' + r.status);
  return r.json();
}

export const LEAD = { card: 4, flightStart: 2.75, flightEnd: 2.5, ring: 1 };   // 박 단위

export function buildChart(raw, kanaData) {
  const song = raw.song;
  const beat = 60 / song.bpm;
  const bpb = song.beatsPerBar || 4;
  const timeOf = (bar, b) => ((bar - 1) * bpb + (b - 1)) * beat;
  const K = kanaData.kana, VP = kanaData.vowelPitch;
  const info = k => K[k] || { ko: k, ro: k, v: 'a', c: '' };

  const ch = {
    id: raw.id, title: raw.title, letters: raw.letters, known: raw.known || raw.letters,
    pass: raw.pass || { need: 0 },
    song, beat, bpb, bar: beat * bpb, timeOf, info, vowelPitch: VP,
    chords: raw.chords || [],
    end: timeOf(song.endBar || (song.bars + 1), 1),
    notes: [], cards: [], calls: [], listen: [], lyrics: [], hits: [], wordGroups: [],
  };
  ch.chordAt = t => {
    const i = Math.max(0, Math.min(ch.chords.length - 1, Math.floor(t / ch.bar)));
    return ch.chords[i] || 'C';
  };

  // 노트
  raw.notes.forEach((n, i) => {
    ch.notes.push({
      id: i, t: timeOf(n.bar, n.beat), bar: n.bar, beat: n.beat, k: n.k, info: info(n.k),
      btn: n.btn || 'L', call: n.call === undefined ? -1 : n.call, syl: n.syl === undefined ? -1 : n.syl,
      flightStart: null, flightEnd: null, card: null, glyph: -1,
      judged: false, res: null, delta: 0,
    });
  });
  ch.notes.sort((a, b) => a.t - b.t);
  ch.notes.forEach((n, i) => { n.id = i; });
  const noteOf = (ci, si) => ch.notes.find(n => n.call === ci && n.syl === si) || null;

  // 부름
  raw.calls.forEach((c, ci) => {
    const syl = c.syl.map((s, si) => ({ t: timeOf(c.bar, s.beat), k: s.k, info: info(s.k), note: noteOf(ci, si) }));
    const call = { i: ci, bar: c.bar, word: c.word, end: c.end || 'knock', syl };
    call.endT = timeOf(c.bar, 4);
    ch.calls.push(call);
    if (c.word) {
      ch.cards.push({ kind: 'word', tShow: syl[0].t, word: c.word,
        glyphs: syl.map(s => ({ k: s.k, info: s.info, tReveal: s.t, note: s.note })) });
      const ns = syl.map(s => s.note).filter(Boolean);
      if (ns.length) ch.wordGroups.push({ word: c.word, notes: ns, shown: false });
    } else {
      for (const s of syl) {
        ch.cards.push({ kind: 'letter', tShow: s.t, glyphs: [{ k: s.k, info: s.info, tReveal: s.t, note: s.note }] });
      }
    }
  });

  // 듣기만 하는 줄
  (raw.listen || []).forEach(l => {
    const t = timeOf(l.bar, l.beat);
    const item = { t, beats: l.beats, kana: l.kana, ko: l.ko, ro: l.ro, mean: l.mean, cue: l.cue || '', who: l.who,
      sing: (l.sing || []).map(s => ({ t: t + (s.beat - 1) * beat, k: s.k, info: info(s.k), len: (s.len || 1) * beat })) };
    ch.listen.push(item);
    ch.cards.push({ kind: 'listen', tShow: t, item, natural: t + l.beats * beat });
  });

  // 한국어 가사 줄(하나)
  (raw.lyrics || []).forEach(l => {
    const t = timeOf(l.bar, l.beat);
    ch.lyrics.push({ t, text: l.text, who: l.who });
    ch.cards.push({ kind: 'lyric', tShow: t, text: l.text, natural: t + (l.beats || 4) * beat });
  });

  (raw.hits || []).forEach(h => ch.hits.push({ t: timeOf(h.bar, h.beat), kind: h.kind }));

  // 카드 순서·사라지는 때·글자 비행 시각
  ch.cards.sort((a, b) => a.tShow - b.tShow);
  ch.cards.forEach((c, i) => {
    c.id = i;
    const next = ch.cards[i + 1];
    const nextT = next ? next.tShow : Infinity;
    if (c.glyphs) {
      let lastFS = -Infinity;
      c.glyphs.forEach((g, gi) => {
        const n = g.note;
        if (!n) return;
        const fe = n.t - LEAD.flightEnd * beat;
        let fs = Math.min(n.t - LEAD.flightStart * beat, nextT);
        fs = Math.max(fs, g.tReveal);
        if (fs > fe - 0.03) fs = fe - 0.03;
        n.flightStart = fs; n.flightEnd = fe; n.card = c; n.glyph = gi;
        if (fs > lastFS) lastFS = fs;
      });
      const naturalOut = lastFS > -Infinity ? lastFS : c.tShow + 1.25 * beat;
      if (nextT <= naturalOut) { c.tOut = nextT; c.outDur = 0.08; }
      else { c.tOut = naturalOut; c.outDur = LEAD.flightStart * beat - LEAD.flightEnd * beat; }
      c.tLastReveal = Math.max.apply(null, c.glyphs.map(g => g.tReveal));
    } else {
      c.tOut = Math.min(nextT, c.natural); c.outDur = nextT <= c.natural ? 0.08 : 0.15;
    }
    c.tEnd = c.tOut + c.outDur;
  });

  // 카드가 없는 노트(뒤 판의 박 노트 등)는 노트 길 끝에서 바로 나타남
  for (const n of ch.notes) {
    if (n.flightEnd === null) { n.flightEnd = n.t - LEAD.flightEnd * beat; n.flightStart = n.flightEnd; }
  }
  return ch;
}

// 지금 보이는 카드(하나만). 없으면 null
export function cardAt(ch, t) {
  const cs = ch.cards;
  for (let i = cs.length - 1; i >= 0; i--) {
    const c = cs[i];
    if (c.tShow <= t) return t < c.tEnd ? c : null;
  }
  return null;
}
