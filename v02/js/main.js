// main.js · 흐름: 시작 → (처음만) 지연 보정 → 판 고르기 → 연주 → 결과 → 다시 하기. 일시정지(세 박 세고 이어짐)·설정.
// 주소 옵션: ?autoplay=1 (정확한 시각에 진짜 pointer 이벤트로 자동 연주) &lag=ms · &mash=Hz (박 무시하고 왼쪽을 초당 Hz번 두드림, 마구 누르기 시험)
//            ?mute=1 (소리 끔, 시험 때 반드시) · ?pan=1|2 · ?go=1 (시작 단추 없이) · ?freezeAt=초 (그 곡 시각에서 멈춘 화면)
//            ?pose=동작:칸 (그 칸만 보이는 시험 화면, 예: D2_both:hit) · ?debug=1
import * as Clock from './clock.js';
import * as AUm from './audio.js';
import { loadJSON, buildPan, makeChordAt, makeTime } from './chart.js';
import { createJudge } from './judge.js';
import * as R from './render.js';
import { attachInput } from './input.js';
import { settings, saveSettings, fadeRecord, saveRecord } from './settings.js';
import { vibrate, vibrateHold, setHapticsMuted } from './haptics.js';
import { createPoseLib } from './poses.js';
import { createAnimLib } from './anim.js';
import * as UI from './ui.js';

const Q = new URLSearchParams(location.search);
const AUTOPLAY = Q.get('autoplay') === '1', LAG = (parseFloat(Q.get('lag') || '0') || 0) / 1000, MASH = parseFloat(Q.get('mash') || '0') || 0;
const MUTE = Q.get('mute') === '1', DEBUG = Q.get('debug') === '1', GO = Q.get('go') === '1';
const PANQ = ['1', '2'].includes(Q.get('pan')) ? Q.get('pan') : null;
const FREEZE = Q.get('freezeAt') != null ? parseFloat(Q.get('freezeAt')) : null;
const POSE = Q.get('pose'), LAYOUT_B = Q.get('layout') === 'b', FREE_TAP = Q.get('freeTap') === '1';
const AU = AUm.AU;
const canvas = document.getElementById('stage');
const S = {
  state: 'boot', ready: false, startWanted: false, D: null, pan: null, panId: null, judge: null, chordAt: null, Tsong: null,
  pausedT: 0, out: [], frames: 0, fps: 0, fpsT: 0, gaps: [], drawMs: [], lastNow: 0, rafNow: 0, auto: [], autoLate: 0, autoFired: 0,
  knockI: 0, clapPos: null, comboOpen: false, rounds: [], photos: [], photoQ: [], endDone: false, lastHoldPos: null, gagPh: new Set(),
  frozenT: null, calib: null, err: null, relSched: null,
};
window.__ttb = { S, AU, R, settings, report: () => report(), align: () => alignCheck(), loud: () => AUm.loudCheck(S.pan.notes), tune: H => AUm.tuneHits(H), pause: () => pause(), resume: () => resume(), songTime: () => Clock.songTime(), sim: (pan, o) => simPan(pan, o), voice: () => AUm.voiceCheck(S.pan.notes) };
const off = () => settings.offsetMs / 1000;
const preset = () => S.D.judge.presets[settings.judge] || S.D.judge.presets.normal;

// ── 준비 ─────────────────────────────
function loadImg(src) {
  return new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => no(new Error('그림 없음: ' + src)); im.src = src; })
    .then(im => (im.decode ? Promise.race([im.decode().catch(() => {}), new Promise(r => setTimeout(r, 1500))]).then(() => im) : im));
}
function fontsReady() {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  const p = Promise.all([document.fonts.load('800 30px "M PLUS Rounded 1c"', 'あいうえおかきくけこ'), document.fonts.load('600 40px "Klee One"', 'あいうえおかきくけこ'),
    document.fonts.load('800 20px "Pretendard Variable"', '따라박한글콤보빠름느림')]).catch(() => {});
  return Promise.race([p, new Promise(r => setTimeout(r, 2500))]);
}
async function boot() {
  try {
    Clock.createContext(); AUm.setup(MUTE); setHapticsMuted(MUTE);
    Clock.onState(st => { if (st !== 'running' && S.state === 'play' && S.frozenT == null) pause(); });   // 전화·알람·블루투스 끊김 → 일시정지(소리 검토 I5)
    const [chart, song, judge, kana, motion, stage, poses, anim] = await Promise.all(['data/ch1_chart.json', 'data/song_ch1.json', 'data/judge.json', 'data/kana.json', 'data/motion.json', 'assets/stage.json', 'assets/poses.json', 'assets/anim.json'].map(loadJSON));
    S.D = { chart, song, judge, kana: kana.kana, motion, stage, poses, anim };
    const images = {}, atlases = [];
    await Promise.all([
      ...Object.keys(stage.bg).map(id => loadImg(stage.bg[id].src).then(im => { images['bg_' + id] = im; })),
      ...poses.poses.map(p => loadImg(p.src).then(im => { images[p.id] = im; })),
      // 아틀라스: WebP 먼저(사파리 14+ · 크롬), 못 읽으면 PNG
      ...anim.atlases.map((src, i) => { const w = anim.atlasesWebp && anim.atlasesWebp[i]; const t0 = performance.now(); return (w ? loadImg(w).catch(() => loadImg(src)) : loadImg(src)).then(im => { atlases[i] = im; S.atlasMs = Math.max(S.atlasMs || 0, Math.round(performance.now() - t0)); S.atlasFmt = (im.src || '').endsWith('.webp') ? 'webp' : 'png'; }); }),
      fontsReady(),
    ]);
    S.lib = createPoseLib(poses.poses, images); S.images = images;
    S.animLib = createAnimLib(anim, atlases, R.tintAtlas);
    S.chordAt = makeChordAt(song); S.Tsong = makeTime(song);
    R.init(canvas, { images, stage, motion, lib: S.lib, anim: S.animLib });
    R.setTitleBg('p1');
    if (POSE) { const [m, k] = POSE.split(':'); R.setDemo({ motion: m, key: k }); }
    if (LAYOUT_B) R.setLayoutB(true);
    attachInput(canvas, R.getLayout, { onPress, onRelease, onPausePress, keysEnabled: () => S.state === 'play' });
    window.addEventListener('resize', () => R.resize());
    if (window.visualViewport) window.visualViewport.addEventListener('resize', () => R.resize());
    document.addEventListener('visibilitychange', () => { if (document.hidden && S.state === 'play' && !AUTOPLAY && !MASH) pause(); });
    UI.init({ start, resume, restart, quit, retry, home, toSelect, choosePan, optionsChanged, calibTap, calibSkip, calibAgain, calibGo, recalib, applyOffset,
      click: () => AUm.ui('click'), stamps: list => { for (const s of list) AUm.stampAt(s); } });
    S.state = 'title'; UI.show('title'); UI.setStatus('곡 준비 중', false);
    requestAnimationFrame(frame);
    const t0 = performance.now();
    await AUm.loadSong(song.file, song.beatsMs);
    await AUm.loadSfx();
    await AUm.loadVoice('assets/voice/ch1/').catch(e => console.warn('목소리 없음', e));
    for (const id of Object.keys(chart.pans)) R.preloadBg(chart.pans[id].bg);
    S.prepMs = Math.round(performance.now() - t0);
    S.ready = true; UI.setStatus(MUTE ? '소리 끔(시험)' : '', true);
    if (GO) start();
    else if (S.startWanted) afterUnlock();
  } catch (e) { S.err = String(e && e.stack || e); console.error(e); UI.setStatus('불러오기 실패 · 로컬 서버로 열었는지 확인', false); }
}

// ── 흐름 ─────────────────────────────
function start() {
  Clock.unlock();
  if (!S.ready) { S.startWanted = true; UI.setStatus('곡 준비 중', false); return; }
  afterUnlock();
}
function afterUnlock() {
  S.startWanted = false;
  if (!settings.calibrated && !AUTOPLAY && !GO && !MASH) startCalib();
  else if (PANQ) choosePan(PANQ);
  else toSelect();
}
function panList() {
  return Object.keys(S.D.chart.pans).map(id => {
    const P = S.D.chart.pans[id], T = S.Tsong;
    const len = T.t(P.hitAt) + (S.D.chart.endHit.until - S.D.chart.endHit.attack) - T.t(P.from);
    return { id, name: P.name, row: P.row, letters: P.letters, newMove: P.newMove, len: '0:' + String(Math.round(len)).padStart(2, '0') };
  });
}
function toSelect() {
  stopAll(); S.state = 'select'; R.setTitleBg(S.panId ? S.D.chart.pans[S.panId].bg : 'p1'); UI.showSelect(panList());
  const T = S.Tsong; AUm.loopStart(T.t('9:1'), T.t('11:1'), -6, 0.1);   // 판 고르기 미리듣기: 첫 부르고 받기 두 마디
}
function home() { stopAll(); S.state = 'title'; UI.show('title'); }
function choosePan(id) { Clock.unlock(); startPan(id, false); }
function stopAll() { Clock.stopSong(); AUm.stopPending(); AUm.loopStop(); vibrateHold('stop'); }

function startPan(id, retry) {
  stopAll();
  const pan = buildPan(S.D.chart, S.D.song, S.D.kana, id);
  S.pan = pan; S.panId = id;
  AUm.buildPanBuffer(pan);
  S.judge = createJudge(pan.notes, preset(), { echoes: pan.echoes, beat: pan.T.avgBeat });
  S.rounds = [];
  for (const ph of pan.phrases) {
    const ns = pan.notes.filter(n => n.ph === ph); let cur = [];
    for (const n of ns) { if (cur.length && n.t - (cur[cur.length - 1].end || cur[cur.length - 1].t) > pan.T.avgBeat * 1.6) { S.rounds.push(cur); cur = []; } cur.push(n); }
    if (cur.length) S.rounds.push(cur);
  }
  for (const r of S.rounds) for (const n of r) n.round = r;
  R.setPan(pan, 0);
  S.photos = []; S.photoQ = []; S.endDone = false; S.comboOpen = false; S.clapPos = null; S.lastHoldPos = null; S.gagPh = new Set(); S.relSched = null;
  S.frozenT = null; S.gaps = []; S.drawMs = []; S.autoLate = 0; S.autoFired = 0;
  const from = retry ? pan.retryFrom : pan.from;
  S.playFrom = from;
  S.knockI = pan.knocks.findIndex(k => k.t >= from); if (S.knockI < 0) S.knockI = pan.knocks.length;
  Clock.startSong(AU.panBuf, AU.songBus, from, 0.35);
  setupAuto(from);
  S.state = 'play'; UI.show(null);
}

// 지연 제안(리듬 검토 10-19 I2): 같은 쪽 앞 노트가 2박 넘게 떨어진 노트(부르는 마디 뒤 첫 노트)만, 창 −245 ~ +450ms 안 가장 가까운 실제 누름
function suggestOffset(J, pan) {
  const ds = [];
  for (const n of pan.notes) {
    const prev = pan.notes.filter(x => x.side === n.side && x.t < n.t - 0.01).pop();
    if (prev && n.t - (prev.end || prev.t) < pan.T.avgBeat * 2) continue;
    let best = null; for (const p of J.raw[n.side]) { const d = p - n.t; if (d >= -0.245 && d <= 0.45 && (best == null || Math.abs(d) < Math.abs(best))) best = d; }
    if (best != null) ds.push(best * 1000);
  }
  ds.sort((a, b) => a - b);
  return { n: ds.length, med: ds.length ? Math.round(ds[Math.floor(ds.length / 2)]) : null };
}
// 메달: 1 통과(절반 넘게 GOOD 이상) · 2 다 맞힘(MISS 0) · 3 완벽(PERFECT 80% + 빈 터치 ≤ 노트 수 × 0.5, 리듬 검토 10-19 I1 전문가 판단: 1·2는 초보에게 너그럽게 그대로)
function medalOf(J, pan, noEmptyRule) {
  const total = pan.notes.length, good = J.goodOrBetter();
  let m = good >= pan.pass ? 1 : 0;
  if (m && J.counts.MISS === 0) m = 2;
  if (m === 2 && J.counts.PERFECT / total >= 0.8 && (noEmptyRule || J.emptyCount <= total * 0.5)) m = 3;
  return m;
}
// 모의 연주(소리·화면 없이 판정만): opts = { n, bias(초), jitter(초, 정규분포 σ), ghosts(보기 글자·꼬리도 따라 침), mash(초당), rules(false면 마구 누르기·흡수 규칙 끔) }
function simPan(panId, o) {
  let seed = o.seed || 1; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const gauss = () => { const u = Math.max(1e-9, rnd()), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const medals = [0, 0, 0, 0]; let miss = 0, notesN = 0, empties = 0;
  for (let k = 0; k < (o.n || 100); k++) {
    const pan = buildPan(S.D.chart, S.D.song, S.D.kana, panId);
    const rules = o.rules !== false;
    const J = createJudge(pan.notes, preset(), { echoes: rules ? pan.echoes : [], beat: pan.T.avgBeat, noEcho: !rules, noMash: !rules });
    const ev = [];
    if (o.mash) { for (let t = pan.from + 0.5 + rnd() / o.mash; t < pan.hitAt; t += 1 / o.mash) { ev.push([t, 'down', 'L']); ev.push([t + 0.04, 'up', 'L']); } }
    else {
      for (const n of pan.notes) { const p = n.t + (o.bias || 0) + gauss() * (o.jitter || 0); ev.push([p, 'down', n.side]); ev.push([n.type === 'hold' ? n.end + (o.bias || 0) + gauss() * (o.jitter || 0) * 0.5 : p + 0.07, 'up', n.side]); }
      if (o.ghosts) for (const e of pan.echoes) { const p = e + (o.bias || 0) + gauss() * (o.jitter || 0); ev.push([p, 'down', 'L']); ev.push([p + 0.06, 'up', 'L']); }
    }
    ev.sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const [t, kind, side] of ev) { J.sweep(t, out); if (kind === 'down') J.press(side, t); else J.release(side, t); }
    J.sweep(pan.hitAt + 2, out);
    medals[medalOf(J, pan, !rules)]++; miss += J.counts.MISS; notesN += pan.notes.length; empties += J.emptyCount;
  }
  return { medals, medal2plus: medals[2] + medals[3], missPct: +(miss / notesN * 100).toFixed(1), emptyAvg: +(empties / (o.n || 100)).toFixed(1) };
}function finish() {
  stopAll();
  S.state = 'result';
  const J = S.judge, pan = S.pan, total = pan.notes.length, good = J.goodOrBetter();
  const medal = medalOf(J, pan);
  const sg = suggestOffset(J, pan), med = sg.med;
  const suggest = med != null && sg.n >= 2 && Math.abs(med) > 25 ? Math.round((settings.offsetMs + med) / 5) * 5 : 0;
  const stamped = new Set(); for (const l of J.log) if (l.res !== 'MISS') for (const k of Array.from(l.k)) stamped.add(k);
  const faceId = medal >= 3 ? 'face_camera' : medal >= 1 ? 'face_smile' : 'face_worry';
  saveRecord(pan.id, { medal, good, total, perfect: J.counts.PERFECT });
  S.result = { medal, good, total, counts: Object.assign({}, J.counts), maxCombo: J.maxCombo, medMs: med, suggest };
  UI.showResult({ panName: pan.name + ' · ' + pan.row, good, total, medal, counts: J.counts, maxCombo: J.maxCombo, medMs: med, suggest,
    face: S.images[faceId] ? S.images[faceId].src : '', photos: S.photos.slice(-3), letters: pan.letters, stamped, info: k => (S.D.kana[k] || {}).ko || '', words: pan.words });
  const T = S.Tsong; AUm.loopStart(T.t('1:1'), T.t('5:1'), -8, 0.2);   // 결과 음악: 곡 전주 네 마디 고리
}
function retry() { startPan(S.panId, true); }
function applyOffset(v) { settings.offsetMs = Math.max(-300, Math.min(300, v)); settings.calibrated = true; saveSettings(); UI.refreshOffset(); }

function pause() {
  if (S.state !== 'play') return;
  let t = Clock.songTime();
  const RS = R.getState(); if (RS.countFrom != null && t < RS.countTo) t = RS.countTo;   // 셈 도중 멈추면 셈 끝 자리로(리듬 검토 S6)
  S.pausedT = t; stopAll(); if (S.voiceHold) { AUm.voiceCut(S.voiceHold.vh); S.voiceHold = null; }
  for (const r of S.judge.forceRelease(t - off())) afterJudge(r, t);
  R.release('L'); R.release('R');
  S.state = 'pause'; UI.show('pause');
}
function resume() {
  if (S.state !== 'pause') return;
  Clock.unlock();
  const T = S.pan.T, p = Math.floor(T.pos(S.pausedT));
  const from = Math.max(S.playFrom - 0.01, T.timeOfPos(p - 3));
  R.setCountIn(from, T.timeOfPos(p));
  S.knockI = S.pan.knocks.findIndex(k => k.t >= from); if (S.knockI < 0) S.knockI = S.pan.knocks.length;
  S.clapPos = null; S.relSched = null;
  Clock.startSong(AU.panBuf, AU.songBus, from, 0.15);
  setupAuto(from);
  S.state = 'play'; UI.show(null);
}
function restart() { startPan(S.panId, false); }
function quit() { toSelect(); }
function optionsChanged() { AUm.applySfxLevel(); UI.refreshOffset(); }
function onPausePress() { if (S.state === 'play') pause(); else if (S.state === 'pause') resume(); }

// ── 누름(원칙 3: 소리 먼저, 그 자리에서) ─────────────────────────────
function onPress(side, e) {
  if (S.state !== 'play' || S.frozenT != null) return;
  Clock.sync();
  const tH = Clock.songTimeOfEvent(e), tJ = tH - off();
  // 자유 손뼉 구간: 판정·점수·콤보·마구 누르기 셈 모두 없음. 손뼉 소리(곡 대비 −12dB) + 하나 손뼉 칸 + 꽃가루
  if (S.pan.free.some(fr => tJ >= fr.t0 - 0.3 && tJ < fr.t1 - 0.2)) { AUm.freeClap(); R.press(side, tH); R.freeClap(tH); S.freeTaps = (S.freeTaps || 0) + 1; return; }
  const r = S.judge.press(side, tJ);
  if (!r) { AUm.hitNow(side, 'EMPTY'); R.press(side, tH, true); return; }
  if (r.how === 'regrab') { R.press(side, tH); return; }
  if (r.how === 'echo') { AUm.hitNow(side, 'EMPTY'); R.press(side, tH, true); return; }   // 따라 친 글자: 벌 없음
  AUm.hitNow(side, r.res, r.note.crash);
  // 글자 목소리: 노트 창 안 누름(PERFECT·GREAT·GOOD)이면 누르는 즉시 같이(원칙 3), 길게는 일찍 떼면 30ms 페이드
  if (r.res !== 'MISS' && (r.how === 'press' || r.how === 'head' || r.how === 'lategrab')) { const vh = AUm.voiceNow(r.note.id); if (r.how !== 'press') S.voiceHold = { n: r.note, vh }; }
  const bl = S.pan.T.beatInfo(r.note.t).beatLen;
  vibrate(r.res, (r.note.t + bl / 4 - tJ) * 1000);
  if (r.how === 'head' || r.how === 'lategrab') vibrateHold('tick');
  R.press(side, tH);
  if (r.final && r.res !== 'MISS') AUm.tails(r.res, r.note.t, bl, S.chordAt(r.note.t), AU.ctx.currentTime);
  afterJudge(r, tH);
}
function onRelease(side, e) {
  R.release(side);
  if (S.state !== 'play' || !S.judge) return;
  Clock.sync();
  const tH = Clock.songTimeOfEvent(e), r = S.judge.release(side, tH - off());
  if (r && r.final) { holdDone(r, tH); afterJudge(r, tH); }
}
// 길게 끝 소리(리듬 검토 I2): 끝 0.25초 안이면 곡 시각에 미리 예약. 셔터는 늘 곡 한 방 시각, 뗌 어긋남은 사진 흔들림으로만
function holdDone(r, tH) {
  const n = r.note, sch = S.relSched && S.relSched.n === n ? S.relSched : null;
  if (!r.ok) { if (sch && n.release !== 'shutter') AUm.cancel(sch.src); S.relSched = null; vibrateHold('stop'); if (S.voiceHold && S.voiceHold.n === n) { AUm.voiceCut(S.voiceHold.vh); S.voiceHold = null; } return; }
  if (n.release === 'shutter') {
    if (!sch) AUm.releaseAt('shutter', n.end);
    const rd = Math.abs((r.relDelta || 0) * 1000);
    S.photoQ.push({ at: Math.max(tH, n.end) + 0.05, shake: rd <= 50 ? 0 : rd <= 120 ? 2 : 5 });
  } else if (r.how === 'auto') { if (!sch) AUm.releaseNow('free'); }
  else if (!sch || tH < n.end - 0.01) { if (sch) AUm.cancel(sch.src); AUm.releaseNow('free'); }
  S.relSched = null;
  vibrateHold(n.release === 'shutter' ? 'shutter' : 'release');
  AUm.tails(r.res, n.end, S.pan.T.beatInfo(n.end).beatLen, S.chordAt(n.end), AU.ctx.currentTime - 1);
}
function afterJudge(r, tNow) {
  const n = r.note, pan = S.pan, J = S.judge;
  R.judged(r, tNow);
  if ((r.how === 'head' || r.how === 'lategrab' || r.final) && r.res && r.res !== 'MISS' && n.ph) for (const i of n.idx) n.ph.hitIdx.add(i);
  if (!r.final) return;
  R.setCombo(J.combo, tNow);
  if (r.res !== 'MISS') { for (const k of n.kanaChars) { fadeRecord(k); if (pan.letters.includes(k)) R.stamp(k, tNow); } }
  // 콤보 10·20·30: 무리 손뼉(고역만)을 '다음 빈 박'에 — 부르는 구절 안이면 그 받는 마디 첫 박으로 미룸(소리 검토 I3). 하나는 다음 강박에 점프(다음 노트가 2박 넘게 없을 때)
  if (r.res !== 'MISS' && J.combo > 0 && J.combo % 10 === 0) {
    let at = nextBar(tNow);
    for (const ph of pan.phrases) if (at >= ph.call0 - 0.02 && at < ph.resp0) at = ph.resp0;
    if (at < pan.hitAt - 0.05) AUm.crowdAt(at);
    R.comboMilestone(tNow);
  }
  if (r.res === 'MISS') {
    S.comboOpen = false;
    const key = n.round ? S.rounds.indexOf(n.round) : n.id;
    if (!S.gagPh.has(key)) { S.gagPh.add(key); AUm.gagAt(nextOff(tNow)); }
  } else if (J.combo >= 10) S.comboOpen = true;
  if (n.round && n.round.every(x => x.judged)) {
    const rr = n.round;
    if (rr.every(x => x.res === 'PERFECT')) { const T = pan.T; const at = T.timeOfPos(Math.floor(T.pos(Math.max(...rr.map(x => x.end || x.t))) + 1e-3) + 1); if (at < pan.hitAt - 0.05) S.photoQ.push({ at: at + 0.03, shake: 0 }); }
  }
}
function nextBar(t) { const T = S.pan.T, p = T.pos(t + 0.02); return T.timeOfPos(Math.ceil((p - 2) / 4) * 4 + 2); }
function nextOff(t) { const T = S.pan.T, p = T.pos(t + 0.02); let q = Math.floor(p) + 0.5; if (q < p) q += 1; return T.timeOfPos(q); }

// ── 자동 연주(시험용) ─────────────────────────────
function setupAuto(from) {
  S.auto = [];
  if (MASH > 0) {   // 박 무시 마구 두드리기: 40ms 누름
    for (let t = from + 0.5; t < S.pan.hitAt; t += 1 / MASH) { S.auto.push({ at: t, side: 'L', kind: 'down' }); S.auto.push({ at: t + 0.04, side: 'L', kind: 'up' }); }
    return;
  }
  if (!AUTOPLAY) return;
  if (FREE_TAP) for (const fr of S.pan.free) fr.at.forEach((ft, i) => { if (ft >= from) { S.auto.push({ at: ft, side: i % 2 ? 'R' : 'L', kind: 'down' }); S.auto.push({ at: ft + 0.06, side: i % 2 ? 'R' : 'L', kind: 'up' }); } });
  for (const n of S.pan.notes) {
    if (n.t < from - 0.01 || n.judged) continue;
    S.auto.push({ at: n.t, side: n.side, kind: 'down', id: n.id });
    S.auto.push({ at: n.type === 'hold' ? n.end - 0.012 : n.t + 0.07, side: n.side, kind: 'up', id: n.id });
  }
  S.auto.sort((a, b) => a.at - b.at);
}
function autoplayTick(t) {
  while (S.auto.length && S.auto[0].at + off() + LAG - t < 0.25) {
    const a = S.auto.shift(), target = Clock.transport.startCtx + a.at + off() + LAG;
    const fire = () => {
      if (S.state !== 'play') return;
      const perfT = Clock.perfOfHeard(target), wait = perfT - performance.now();
      if (wait > 4) { setTimeout(fire, wait - 3); return; }
      if (wait < -8) S.autoLate++;
      while (performance.now() < perfT) { /* 3ms 안 맞춤 */ }
      dispatch(a.side, a.kind); S.autoFired++;
    };
    fire();
  }
}
function dispatch(side, kind) {
  const L = R.getLayout(), x = L.ox + (side === 'L' ? 104 : 286) * L.s, y = L.oy + L.padY * L.s;
  canvas.dispatchEvent(new PointerEvent(kind === 'down' ? 'pointerdown' : 'pointerup', { clientX: x, clientY: y, pointerId: side === 'L' ? 51 : 52, pointerType: 'touch', bubbles: true, cancelable: true, isPrimary: true }));
}

// ── 지연 보정: 곡 전주(드럼)에 맞춰 톡. 앞 2번 버림 → 가운데값 → 150ms 넘게 벗어난 톡 버림 → 남은 것 6개(리듬 검토 S2) ─────────────────────────────
function startCalib() {
  stopAll();
  S.state = 'calib'; UI.calibReset(); UI.show('calib');
  S.calib = { taps: [], done: false };
  Clock.startSong(AU.full, AU.songBus, 0, 0.3);
}
// 지연 보정(리듬 검토 10-19 I2): 마디 첫 박(쿵)에만 톡 → 받는 폭 ±0.9초라 지연이 반 박을 넘어도 방향이 안 뒤집힘(리듬 닥터 방식). 첫 톡 버림, 다섯 개 가운데값
function calibTap(e) {
  const c = S.calib; if (!c || c.done || S.state !== 'calib') return;
  Clock.sync(); AUm.hitNow('L', 'GREAT', false); UI.calibTapFx();
  const T = S.Tsong, th = Clock.songTimeOfEvent(e);
  const bp = 2 + 4 * Math.round((T.pos(th) - 2) / 4);
  if (bp < 6) return;   // 2마디부터
  const d = th - T.timeOfPos(bp); if (Math.abs(d) > 0.9) return;
  c.taps.push(d);
  UI.calibProgress(Math.min(6, c.taps.length));
  const use = c.taps.slice(1);
  if (use.length >= 5) {
    const s = use.slice().sort((a, b) => a - b), ms = Math.round(s[Math.floor(s.length / 2)] * 1000);
    settings.offsetMs = Math.max(-300, Math.min(300, ms)); settings.calibrated = true; saveSettings();
    c.done = true; Clock.stopSong(); UI.calibDone(settings.offsetMs);
  }
}function calibSkip() { settings.calibrated = true; saveSettings(); Clock.stopSong(); if (S.calib) S.calib.done = true; toSelect(); }
function calibAgain() { startCalib(); }
function calibGo() { toSelect(); }
function recalib() { Clock.unlock(); if (S.ready) startCalib(); }

// ── 매 프레임 ─────────────────────────────
function frame(now, fromTimer) {
  if (!fromTimer) { requestAnimationFrame(frame); S.rafNow = performance.now(); }
  if (S.lastNow && S.state === 'play' && S.frozenT == null) { const gap = now - S.lastNow; if (S.gaps.length < 20000) S.gaps.push(gap); }
  S.lastNow = now; S.frames++;
  if (now - S.fpsT > 1000) { S.fps = Math.round(S.frames * 1000 / (now - S.fpsT)); S.frames = 0; S.fpsT = now; }
  if (!S.D || !R.getLayout()) return;
  const dbg = DEBUG ? { fps: S.fps, offsetMs: settings.offsetMs, visualMs: settings.visualMs || 0, lat: Math.round(Clock.outputLatency() * 1000) + 'ms' } : null;
  if (S.state === 'play') {
    Clock.sync();
    const t = Clock.songTime();
    if (FREEZE != null && S.frozenT == null && t >= FREEZE) { S.frozenT = FREEZE; stopAll(); window.__ttb.frozen = true; }
    if (S.frozenT != null) { R.draw(S.frozenT, 'play', dbg, settings.visualMs); return; }
    const tj = t - off();
    const evs = S.judge.sweep(tj, S.out);
    for (const r of evs) { if (r.how === 'auto' || r.how === 'early-release') holdDone(r, t); afterJudge(r, t); }
    if (AUTOPLAY || MASH) autoplayTick(t);
    schedule(t);
    holdTicks(t);
    while (S.photoQ.length && t >= S.photoQ[0].at) { const q = S.photoQ.shift(); S.photos.push(R.capturePhoto(q.shake)); }
    if (!S.endDone && t >= S.pan.hitAt - 0.005) { S.endDone = true; R.endHit(S.pan.hitAt); if (!S.pan.notes.some(n => n.release === 'shutter')) S.photoQ.push({ at: S.pan.hitAt + 0.06, shake: 0 }); }
    const d0 = performance.now();
    R.draw(t, 'play', dbg, settings.visualMs);
    if (S.drawMs.length < 20000) S.drawMs.push(performance.now() - d0);
    if (t >= S.pan.hitAt + 1.9) finish();
  } else if (S.state === 'pause') {
    R.draw(S.pausedT, 'pause', dbg, settings.visualMs);
  } else {
    if (S.state === 'calib' && S.calib && !S.calib.done) {
      Clock.sync();
      const T = S.Tsong, th = Clock.songTime();
      if (th > T.t('9:1')) Clock.startSong(AU.full, AU.songBus, T.t('1:1') - 0.1, 0.1);
    }
    R.draw(now / 1000, 'idle', null);
  }
}
function schedule(t) {
  const pan = S.pan, T = pan.T, ahead = t + 0.25;
  while (S.knockI < pan.knocks.length && pan.knocks[S.knockI].t < ahead) { const k = pan.knocks[S.knockI++]; if (k.t > t - 0.02) { if (k.hi) AUm.knockHiAt(k.t); else AUm.knockAt(k.t, S.chordAt(k.t)); } }
  if (S.comboOpen) {
    if (S.clapPos == null) S.clapPos = Math.ceil(T.pos(t + 0.05));
    while (T.timeOfPos(S.clapPos) < ahead) {
      const p = S.clapPos++, beat = ((p - 2) % 4 + 4) % 4 + 1, tt = T.timeOfPos(p);
      if ((beat === 2 || beat === 4) && tt < pan.cut - 0.05) AUm.comboClapAt(tt);
    }
  } else S.clapPos = null;
}
// 누르고 있는 동안 박마다 작은 종이 소리 + 진동, 끝 0.25초 안이면 끝 소리를 곡 시각에 예약
function holdTicks(t) {
  const J = S.judge, T = S.pan.T;
  const h = J.holding.L || J.holding.R;
  if (!h || !h.hold || !h.hold.active || h.hold.released != null) { S.lastHoldPos = null; return; }
  const p = Math.floor(T.pos(t - off()));
  if (S.lastHoldPos == null) S.lastHoldPos = p;
  if (p > S.lastHoldPos && T.timeOfPos(p) < h.end - 0.05) { S.lastHoldPos = p; AUm.holdTick(); vibrateHold('tick'); }
  if (!S.relSched && h.end - t < 0.25 && h.end > t) S.relSched = { n: h, src: AUm.releaseAt(h.release === 'shutter' ? 'shutter' : 'free', h.end) };
}
setInterval(() => { if (S.D && performance.now() - S.rafNow > 100) frame(performance.now(), true); }, 16);

// ── 시험 보고 ─────────────────────────────
function stats(a) { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), q = f => s[Math.min(s.length - 1, Math.floor(f * s.length))]; return { n: s.length, p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), p99: +q(0.99).toFixed(2), max: +s[s.length - 1].toFixed(2), avg: +(s.reduce((x, y) => x + y, 0) / s.length).toFixed(2) }; }
function report() {
  const J = S.judge; if (!J) return null;
  const ds = J.log.filter(l => l.delta != null && l.how !== 'early-mash').map(l => Math.round(l.delta * 1000));
  const t = S.state === 'play' ? Clock.songTime() : S.pausedT;
  const { HA, UA } = R.animators();
  const body = a => a.changes.length ? { n: a.changes.length, max: +Math.max(...a.changes.map(c => c.body)).toFixed(1), p50: +stats(a.changes.map(c => c.body)).p50 } : null;
  return {
    state: S.state, pan: S.panId, notes: S.pan.notes.length, counts: J.counts, maxCombo: J.maxCombo, result: S.result || null,
    hows: J.log.reduce((o, l) => (o[l.how] = (o[l.how] || 0) + 1, o), {}),
    deltasMs: ds, deltaAbsMax: ds.length ? Math.max(...ds.map(Math.abs)) : null,
    holds: J.log.filter(l => l.type === 'hold').map(l => ({ id: l.id, res: l.res, how: l.how, headMs: l.delta == null ? null : Math.round(l.delta * 1000), relMs: l.relDelta == null ? null : Math.round(l.relDelta * 1000) })),
    frameGapMs: stats(S.gaps), over20ms: S.gaps.filter(x => x > 20).length, over33ms: S.gaps.filter(x => x > 33.4).length, drawMs: stats(S.drawMs),
    anim: { hanaFrames: HA.changes.length + 1, hanaFootJumpPx: 0, hanaBodyShift: body(HA), hanaMaxStillBeats: +HA.maxStill.toFixed(2), uncleFrames: UA.changes.length + 1, uncleBodyShift: body(UA), uncleMaxStillBeats: +UA.maxStill.toFixed(2) },
    animDur: animDur(HA), echoCount: J.echoCount, emptyCount: J.emptyCount, freeTaps: S.freeTaps || 0, atlas: { fmt: S.atlasFmt, ms: S.atlasMs }, voiceFiles: AU.stats.voiceFiles,
    autoFired: S.autoFired, autoLate: S.autoLate, prepMs: S.prepMs, songPeakDb: AU.stats.songPeakDb, decodeShiftMs: AU.stats.decodeShiftMs, hitPeakDb: AU.stats.hitPeakDb,
    vis: R.visibility(t), photos: S.photos.length, err: S.err,
  };
}
// 칸 길이 점검(움직임 재검토 V1): 치기 칸·예비 칸 가장 짧은 ms, 1/16박(31ms) 미만 칸 수, 노트 사이 들을 때 칸 수
function animDur(HA) {
  const d = HA.durs, mn = k => { const a = d.filter(x => x.key === k && (x.kind === 'pre' || x.kind === 'hit')).map(x => x.ms); return a.length ? Math.round(Math.min(...a)) : null; };
  return { hitMinMs: mn('hit'), windMinMs: mn('wind'), readyMinMs: mn('ready'), under31ms: d.filter(x => x.ms < 31).length, n: d.length };
}
function alignCheck() {
  const b = AU.full; if (!b || !S.pan) return null;
  const sr = b.sampleRate, d0 = b.getChannelData(0), d1 = b.numberOfChannels > 1 ? b.getChannelData(1) : d0, hop = Math.round(sr * 0.005);
  const E = t => { const s = Math.round(t * sr); let e = 0; for (let i = s; i < s + hop; i++) { const x = (d0[i] + d1[i]) - (d0[i - 1] + d1[i - 1]); e += x * x; } return e + 1e-9; };
  const out = [];
  for (const n of S.pan.notes.concat(S.pan.ghosts)) {
    let best = -99, at = 0;
    for (let k = -12; k <= 12; k++) { const tt = n.t + k * 0.005; let prev = 0; for (let j = 1; j <= 6; j++) prev += E(tt - j * 0.005); prev /= 6; const db = 10 * Math.log10(E(tt) / prev); if (db > best) { best = db; at = k * 5; } }
    out.push({ id: n.id, k: n.k, ghost: !!n.ghost, riseDb: +best.toFixed(1), atMs: at });
  }
  return out;
}

boot();
