// ui.js · 메뉴 화면(DOM). 연주 중에는 설명 글을 띄우지 않음.
import { settings, saveSettings, SOUND_LABEL, SOUND_CYCLE, cycleSound, fadeReset } from './settings.js';
import { canVibrate } from './haptics.js';

const $ = id => document.getElementById(id);
let H = {};
let backFromSettings = 'title';

export function init(handlers) {
  H = handlers;
  $('btn-start').addEventListener('click', () => H.start());
  $('btn-settings1').addEventListener('click', () => openSettings('title'));
  $('btn-resume').addEventListener('click', () => H.resume());
  $('btn-restart').addEventListener('click', () => H.restart());
  $('btn-settings2').addEventListener('click', () => openSettings('pause'));
  $('btn-quit').addEventListener('click', () => H.quit());
  $('chip-sound').addEventListener('click', () => { cycleSound(); refreshChip(); H.optionsChanged(); });
  $('btn-retry').addEventListener('click', () => H.retry());
  $('btn-home').addEventListener('click', () => H.home());
  $('btn-calib-skip').addEventListener('click', () => H.calibSkip());
  $('btn-calib-again').addEventListener('click', () => H.calibAgain());
  $('btn-calib-go').addEventListener('click', () => H.calibGo());
  $('btn-set-close').addEventListener('click', () => { show(backFromSettings); H.optionsChanged(); });
  $('btn-recalib').addEventListener('click', () => H.recalib());
  $('calib-pad').addEventListener('pointerdown', e => { e.preventDefault(); H.calibTap(e); });
  buildSettings();
  refreshChip();
}

export function show(name) {
  for (const el of document.querySelectorAll('.scr')) el.hidden = el.id !== 'scr-' + name;
  document.body.dataset.scr = name || 'play';
}

export function setStatus(text, ready) {
  $('load-status').textContent = text;
  $('btn-start').classList.toggle('wait', !ready);
}

function refreshChip() { $('chip-sound').textContent = '가 · A  ' + SOUND_LABEL[settings.sound]; }

// ── 설정 ───────────────────────────────
const SEG = [
  { key: 'sound', label: '글자 소리', opts: SOUND_CYCLE.map(v => [v, SOUND_LABEL[v]]) },
  { key: 'meaning', label: '뜻', opts: [[true, '켬'], [false, '끔']] },
  { key: 'fade', label: '익숙해지면 소리 흐리게', opts: [[true, '켬'], [false, '끔']] },
  { key: 'sfx', label: '치는 소리 크기', opts: [['low', '작게'], ['mid', '보통'], ['high', '크게']] },
  { key: 'vib', label: '진동', opts: [['off', '끔'], ['low', '약'], ['mid', '보통'], ['high', '강']], vib: true },
];
function buildSettings() {
  const box = $('set-rows'); box.innerHTML = '';
  for (const s of SEG) {
    const row = document.createElement('div'); row.className = 'row';
    const lab = document.createElement('div'); lab.className = 'lab'; lab.textContent = s.label; row.appendChild(lab);
    if (s.vib && !canVibrate) {
      const p = document.createElement('div'); p.className = 'note'; p.textContent = '이 브라우저에서는 진동이 안 됨. 앱에서 됨'; row.appendChild(p);
    } else {
      const seg = document.createElement('div'); seg.className = 'seg';
      for (const [v, t] of s.opts) {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = t;
        b.setAttribute('aria-pressed', String(settings[s.key] === v));
        b.addEventListener('click', () => {
          settings[s.key] = v; saveSettings();
          for (const x of seg.children) x.setAttribute('aria-pressed', 'false');
          b.setAttribute('aria-pressed', 'true');
          refreshChip(); H.optionsChanged();
        });
        seg.appendChild(b);
      }
      row.appendChild(seg);
    }
    box.appendChild(row);
  }
  // 지연 보정
  const row = document.createElement('div'); row.className = 'row';
  row.innerHTML = '<div class="lab">지연 보정</div><div class="offset"><button type="button" data-d="-10">−10</button><output id="offset-val"></output><button type="button" data-d="10">+10</button></div>';
  box.appendChild(row);
  row.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    settings.offsetMs = Math.max(-300, Math.min(300, settings.offsetMs + Number(b.dataset.d))); saveSettings(); refreshOffset();
  }));
  refreshOffset();
  $('btn-fade-reset').onclick = () => { fadeReset(); H.optionsChanged(); $('btn-fade-reset').textContent = '흐려짐 기록 지움'; };
}
export function refreshOffset() { const o = $('offset-val'); if (o) o.textContent = (settings.offsetMs > 0 ? '+' : '') + settings.offsetMs + 'ms'; }
function openSettings(from) { backFromSettings = from; buildSettings(); show('settings'); }

// ── 지연 보정 화면 ─────────────────────────────
export function calibReset() {
  $('calib-dots').innerHTML = '<i></i>'.repeat(8);
  $('calib-result').textContent = '';
  $('calib-after').hidden = true;
  $('calib-pad').classList.remove('done');
}
export function calibProgress(n) {
  const dots = $('calib-dots').children;
  for (let i = 0; i < dots.length; i++) dots[i].classList.toggle('on', i < n);
}
export function calibPulse(on, first) {
  const p = $('calib-pad');
  p.classList.toggle('beat', on); p.classList.toggle('first', !!first);
}
export function calibDone(ms) {
  $('calib-result').textContent = '보정값 ' + (ms > 0 ? '+' : '') + ms + 'ms';
  $('calib-after').hidden = false;
  $('calib-pad').classList.add('done');
}

// ── 결과 ───────────────────────────────
export function showResult(r) {
  $('res-hit').textContent = r.good + ' / ' + r.total;
  $('res-pass').textContent = r.pass ? '통과 · 판 2 열림' : '한 번 더 · ' + r.need + '개 이상 맞히면 통과';
  $('res-pass').className = r.pass ? 'pass ok' : 'pass';
  for (const k of ['PERFECT', 'GREAT', 'GOOD', 'MISS']) $('res-' + k).textContent = r.counts[k];
  $('res-combo').textContent = r.maxCombo;
  $('res-avg').textContent = r.avgMs === null ? '–' : (r.avgMs > 0 ? '+' : '') + r.avgMs + 'ms';
  const box = $('res-kana'); box.innerHTML = '';
  for (const k of r.letters) {
    const c = document.createElement('div'); c.className = 'kc' + (r.stamped.has(k) ? ' st' : '');
    c.innerHTML = `<b class="jp">${k}</b><span>${r.info(k).ko}</span>`;
    box.appendChild(c);
  }
  show('result');
}
