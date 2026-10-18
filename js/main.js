// main.js · 흐름: 시작 → (처음만) 지연 보정 → 연주 → 결과 → 다시 하기. 일시정지·설정.
// 주소 옵션: ?autoplay=1 (정확한 시각에 자동으로 누름, 시험용) &lag=ms (자동 누름을 일부러 늦게/일찍)
//            ?debug=1 (시각·fps 표시) ?probe=1 (노트·고리 위치 기록) ?chart=ch1_pan1
import * as Clock from './clock.js';
import * as A from './audio.js';
import { loadJSON, buildChart } from './chart.js';
import { createJudge, WIN } from './judge.js';
import * as Rn from './render.js';
import { attachInput } from './input.js';
import { settings, saveSettings, fadeRecord } from './settings.js';
import { vibrate } from './haptics.js';
import * as UI from './ui.js';

const Q = new URLSearchParams(location.search);
const AUTOPLAY = Q.get('autoplay') === '1';
const AUTOLAG = (parseFloat(Q.get('lag') || '0') || 0) / 1000;
const DEBUG = Q.get('debug') === '1';
const PROBE = Q.get('probe') === '1';
const CHART = (Q.get('chart') || 'ch1_pan1').replace(/[^a-z0-9_]/gi, '');

const canvas = document.getElementById('stage');
const S = {
  state: 'boot', ready: false, startWanted: false, ch: null, judge: null, song: null,
  t: 0, pausedT: 0, missBuf: [], comboOpen: false, auto: { i: 0 }, calib: null,
  fps: 0, frames: 0, fpsT: 0, worstFrame: 0, frameGaps: [], prepMs: 0, err: null,
};
window.__ttb = { S, Clock, A, Rn, WIN, settings, AUTOPLAY };   // 시험용 손잡이

const off = () => settings.offsetMs / 1000;

// ── 준비 ───────────────────────────────
async function loadImages(stage) {
  const list = [['bg', stage.bg.src]].concat(Object.keys(stage.dolls).map(k => [k, stage.dolls[k].src]));
  const out = {};
  await Promise.all(list.map(async ([k, src]) => {
    const im = new Image();
    const loaded = new Promise((ok, no) => { im.onload = ok; im.onerror = () => no(new Error('그림 없음: ' + src)); });
    im.src = src;
    await loaded;
    // 미리 해독(첫 프레임 끊김 방지). 화면이 숨겨져 해독이 안 끝나면 1초 뒤 그냥 넘어감(그리기 때 해독됨)
    try { await Promise.race([im.decode(), new Promise(r => setTimeout(r, 1000))]); } catch (e) { /* 무시 */ }
    out[k] = im;
  }));
  return out;
}
function fontsReady() {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  const loads = Promise.all([
    document.fonts.load('800 28px "M PLUS Rounded 1c"', 'あいうえおせーのいしやきもー'),
    document.fonts.load('800 20px "Pretendard Variable"', '따라박아이우에오한글소리뜻듣기만'),
  ]).catch(() => {});
  return Promise.race([loads, new Promise(r => setTimeout(r, 2500))]);
}

async function boot() {
  try {
    Clock.createContext();
    A.setupBuses();
    const [kana, raw, stage] = await Promise.all([loadJSON('data/kana.json'), loadJSON(`data/${CHART}.json`), loadJSON('assets/stage.json')]);
    const [images] = await Promise.all([loadImages(stage), fontsReady()]);
    S.ch = buildChart(raw, kana);
    Rn.initRender(canvas, stage, images, { debug: DEBUG });
    Rn.setChart(S.ch);
    attachInput(canvas, Rn.getLayout, { onPress, onRelease, onPausePress, keysEnabled: () => S.state === 'play' || S.state === 'calib' });
    window.addEventListener('resize', () => Rn.resize());
    if (window.visualViewport) window.visualViewport.addEventListener('resize', () => Rn.resize());
    document.addEventListener('visibilitychange', () => { if (document.hidden && S.state === 'play') pause(); });
    UI.init({ start, resume, restart, quit, retry, home, optionsChanged, calibTap, calibSkip, calibAgain, calibGo, recalib });
    S.state = 'title'; UI.show('title');
    requestAnimationFrame(frame);
    // 소리: 곡(파일 또는 임시 반주)을 먼저, 그다음 효과음 재료(곡 크기를 알아야 효과음 크기를 정함)
    const t0 = performance.now();
    S.song = await A.makeSong(S.ch, new URL('.', location.href));
    await A.makeBank(S.ch);
    S.prepMs = Math.round(performance.now() - t0);
    S.ready = true;
    UI.setStatus(S.song.source === 'file' ? '' : '임시 반주 · 임시 목소리', true);
    if (S.startWanted) afterUnlock();
    window.__ttb.resume = resume; window.__ttb.freezeAt = null;
  } catch (e) {
    S.err = String(e && e.stack || e);
    console.error(e);
    UI.setStatus('불러오기 실패 · 로컬 서버로 열었는지 확인', false);
  }
}

// ── 흐름 ───────────────────────────────
function start() {
  Clock.unlock();                 // 첫 터치 안에서 소리 잠금 풀기(아이폰)
  if (!S.ready) { S.startWanted = true; UI.setStatus('소리 준비 중', false); return; }
  afterUnlock();
}
function afterUnlock() {
  S.startWanted = false;
  if (!settings.calibrated && !AUTOPLAY) startCalib();
  else startPlay();
}

function startPlay() {
  stopCalib();
  S.judge = createJudge(S.ch);
  Rn.resetVisuals(); Rn.setIdlePose(null);
  A.resetTails(); A.comboReset();
  S.comboOpen = false; S.auto.i = 0; S.missBuf.length = 0; S.worstFrame = 0; S.frameGaps.length = 0;
  for (const g of S.ch.wordGroups) g.shown = false;
  if (PROBE) Rn.enableProbe(true);
  Clock.startSong([{ buffer: S.song.song, gainNode: A.bus.song }, { buffer: S.song.combo, gainNode: A.bus.combo }], S.ch.song.offset || 0, 0, 0.6);
  S.state = 'play';
  UI.show(null);
}

function finish() {
  Clock.stopSong();
  A.comboReset();
  S.state = 'result';
  Rn.setIdlePose('hana_photo');
  const J = S.judge, ch = S.ch;
  const hits = J.log.filter(l => l.res !== 'MISS');
  const stamped = new Set(hits.map(l => l.k));
  const avg = hits.length ? Math.round(hits.reduce((a, l) => a + l.delta, 0) / hits.length) : null;
  S.result = { counts: Object.assign({}, J.counts), maxCombo: J.maxCombo, total: ch.notes.length, good: J.goodOrBetter(), avgMs: avg, log: J.log.slice() };
  UI.showResult({
    good: J.goodOrBetter(), total: ch.notes.length, need: ch.pass.need, pass: J.goodOrBetter() >= ch.pass.need,
    counts: J.counts, maxCombo: J.maxCombo, avgMs: avg, letters: Array.from(ch.letters), stamped, info: ch.info,
  });
}

function pause() {
  if (S.state !== 'play') return;
  S.pausedT = Clock.songTime();
  Clock.pauseSong();
  S.state = 'pause';
  UI.show('pause');
}
function resume() {
  if (S.state !== 'pause') return;
  Clock.resumeSong();
  S.state = 'play';
  UI.show(null);
}
function restart() { Clock.resumeSong(); Clock.stopSong(); startPlay(); }
function quit() { Clock.resumeSong(); Clock.stopSong(); home(); }
function retry() { startPlay(); }
function home() { S.state = 'title'; Rn.setIdlePose(null); UI.show('title'); }
function optionsChanged() { A.applySfxLevel(); Rn.setChart(S.ch); UI.refreshOffset(); }
function onPausePress() { if (S.state === 'play') pause(); else if (S.state === 'pause') resume(); }

// ── 누름(원칙 3: 소리 먼저, 그 자리에서) ───────────────────
function onPress(side, e) {
  if (S.state === 'calib') { calibTap(e); return; }
  if (S.state !== 'play') return;
  Clock.sync();
  const tHeard = Clock.songTimeOfEvent(e);
  const tJ = tHeard - off();
  const r = S.judge.press(side, tJ);
  if (!r) { A.hitNow(side, 'EMPTY'); Rn.pressVisual(side, true, tHeard); return; }
  A.hitNow(side, r.res, r.note.k);
  vibrate(r.res, (r.note.t + S.ch.beat / 4 - tJ) * 1000);
  Rn.pressVisual(side, true, tHeard);
  afterJudge(r, tHeard);
}
function onRelease(side) {
  if (S.state === 'play' || S.state === 'pause') Rn.pressVisual(side, false, S.state === 'play' ? Clock.songTime() : S.pausedT);
}

function afterJudge(r, tNow) {
  const ch = S.ch, J = S.judge;
  Rn.judgeVisual(r, tNow, r.note.btn);
  Rn.setCombo(J.combo);
  fadeRecord(r.note.k, r.res !== 'MISS');
  if (r.res === 'PERFECT' || r.res === 'GREAT') A.tails(r.res, r.note.t, ch);
  if (r.res === 'MISS') {
    if (J.wantGag(r.note)) {
      const nb = Math.ceil((tNow + 0.02) / ch.beat) * ch.beat;   // 다음 박
      A.gagAt(nb); Rn.gagVisual(nb);
    }
    if (S.comboOpen) { A.comboLayer(false, nextBar(tNow), ch.beat); S.comboOpen = false; }
  } else if (!S.comboOpen && J.combo >= 10) {
    A.comboLayer(true, nextBar(tNow), ch.beat); S.comboOpen = true;
  }
  // 낱말 완성: 그 낱말의 노트를 모두 GOOD 이상으로
  for (const gr of ch.wordGroups) {
    if (gr.shown || !gr.notes.includes(r.note)) continue;
    if (gr.notes.every(n => n.judged)) {
      gr.shown = true;
      if (gr.notes.every(n => n.res !== 'MISS')) Rn.wordCompleteVisual(gr.word, tNow);
    }
  }
}
function nextBar(t) { return Math.ceil((t + 0.02) / S.ch.bar) * S.ch.bar; }

// ── 자동 누름(시험용): 노트 시각 + 보정 + lag 에 맞춰 진짜 pointerdown 이벤트를 보냄 ─────
function autoplayTick(t) {
  const notes = S.ch.notes;
  while (S.auto.i < notes.length && notes[S.auto.i].t + off() + AUTOLAG - t < 0.3) {
    const n = notes[S.auto.i++];
    const targetHeard = Clock.transport.startCtx + n.t + off() + AUTOLAG;
    const fire = () => {
      if (S.state !== 'play') return;
      const perfT = Clock.perfOfHeard(targetHeard);
      const wait = perfT - performance.now();
      if (wait > 4) { setTimeout(fire, wait - 3); return; }
      while (performance.now() < perfT) { /* 3ms 안 맞춤 */ }
      dispatchPointer(n.btn);
    };
    fire();
  }
}
function dispatchPointer(side) {
  const L = Rn.getLayout();
  const x = L.ox + Rn.LAY.btnX[side] * L.s, y = L.oy + Rn.LAY.btnY * L.s;
  const id = side === 'L' ? 51 : 52;
  canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, pointerId: id, pointerType: 'touch', bubbles: true, cancelable: true, isPrimary: true }));
  setTimeout(() => canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, pointerId: id, pointerType: 'touch', bubbles: true })), 70);
}

// ── 지연 보정: 박에 맞춰 8번 ───────────────────────
function startCalib() {
  S.state = 'calib';
  UI.calibReset(); UI.show('calib');
  const ctx = Clock.getCtx();
  const t0 = ctx.currentTime + 0.8;
  S.calib = { t0, beat: 0.5, taps: [], scheduled: 0, srcs: [], done: false };
  scheduleMetro(16);
}
function scheduleMetro(n) {
  const c = S.calib;
  for (let k = c.scheduled; k < c.scheduled + n; k++) A.metro(c.t0 + k * c.beat, k % 4 === 0);
  c.scheduled += n;
}
function stopCalib() { if (S.calib) S.calib.done = true; }
function calibTap(e) {
  const c = S.calib; if (!c || c.done || S.state !== 'calib') return;
  Clock.sync();
  A.hitNow('L', 'GREAT', null);
  const th = Clock.eventHeard(e);
  const k = Math.round((th - c.t0) / c.beat);
  if (k < 4) return;                         // 처음 4박은 듣기만
  const d = th - (c.t0 + k * c.beat);
  if (Math.abs(d) > 0.25) return;
  c.taps.push(d);
  UI.calibProgress(c.taps.length);
  if (c.taps.length >= 8) {
    const s = c.taps.slice().sort((a, b) => a - b).slice(1, 7);   // 가장 이르고 늦은 것 하나씩 뺌
    const ms = Math.round(s.reduce((a, b) => a + b, 0) / s.length * 1000);
    settings.offsetMs = Math.max(-300, Math.min(300, ms)); settings.calibrated = true; saveSettings();
    c.done = true;
    UI.calibDone(settings.offsetMs);
  }
}
function calibSkip() { settings.calibrated = true; saveSettings(); stopCalib(); startPlay(); }
function calibAgain() { startCalib(); }
function calibGo() { startPlay(); }
function recalib() { Clock.unlock(); if (S.ready) startCalib(); }

// ── 매 프레임 ───────────────────────────────
function frame(now, fromTimer) {
  if (!fromTimer) { requestAnimationFrame(frame); S.rafNow = performance.now(); }
  else S.timerFrames = (S.timerFrames || 0) + 1;
  // fps·끊김 기록
  if (S.lastNow) {
    const gap = now - S.lastNow;
    if (S.state === 'play') { if (gap > S.worstFrame) S.worstFrame = gap; if (S.frameGaps.length < 4000) S.frameGaps.push(gap); }
  }
  S.lastNow = now; S.frames++;
  if (now - S.fpsT > 1000) { S.fps = Math.round(S.frames * 1000 / (now - S.fpsT)); S.frames = 0; S.fpsT = now; }

  if (S.state === 'play') {
    Clock.sync();
    const t = Clock.songTime(); S.t = t;
    // 시험용: 정한 곡 시각에서 화면을 멈춤(메뉴 없이). window.__ttb.freezeAt = 초, 이어 가기는 __ttb.resume()
    if (window.__ttb.freezeAt != null && t >= window.__ttb.freezeAt) {
      window.__ttb.freezeAt = null; S.pausedT = t; Clock.pauseSong(); S.state = 'pause';
      Rn.draw(t, 'pause', null); return;
    }
    const misses = S.judge.sweep(t - off(), S.missBuf);
    for (let i = 0; i < misses.length; i++) afterJudge(misses[i], t);
    if (AUTOPLAY) autoplayTick(t);
    Rn.draw(t, 'play', DEBUG ? { fps: S.fps, offsetMs: settings.offsetMs, lat: latText() } : null);
    if (t > S.ch.end + (S.ch.song.tail || 1.2)) finish();
  } else if (S.state === 'pause') {
    Rn.draw(S.pausedT, 'pause', null);
  } else {
    if (S.state === 'calib' && S.calib && !S.calib.done) {
      Clock.sync();
      const c = S.calib, ph = (Clock.heardNow() - c.t0) / c.beat;
      const k = Math.floor(ph), frac = ph - k;
      UI.calibPulse(ph >= 0 && frac < 0.18, k % 4 === 0);
      if (c.scheduled - ph < 6) scheduleMetro(8);
    }
    if (S.ch) Rn.draw(now / 1000, 'idle', null);
  }
}
// 안전장치: 그리기 신호(requestAnimationFrame)가 100ms 넘게 안 오면(창이 가려진 미리보기 등) 타이머로 판정·그리기를 이어 감
setInterval(() => {
  const now = performance.now();
  if (S.ch && now - (S.rafNow || 0) > 100) frame(now, true);
}, 16);

function latText() { const d = Clock.debugInfo(); return Math.round(((d.outputLatency || 0) + (d.baseLatency || 0)) * 1000) + 'ms'; }

boot();
