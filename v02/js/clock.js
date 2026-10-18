// clock.js · Web Audio 시계 하나로 모든 것을 맞춤 (v0.1에서 가져와 다듬음)
// - 곡·효과음은 모두 같은 AudioContext 시간표 위에 놓음.
// - '들리는 시각'(heard): 지금 스피커에서 나오는 소리의 ctx 시각. 화면·판정은 이 값을 씀.
// - songTime 0 = 곡 파일 0초. 채보 시각도 곡 파일 초.
let ctx = null;
let offEMA = null;
let lastRaw = 0;
let freshAfter = 0;

export function getCtx() { return ctx; }
// 소리 끊김(전화·알람·블루투스 바뀜)으로 컨텍스트가 멈추면 알림(소리 검토 I5)
export function onState(fn) { if (ctx) ctx.onstatechange = () => fn(ctx.state); }
export function createContext() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); }
  return ctx;
}
// 첫 터치 안에서 부름(아이폰 소리 잠금 풀기)
export function unlock() {
  if (!ctx) createContext();
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* 없음 */ }
  const p = ctx.state !== 'running' ? ctx.resume() : Promise.resolve();
  try { const b = ctx.createBuffer(1, 1, ctx.sampleRate); const s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0); } catch (e) { /* 무시 */ }
  offEMA = null;
  return p;
}
export function outputLatency() { return ctx ? (ctx.outputLatency || 0) + (ctx.baseLatency || 0) : 0; }

function rawOffset() {
  if (ctx.getOutputTimestamp && ctx.state === 'running') {
    const ts = ctx.getOutputTimestamp();
    if (ts && ts.performanceTime > freshAfter && ts.contextTime > 0 && performance.now() - ts.performanceTime < 100) {
      return ts.contextTime - ts.performanceTime / 1000;
    }
  }
  return ctx.currentTime - outputLatency() - performance.now() / 1000;
}
// 매 프레임·매 터치에서 부름. 흔들림을 줄이려 천천히 따라가고 15ms 넘게 벗어나면 바로 맞춤
export function sync() {
  if (!ctx) return;
  const o = rawOffset(); lastRaw = o;
  if (offEMA === null || Math.abs(o - offEMA) > 0.015) offEMA = o; else offEMA += (o - offEMA) * 0.1;
}
export function resetSync() { offEMA = null; freshAfter = performance.now(); }
export function heardAt(perfMs) { if (offEMA === null) sync(); return perfMs / 1000 + offEMA; }
export function heardNow() { return heardAt(performance.now()); }
export function perfOfHeard(h) { if (offEMA === null) sync(); return (h - offEMA) * 1000; }
export function eventHeard(e) {
  let ts = e && e.timeStamp; const now = performance.now();
  if (!(ts > 0) || Math.abs(now - ts) > 1000) ts = now;
  return heardAt(ts);
}
export function debugInfo() {
  if (!ctx) return {};
  return { sampleRate: ctx.sampleRate, state: ctx.state, baseLatency: ctx.baseLatency || 0, outputLatency: ctx.outputLatency || 0,
    hasOutputTimestamp: !!ctx.getOutputTimestamp, offsetFiltered: offEMA, offsetRaw: lastRaw };
}

// ── 곡 재생 운반대 ─────────────────────────
export const transport = { startCtx: 0, playing: false, src: null, gain: null };
export function songTime() { return heardNow() - transport.startCtx; }
export function songTimeOfEvent(e) { return eventHeard(e) - transport.startCtx; }
export function ctxOfSong(t) { return transport.startCtx + t; }

// buffer 를 fromSongTime 부터 재생. 시작 20ms만 소리를 키워 올림(곡 중간에서 시작할 때 '딱' 소리 막기). 이후 크기 변화 0.
export function startSong(buffer, out, fromSongTime, leadIn) {
  stopSong();
  const when = ctx.currentTime + (leadIn == null ? 0.25 : leadIn);
  transport.startCtx = when - fromSongTime;
  const g = ctx.createGain();
  g.gain.setValueAtTime(fromSongTime > 0.05 ? 0 : 1, when);
  g.gain.linearRampToValueAtTime(1, when + 0.02);
  g.connect(out);
  const s = ctx.createBufferSource(); s.buffer = buffer; s.connect(g);
  s.start(when, Math.max(0, fromSongTime));
  transport.src = s; transport.gain = g; transport.playing = true;
  resetSync();
  return when;
}
export function stopSong() {
  const s = transport.src, g = transport.gain;
  if (s) { try { s.stop(); } catch (e) { /* 이미 멈춤 */ } try { s.disconnect(); } catch (e) {} }
  if (g) { try { g.disconnect(); } catch (e) {} }
  transport.src = null; transport.gain = null; transport.playing = false;
}
