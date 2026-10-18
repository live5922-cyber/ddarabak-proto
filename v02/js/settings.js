// settings.js · 설정·기록 (브라우저 저장소. 못 쓰면 기본값으로 그냥 돎)
const KEY = 'ttb.v02.settings';
const REC_KEY = 'ttb.v02.records';
const FADE_KEY = 'ttb.v02.fade';

export const DEFAULTS = {
  judge: 'normal',    // 판정: loose · normal · strict
  sound: 'ko',        // 글자 소리 표시: ko · ko+ro · ro · off
  meaning: true,      // 뜻 표시
  voice: true,        // 맞히면 글자 목소리(VOICEVOX:雨晴はう, 시험판 임시)
  fade: true,         // 익숙해지면 소리 줄 흐리게(날짜 기준)
  vib: 'mid',         // 진동: off · low · mid · high
  sfx: 'mid',         // 효과음 크기: low(−4dB) · mid · high(+3dB)
  motion: 'full',     // 움직임: full · less(움직임 줄이기)
  offsetMs: 0,        // 소리 지연 보정(ms). +면 늦게 치는 만큼 판정을 늦춤
  visualMs: 0,        // 화면 지연 보정(ms). +면 노트를 그만큼 앞서 그림(폰 화면 표시 지연, 리듬 검토 I5)
  calibrated: false,
};
function readJSON(k) { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
function writeJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 못 해도 게임은 계속 */ } }

export const settings = Object.assign({}, DEFAULTS, readJSON(KEY) || {});
export function saveSettings() { writeJSON(KEY, settings); }

export const SOUND_CYCLE = ['ko', 'ko+ro', 'ro', 'off'];
export const SOUND_LABEL = { 'ko': '한글', 'ko+ro': '한글 + 로마자', 'ro': '로마자', 'off': '끔' };
export function cycleSound() { settings.sound = SOUND_CYCLE[(SOUND_CYCLE.indexOf(settings.sound) + 1) % SOUND_CYCLE.length]; saveSettings(); return settings.sound; }

// 판별 최고 기록 { '1': { medal: 0~3, good, total, perfect } }
export const records = readJSON(REC_KEY) || {};
export function saveRecord(pan, r) {
  const o = records[pan];
  if (!o || r.medal > o.medal || (r.medal === o.medal && r.good > o.good)) records[pan] = r;
  writeJSON(REC_KEY, records);
}

// 소리 줄 흐려짐(일본어 검토 2-5 · 7번): 박자 판정과 상관없이 '그 글자를 GOOD 이상으로 친 날 수'로 정함.
// 친 날 1일 = 100%, 2~3일 = 35%, 4일 넘으면 0%(자리는 남김). MISS로 되돌리지 않음.
const fade = readJSON(FADE_KEY) || {};
function today() { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
export function fadeAlpha(kana) {
  if (!settings.fade) return 1;
  const f = fade[kana]; const n = f ? f.days.length : 0;
  return n >= 4 ? 0 : n >= 2 ? 0.35 : 1;
}
export function fadeRecord(kana) {
  const d = today(); let f = fade[kana]; if (!f) { f = { days: [] }; fade[kana] = f; }
  if (!f.days.includes(d)) { f.days.push(d); writeJSON(FADE_KEY, fade); }
}
export function fadeReset() { for (const k in fade) delete fade[k]; writeJSON(FADE_KEY, fade); }
