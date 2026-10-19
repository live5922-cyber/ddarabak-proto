// ui.js · 메뉴 화면(DOM) v0.3 — 여행 수첩 결(크림 종이 + 흰 칼선 + 그림자 1단 + 기울기). 연주 중에는 설명 글을 띄우지 않음(연습만 한 줄).
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
  on('btn-prac-skip2', () => H.skipPractice());
  on('btn-prac-skip', () => H.skipPractice());
  on('chip-sound', () => { cycleSound(); refreshChip(); H.optionsChanged(); });
  on('btn-retry', () => H.retry());
  on('btn-res-sel', () => H.toSelect());
  on('btn-calib-skip', () => H.calibSkip());
  on('btn-calib-again', () => H.calibAgain());
  on('btn-calib-go', () => H.calibGo());
  on('btn-set-close', () => { show(backFromSettings); H.optionsChanged(); });
  on('btn-recalib', () => H.recalib());
  on('btn-prac-again', () => { H.practiceAgain(); $('btn-prac-again').textContent = '다음 판에 연습이 다시 나와요'; });
  $('calib-pad').addEventListener('pointerdown', e => { e.preventDefault(); H.calibTap(e); });
  buildSettings(); refreshChip();
}
// mode = 'practice' 이면 일시정지 판에 '연습 건너뛰기'
export function show(name, mode) {
  document.body.dataset.scr = name || 'play';
  if (name === 'pause') $('btn-prac-skip2').hidden = mode !== 'practice';
}
export function current() { return document.body.dataset.scr; }
export function setStatus(text, ready) { $('load-status').textContent = text; $('btn-start').classList.toggle('wait', !ready); }
function refreshChip() { $('chip-sound').textContent = '가 · A  ' + SOUND_LABEL[settings.sound]; }

// ── 난이도 고르기(명세 1절, 검토 V11·S7) = 기차표 3장: 펀치 구멍 1·2·3개 = 난이도, 최고 도장 3칸에 이름(통과·잘함·다 맞힘). 처음이면 '쉬움'에 추천 ─────────────────────────────
export const MEDALS = [['통과', '절반 넘게'], ['잘함', 'MISS ≤ 10%'], ['다 맞힘', 'MISS 0']];
export function showSelect(levels) {
  const box = $('level-list'); box.innerHTML = '';
  const fresh = !['easy', 'normal', 'hard'].some(id => records[id]);
  levels.forEach((lv, li) => {
    const r = records[lv.id] || { medal: 0 };
    const b = document.createElement('button'); b.type = 'button'; b.className = 'ticket lv-' + lv.id;
    const st = MEDALS.map(([nm], i) => `<span class="st${r.medal > i ? ' on' : ''}"><i></i><b>${nm}</b></span>`).join('');
    const len = Math.floor(lv.len / 60) + ':' + String(lv.len % 60).padStart(2, '0');
    b.innerHTML = `<span class="stub">${'<i></i>'.repeat(li + 1)}${'<u></u>'.repeat(2 - li)}</span>` +
      `<span class="body"><span class="nm">${lv.name}</span>${fresh && lv.id === 'easy' ? '<span class="rec">추천</span>' : ''}` +
      `<span class="mv">${lv.move}</span><span class="info">노트 ${lv.notes} · ${len}</span></span><span class="stamps">${st}</span>`;
    b.addEventListener('click', () => { H.click && H.click(); b.classList.add('picked'); setTimeout(() => H.chooseLevel(lv.id), 120); });
    box.appendChild(b);
  });
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
function openSettings(from) { backFromSettings = from; buildSettings(); $('btn-prac-again').textContent = '연습 다시 하기'; show('settings'); }

// ── 지연 보정 ─────────────────────────────
export function calibReset() { $('calib-dots').innerHTML = '<i></i>'.repeat(6); $('calib-result').textContent = ''; $('calib-after').hidden = true; $('calib-pad').classList.remove('done'); }
export function calibProgress(n) { const d = $('calib-dots').children; for (let i = 0; i < d.length; i++) d[i].classList.toggle('on', i < n); }
export function calibPulse() { }
export function calibTapFx() { const p = $('calib-pad'); p.classList.remove('beat'); void p.offsetWidth; p.classList.add('beat'); setTimeout(() => p.classList.remove('beat'), 90); }
export function calibDone(ms) { $('calib-result').textContent = '보정값 ' + (ms > 0 ? '+' : '') + ms + 'ms'; $('calib-after').hidden = false; $('calib-pad').classList.add('done'); }

// ── 결과 = 수첩 한 쪽(명세 5절): 박(0.49초)에 맞춰 차례로 — 사진 4장 1/2박씩 → 맞힌 수 세어 오름 1박 → 메달 도장 → 판정 수 → 읽은 글자 도장 1/8박씩 → 낱말(검토 V11). 단추는 바닥에 늘 보임(I7)
const BEAT = 0.49;
function seq(el, d) { if (!el) return; el.classList.remove('seq'); void el.offsetWidth; el.style.setProperty('--d', d.toFixed(3) + 's'); el.classList.add('seq'); }
export function showResult(r) {
  $('res-level').textContent = r.levelName;
  $('res-total').textContent = '/ ' + r.total; $('res-hit').textContent = '0';
  $('res-face').src = r.face || ''; $('res-face').hidden = !r.face;
  const ph = $('res-photos'); ph.innerHTML = '';
  (r.photos || []).forEach((c, i) => { const f = document.createElement('figure'); f.style.setProperty('--r', [-3, 2, -1.5, 3][i % 4] + 'deg'); f.appendChild(c); ph.appendChild(f); seq(f, BEAT * (1 + i * 0.5)); });
  const tCount = BEAT * 3, tMedal = tCount + BEAT * 1.25;
  setTimeout(() => {   // 맞힌 수 세어 오름(1박) → 끝에 쾅
    const t0 = performance.now(), el = $('res-hit');
    const step = () => { const u = Math.min(1, (performance.now() - t0) / (BEAT * 1000)); el.textContent = Math.round(r.good * u); if (u < 1) requestAnimationFrame(step); else { el.parentElement.classList.remove('slam'); void el.offsetWidth; el.parentElement.classList.add('slam'); } };
    step();
  }, tCount * 1000);
  $('res-medals').innerHTML = MEDALS.map((m, i) => `<div class="medal m${i + 1}${r.medal > i ? ' on' : ''}" style="animation-delay:${(tMedal + i * BEAT / 2).toFixed(2)}s"><b>${m[0]}</b><small>${m[1]}</small></div>`).join('');
  if (H.stamps) H.stamps(MEDALS.map((m, i) => r.medal > i ? tMedal + i * BEAT / 2 + 0.1 : null).filter(x => x != null));
  const tAfter = tMedal + BEAT * 1.75;
  for (const k of ['PERFECT', 'GREAT', 'GOOD', 'MISS']) $('res-' + k).textContent = r.counts[k];
  seq(document.querySelector('#scr-result .counts'), tAfter); seq(document.querySelector('#scr-result .minor'), tAfter);
  $('res-combo').textContent = r.maxCombo;
  $('res-perfect80').hidden = !r.perfect80;
  // 연주·결과 화면에는 ms 숫자를 안 보임(사용자 10-19). 잰 노트가 5개 안 되면 '–'(S8)
  $('res-avg').textContent = r.medMs == null ? '–' : Math.abs(r.medMs) <= 25 ? '딱 맞음' : r.medMs > 0 ? '조금 늦은 편' : '조금 이른 편';
  $('res-mash').hidden = !r.mashed; seq($('res-mash'), tAfter);
  const ob = $('btn-res-offset');
  if (r.suggest) { ob.hidden = false; ob.textContent = r.medMs > 0 ? '조금 늦게 치는 편이에요 · 맞추기' : '조금 일찍 치는 편이에요 · 맞추기'; ob.onclick = () => { H.applyOffset(r.suggest); ob.hidden = true; }; seq(ob, tAfter); }
  else ob.hidden = true;
  const box = $('res-kana'); box.innerHTML = '';
  const tKana = tAfter + BEAT;
  r.letters.forEach((k, i) => { const c = document.createElement('div'); c.className = 'kc' + (r.stamped.has(k) ? ' st' : ''); c.innerHTML = `<b>${k}</b><span>${r.info(k)}</span>`; box.appendChild(c); seq(c, tKana + i * BEAT / 8); });
  seq($('res-read'), tKana - BEAT / 2);
  $('res-read').textContent = '읽은 글자 ' + r.letters.filter(k => r.stamped.has(k)).length + ' / ' + r.letters.length;
  $('res-words').innerHTML = (r.words || []).map(w => `<span><b>${w.w}</b>${w.m || ''}</span>`).join('');
  seq($('res-words'), tKana + 15 * BEAT / 8 + BEAT / 2);
  show('result');
  const sc = document.querySelector('#scr-result .page'); if (sc) sc.scrollTop = 0;
}