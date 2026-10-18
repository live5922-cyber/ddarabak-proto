// settings.js · 설정과 글자별 흐려짐 기록 (브라우저 저장소. 못 쓰면 기본값으로 그냥 돎)
const KEY = 'ttb.v01.settings';
const FADE_KEY = 'ttb.v01.fade';

export const DEFAULTS = {
  sound: 'ko',        // 글자 소리 표시: 'ko' 한글 · 'ko+ro' 한글 + 로마자 · 'ro' 로마자 · 'off' 끔
  meaning: true,      // 뜻 표시
  fade: true,         // 3번 이어 맞히면 소리 줄이 흐려짐
  vib: 'mid',         // 진동: 'off' · 'low' · 'mid' · 'high'
  sfx: 'mid',         // 효과음 크기: 'low'(−4dB) · 'mid' · 'high'(+4dB)
  offsetMs: 0,        // 지연 보정(ms). +면 내가 늦게 치는 만큼 판정을 늦춰 줌
  calibrated: false,  // 지연 보정을 한 번이라도 했는지
};

function readJSON(key) {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : null; } catch (e) { return null; }
}
function writeJSON(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* 저장 못 해도 게임은 계속 */ }
}

export const settings = Object.assign({}, DEFAULTS, readJSON(KEY) || {});
export function saveSettings() { writeJSON(KEY, settings); }

export const SOUND_CYCLE = ['ko', 'ko+ro', 'ro', 'off'];
export const SOUND_LABEL = { 'ko': '한글', 'ko+ro': '한글 + 로마자', 'ro': '로마자', 'off': '끔' };
export function cycleSound() {
  const i = SOUND_CYCLE.indexOf(settings.sound);
  settings.sound = SOUND_CYCLE[(i + 1) % SOUND_CYCLE.length];
  saveSettings();
  return settings.sound;
}

// 글자별 흐려짐: level 0 = 100%, 1 = 35%, 2 = 0%(자리는 남김)
const fade = readJSON(FADE_KEY) || {};
const FADE_ALPHA = [1, 0.35, 0];
export function fadeAlpha(kana) {
  if (!settings.fade) return 1;
  const f = fade[kana];
  return f ? FADE_ALPHA[f.level] : 1;
}
export function fadeLevel(kana) {
  if (!settings.fade) return 0;
  const f = fade[kana];
  return f ? f.level : 0;
}
export function fadeRecord(kana, good) {
  let f = fade[kana];
  if (!f) { f = { streak: 0, level: 0 }; fade[kana] = f; }
  if (good) {
    f.streak++;
    if (f.streak >= 3) { f.level = Math.min(2, f.level + 1); f.streak = 0; }
  } else {
    f.streak = 0; f.level = 0;
  }
  writeJSON(FADE_KEY, fade);
}
export function fadeReset() {
  for (const k in fade) delete fade[k];
  writeJSON(FADE_KEY, fade);
}
