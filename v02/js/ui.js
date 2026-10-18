// ui.js · 메뉴 화면(DOM). 연주 중에는 설명 글을 띄우지 않음.
import { settings, saveSettings, SOUND_LABEL, SOUND_CYCLE, cycleSound, fadeReset, records } from './settings.js';
import { canVibrate } from './haptics.js';

const $ = id => document.getElementById(id);
let H = {}, backFromSettings = 'title';

export function init(handlers) {
  H = handlers;
  const on = (id, f) => $(id).addEventListener('click', e => { H.click && H.click(); f(e); });
  on('btn-start', () => H.start());
  on('btn-set1', () => openSettings('title'));
  on('btn-set2', () => openSettings('pause'));
  on('btn-set3', () => openSettings('select'));
  on('btn-sel-back', () => H.home());
  on('btn-resume', () => H.resume());
  on('btn-restart', () => H.restart());
  on('btn-quit', () => H.quit());
  on('chip-sound', () => { cycleSound(); refreshChip(); H.optionsChanged(); });
  on('btn-retry', () => H.retry());
  on('btn-res-sel', () => H.toSelect());
  on('btn-calib-skip', () => H.calibSkip());
  on('btn-calib-again', () => H.calibAgain());
  on('btn-calib-go', () => H.calibGo());
  on('btn-set-close', () => { show(backFromSettings); H.optionsChanged(); });
  on('btn-recalib', () => H.recalib());
  $('calib-pad').addEventListener('pointerdown', e => { e.preventDefault(); H.calibTap(e); });
  buildSettings(); refreshChip();
}
export function show(name) { document.body.dataset.scr = name || 'play'; }
export function current() { return document.body.dataset.scr; }
export function setStatus(text, ready) { $('load-status').textContent = text; $('btn-start').classList.toggle('wait', !ready); }
function refreshChip() { $('chip-sound').textContent = '가 · A  ' + SOUND_LABEL[settings.sound]; }

// ── 판 고르기 ─────────────────────────────
export function showSelect(pans) {
  const box = $('pan-list'); box.innerHTML = '';
  for (const p of pans) {
    const r = records[p.id] || { medal: 0 };
    const b = document.createElement('button'); b.type = 'button'; b.className = 'pan-card';
    const mm = '<span class="mini-medals">' + [1, 2, 3].map(i => '<i class="' + (r.medal >= i ? 'on' : '') + '"></i>').join('') + '</span>';
    b.innerHTML = `<span class="t">${p.name} · ${p.row}${mm}</span><span class="k">${p.letters.join(' ')}</span>` +
      `<span class="i">새 동작 · ${p.newMove} · ${p.len}</span><span class="go">시작</span>`;
    b.addEventListener('click', () => { H.click && H.click(); H.choosePan(p.id); });
    box.appendChild(b);
  }
  show('select');
}

// ── 설정 ─────────────────────────────
const SEG = [
  { key: 'judge', label: '판정', opts: [['loose', '느슨하게'], ['normal', '보통'], ['strict', '정확하게']] },
  { key: 'sound', label: '글자 소리 표시', opts: SOUND_CYCLE.map(v => [v, SOUND_LABEL[v]]) },
  { key: 'meaning', label: '뜻', opts: [[true, '켬'], [false, '끔']] },
  { key: 'voice', label: '맞히면 글자 목소리', opts: [[true, '켬'], [false, '끔']] },
  { key: 'fade', label: '익숙해지면 소리 줄 흐리게', opts: [[true, '켬'], [false, '끔']] },
  { key: 'sfx', label: '치는 소리 크기', opts: [['low', '작게'], ['mid', '보통'], ['high', '크게']] },
  { key: 'vib', label: '진동', opts: [['off', '끔'], ['low', '약'], ['mid', '보통'], ['high', '강']], vib: true },
  { key: 'motion', label: '움직임', opts: [['full', '보통'], ['less', '줄이기']] },
];
function buildSettings() {
  const box = $('set-rows'); box.innerHTML = '';
  for (const s of SEG) {
    const row = document.createElement('div'); row.className = 'row';
    row.innerHTML = `<div class="lab">${s.label}</div>`;
    if (s.vib && !canVibrate) { const p = document.createElement('div'); p.className = 'note'; p.textContent = '이 기기에서는 진동을 쓸 수 없어요'; row.appendChild(p); }
    else {
      const seg = document.createElement('div'); seg.className = 'seg';
      for (const [v, txt] of s.opts) {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = txt; b.setAttribute('aria-pressed', String(settings[s.key] === v));
        b.addEventListener('click', () => { settings[s.key] = v; saveSettings(); for (const x of seg.children) x.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-pressed', 'true'); refreshChip(); H.optionsChanged(); });
        seg.appendChild(b);
      }
      row.appendChild(seg);
    }
    box.appendChild(row);
  }
  const row = document.createElement('div'); row.className = 'row';
  row.innerHTML = '<div class="lab">소리 지연 보정 (+ = 늦게 쳐도 맞게)</div><div class="offset"><button type="button" data-d="-5">−5</button><output id="offset-val"></output><button type="button" data-d="5">+5</button></div>' +
    '<div class="lab" style="margin-top:10px">화면 지연 보정 (+ = 노트를 앞서 그림)</div><div class="offset"><button type="button" data-v="-5">−5</button><output id="visual-val"></output><button type="button" data-v="5">+5</button></div>';
  box.appendChild(row);
  row.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.d) settings.offsetMs = Math.max(-300, Math.min(300, settings.offsetMs + Number(b.dataset.d)));
    else settings.visualMs = Math.max(-100, Math.min(150, (settings.visualMs || 0) + Number(b.dataset.v)));
    saveSettings(); refreshOffset(); }));
  refreshOffset();
  $('btn-fade-reset').onclick = () => { fadeReset(); H.optionsChanged(); $('btn-fade-reset').textContent = '흐려짐 기록 지움'; };
}
export function refreshOffset() { const o = $('offset-val'); if (o) o.textContent = (settings.offsetMs > 0 ? '+' : '') + settings.offsetMs + 'ms'; const v = $('visual-val'); if (v) v.textContent = ((settings.visualMs || 0) > 0 ? '+' : '') + (settings.visualMs || 0) + 'ms'; }
function openSettings(from) { backFromSettings = from; buildSettings(); show('settings'); }

// ── 지연 보정 ─────────────────────────────
export function calibReset() { $('calib-dots').innerHTML = '<i></i>'.repeat(6); $('calib-result').textContent = ''; $('calib-after').hidden = true; $('calib-pad').classList.remove('done'); }
export function calibProgress(n) { const d = $('calib-dots').children; for (let i = 0; i < d.length; i++) d[i].classList.toggle('on', i < n); }
// 보정 중 박 깜빡임은 없앰(눈으로 맞추면 화면 지연이 섞임, 리듬 검토 S3). 누른 뒤 반응만
export function calibPulse() { }
export function calibTapFx() { const p = $('calib-pad'); p.classList.remove('beat'); void p.offsetWidth; p.classList.add('beat'); setTimeout(() => p.classList.remove('beat'), 90); }
export function calibDone(ms) { $('calib-result').textContent = '보정값 ' + (ms > 0 ? '+' : '') + ms + 'ms'; $('calib-after').hidden = false; $('calib-pad').classList.add('done'); }

// ── 결과 ─────────────────────────────
export function showResult(r) {
  $('res-pan').textContent = r.panName;
  $('res-hit').textContent = r.good; $('res-total').textContent = '/ ' + r.total;
  $('res-face').src = r.face || ''; $('res-face').hidden = !r.face;
  const md = [['통과', '절반 넘게 맞힘'], ['다 맞힘', 'MISS 0'], ['완벽', 'PERFECT 80%']];
  $('res-medals').innerHTML = md.map((m, i) => `<div class="medal${r.medal > i ? ' on' : ''}" style="animation-delay:${0.15 + i * 0.25}s">${m[0]}<small>${m[1]}</small></div>`).join('');
  if (H.stamps) H.stamps(md.map((m, i) => r.medal > i ? 0.15 + i * 0.25 + 0.1 : null).filter(x => x != null));
  for (const k of ['PERFECT', 'GREAT', 'GOOD', 'MISS']) $('res-' + k).textContent = r.counts[k];
  $('res-combo').textContent = r.maxCombo;
  // 연주·결과 화면에는 ms 숫자를 안 보임(숫자는 설정·보정 화면에서만, 사용자 10-19)
  $('res-avg').textContent = r.medMs == null ? '–' : Math.abs(r.medMs) <= 25 ? '딱 맞음' : r.medMs > 0 ? '조금 늦은 편' : '조금 이른 편';
  const ob = $('btn-res-offset');
  if (r.suggest) { ob.hidden = false; ob.textContent = r.medMs > 0 ? '조금 늦게 치는 편이에요 · 맞추기' : '조금 일찍 치는 편이에요 · 맞추기'; ob.onclick = () => { H.applyOffset(r.suggest); ob.hidden = true; }; }
  else ob.hidden = true;
  const ph = $('res-photos'); ph.innerHTML = ''; for (const c of r.photos || []) ph.appendChild(c);
  const box = $('res-kana'); box.innerHTML = '';
  for (const k of r.letters) { const c = document.createElement('div'); c.className = 'kc' + (r.stamped.has(k) ? ' st' : ''); c.innerHTML = `<b>${k}</b><span>${r.info(k)}</span>`; box.appendChild(c); }
  $('res-words').innerHTML = (r.words || []).map(w => `<span><b>${w.w}</b>${w.m || ''}</span>`).join('');
  show('result');
}
