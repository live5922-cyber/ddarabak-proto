// clock.js · Web Audio 시계 하나로 모든 것을 맞춤
// - 곡·효과음은 모두 같은 AudioContext 시간표 위에 놓음.
// - '들리는 시각'(heard): 지금 스피커에서 나오는 소리의 AudioContext 시각. 화면·판정은 이 값을 씀.
// - requestAnimationFrame은 그리기만 함. 시간은 늘 여기서 읽음.

let ctx = null;
let offEMA = null;       // (들리는 ctx 시각) − (performance.now 초)
let lastRaw = 0;
let freshAfter = 0;      // 이 performance 시각 뒤에 찍힌 출력 시각만 믿음(멈춤·이어 가기 직후의 묵은 값 버림)

export function getCtx() { return ctx; }

export function createContext() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  try { ctx = new AC({ latencyHint: 'interactive' }); }
  catch (e) { ctx = new AC(); }
  return ctx;
}

// 첫 터치 안에서 불러야 함(아이폰 소리 잠금 풀기). resume을 먼저, 동기로 부름.
export function unlock() {
  if (!ctx) createContext();
  // 아이폰: 무음 스위치를 켜도 게임 소리가 나게(사파리 16.4 이상만 있음, 없으면 넘어감)
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* 무시 */ }
  const p = ctx.state !== 'running' ? ctx.resume() : Promise.resolve();
  try {
    const b = ctx.createBuffer(1, 1, ctx.sampleRate);
    const s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0);
  } catch (e) { /* 무시 */ }
  offEMA = null;
  return p;
}

// 출력 지연 추정(초). getOutputTimestamp가 없을 때만 씀.
export function outputLatency() {
  if (!ctx) return 0;
  return (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
}

function rawOffset() {
  // 1순위: 출력 장치가 지금 내보내는 샘플의 시각(출력 지연이 이미 들어 있음)
  if (ctx.getOutputTimestamp && ctx.state === 'running') {
    const ts = ctx.getOutputTimestamp();
    if (ts && ts.performanceTime > freshAfter && ts.contextTime > 0 && performance.now() - ts.performanceTime < 100) {
      return ts.contextTime - ts.performanceTime / 1000;
    }
  }
  // 2순위: 지금 그리는 시각 − 출력 지연(오디오가 아직 다시 안 돌면 currentTime이 멈춰 있어 곡 시각도 멈춤)
  return ctx.currentTime - outputLatency() - performance.now() / 1000;
}

// 매 프레임·매 터치에서 부름. 흔들림을 줄이려고 천천히 따라감, 30ms 넘게 벗어나면 바로 맞춤.
export function sync() {
  if (!ctx) return;
  const o = rawOffset();
  lastRaw = o;
  if (offEMA === null || Math.abs(o - offEMA) > 0.015) offEMA = o;
  else offEMA += (o - offEMA) * 0.1;
}
export function resetSync() { offEMA = null; freshAfter = performance.now(); }

// performance.now(ms) → 그때 들리던 ctx 시각(초)
export function heardAt(perfMs) {
  if (offEMA === null) sync();
  return perfMs / 1000 + offEMA;
}
export function heardNow() { return heardAt(performance.now()); }
// ctx 들리는 시각(초) → performance.now(ms)
export function perfOfHeard(ctxHeard) {
  if (offEMA === null) sync();
  return (ctxHeard - offEMA) * 1000;
}

// 이벤트(터치·키) 시각 → 들리던 ctx 시각
export function eventHeard(e) {
  let ts = e && e.timeStamp;
  const now = performance.now();
  if (!(ts > 0) || Math.abs(now - ts) > 1000) ts = now;   // 옛 브라우저(시각 기준이 다름) 대비
  return heardAt(ts);
}

export function debugInfo() {
  if (!ctx) return {};
  return {
    sampleRate: ctx.sampleRate, state: ctx.state,
    baseLatency: ctx.baseLatency || 0, outputLatency: ctx.outputLatency || 0,
    hasOutputTimestamp: !!ctx.getOutputTimestamp,
    offsetFiltered: offEMA, offsetRaw: lastRaw,
  };
}

// ── 곡 재생(한 줄짜리 운반대) ─────────────────────────
// songTime 0 = 1마디 1박. 곡 파일 시각 = songTime + song.offset
export const transport = {
  startCtx: 0,       // songTime 0이 놓인 ctx 시각
  playing: false,
  paused: false,
  sources: [],
};

export function songTime() { return heardNow() - transport.startCtx; }
export function songTimeOfEvent(e) { return eventHeard(e) - transport.startCtx; }
export function ctxOfSong(t) { return transport.startCtx + t; }

// buffers: [{ buffer, gainNode }] 같은 시각에 함께 시작(곡 + 콤보 반주 층)
export function startSong(layers, fileOffset, fromSongTime, leadIn) {
  stopSong();
  const when = ctx.currentTime + (leadIn || 0.4);
  transport.startCtx = when - fromSongTime;
  for (const L of layers) {
    if (!L.buffer) continue;
    const s = ctx.createBufferSource();
    s.buffer = L.buffer;
    s.connect(L.gainNode);
    s.start(when, Math.max(0, fromSongTime + fileOffset));
    transport.sources.push(s);
  }
  transport.playing = true; transport.paused = false;
  resetSync();
}

export function stopSong() {
  for (const s of transport.sources) { try { s.stop(); } catch (e) {} try { s.disconnect(); } catch (e) {} }
  transport.sources.length = 0;
  transport.playing = false; transport.paused = false;
}

// 일시정지: ctx 시계 자체를 멈춤 → 곡·예약된 소리·화면이 함께 멈추고 그대로 이어짐
export function pauseSong() {
  if (!transport.playing || transport.paused) return Promise.resolve();
  transport.paused = true;
  return ctx.suspend();
}
export function resumeSong() {
  if (!transport.paused) return Promise.resolve();
  const p = ctx.resume();
  transport.paused = false;
  resetSync();
  return p;
}
