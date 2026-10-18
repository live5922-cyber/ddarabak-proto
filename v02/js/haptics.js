// haptics.js · 판정별 진동(웹 navigator.vibrate). 아이폰 사파리는 진동이 없어 조용히 넘어감(앱에서 됨).
// 무늬(기획안 v0.5 6절): PERFECT [14, 간격, 8] · GREAT [12] · GOOD [8] · MISS(눌렀음) [25, 60, 25]
// 누르고 있기: 머리 [10] → 박마다 [4] → 뗌 성공 [10, 40, 16] · 셔터 [6, 30, 22]
import { settings } from './settings.js';
export const canVibrate = typeof navigator !== 'undefined' && 'vibrate' in navigator;
let muted = false;
export function setHapticsMuted(m) { muted = !!m; }

function go(p) { if (!canVibrate || muted || settings.vib === 'off' || !p) return; try { navigator.vibrate(p); } catch (e) { /* 무시 */ } }
function k() { return settings.vib === 'high' ? 1.5 : 1; }

// gapMs: PERFECT 두 번째 톡까지(노트 + 1/16박 − 누른 시각)
export function vibrate(res, gapMs) {
  if (settings.vib === 'low' && res !== 'PERFECT' && res !== 'MISS') return;
  const m = k();
  if (res === 'PERFECT') { const a = Math.round(14 * m), b = Math.round(8 * m); go([a, Math.max(40, Math.round(gapMs) - a), b]); }
  else if (res === 'GREAT') go([Math.round(12 * m)]);
  else if (res === 'GOOD') go([Math.round(8 * m)]);
  else if (res === 'MISS') go([Math.round(25 * m), 60, Math.round(25 * m)]);
}
export function vibrateHold(kind) {
  if (settings.vib === 'low' && kind === 'tick') return;
  const m = k();
  if (kind === 'tick') go([Math.round(4 * m)]);
  else if (kind === 'release') go([Math.round(10 * m), 40, Math.round(16 * m)]);
  else if (kind === 'shutter') go([Math.round(6 * m), 30, Math.round(22 * m)]);
  else if (kind === 'stop') { if (canVibrate) try { navigator.vibrate(0); } catch (e) {} }
}
