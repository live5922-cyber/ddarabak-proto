// haptics.js · 판정별 진동(웹 navigator.vibrate). 아이폰 사파리는 진동이 없어 조용히 넘어감.
// 표(기획안 v0.5 6절 '웹 · S25+'): PERFECT [14, 간격−14, 8] · GREAT [12] · GOOD [8] · MISS(눌렀음) [25, 60, 25]
// 설정: 끔 / 약(PERFECT·MISS만) / 보통(표 그대로) / 강(길이 × 1.5). 누른 처리 안에서 바로 부름.
import { settings } from './settings.js';

export const canVibrate = typeof navigator !== 'undefined' && 'vibrate' in navigator;

// gapMs: PERFECT 두 번째 '톡'까지 남은 시간 = (노트 시각 + 1/16박) − 누른 시각
export function vibrate(res, gapMs) {
  if (!canVibrate || settings.vib === 'off') return;
  if (settings.vib === 'low' && res !== 'PERFECT' && res !== 'MISS') return;
  const k = settings.vib === 'high' ? 1.5 : 1;
  let p = null;
  if (res === 'PERFECT') {
    const a = Math.round(14 * k), b = Math.round(8 * k);
    const gap = Math.max(40, Math.round(gapMs) - a);   // 펄스 사이 40ms 이상 띄워야 둘로 느껴짐
    p = [a, gap, b];
  } else if (res === 'GREAT') p = [Math.round(12 * k)];
  else if (res === 'GOOD') p = [Math.round(8 * k)];
  else if (res === 'MISS') p = [Math.round(25 * k), 60, Math.round(25 * k)];
  if (!p) return;
  try { navigator.vibrate(p); } catch (e) { /* 무시 */ }
}
