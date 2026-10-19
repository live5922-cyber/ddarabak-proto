// input.js · 터치·키 입력. pointerdown 즉시 처리(원칙 3). 화면 좌표 → 무대 좌표(폭 390 기준)
// 누르는 자리(v0.3): 필름 띠 아래(수첩 바닥)부터 화면 끝까지, 왼쪽 반·오른쪽 반. 일시정지 = 왼쪽 위 책갈피 리본.
export function attachInput(el, getLayout, h) {
  const down = new Map();   // pointerId → side (처음 누른 쪽 유지: 길게 누르는 중 엄지가 옆 칸으로 미끄러져도 그대로)
  function toStage(e) { const L = getLayout(); return { x: (e.clientX - L.ox) / L.s, y: (e.clientY - L.oy) / L.s, L }; }
  el.addEventListener('pointerdown', e => {
    if (e.cancelable) e.preventDefault();
    const p = toStage(e), L = p.L;
    if (h.onPausePress && p.x >= 4 && p.x <= 60 && p.y >= 0 && p.y <= L.T + 64) { h.onPausePress(e); return; }   // 진홍 책갈피 리본(x 16~48, 화면 위 끝 ~ T+57) + 둘레 12px
    if (p.y < L.pressTop) return;
    const side = p.x < 195 ? 'L' : 'R';
    down.set(e.pointerId, side);
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
    h.onPress(side, e);
  }, { passive: false });
  const up = e => {
    const side = down.get(e.pointerId); if (!side) return;
    down.delete(e.pointerId);
    for (const s of down.values()) if (s === side) return;   // 같은 쪽 다른 손가락이 아직 누르는 중
    if (h.onRelease) h.onRelease(side, e);
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('contextmenu', e => e.preventDefault());
  // 키보드(컴퓨터 시험): F·D·Space·← = 왼쪽, J·K·→ = 오른쪽, Esc·P = 일시정지
  const keySide = { KeyF: 'L', KeyD: 'L', Space: 'L', ArrowLeft: 'L', KeyJ: 'R', KeyK: 'R', ArrowRight: 'R' };
  window.addEventListener('keydown', e => {
    if (e.repeat) return;
    if (e.code === 'Escape' || e.code === 'KeyP') { if (h.onPausePress) h.onPausePress(e); return; }
    const side = keySide[e.code]; if (!side) return;
    if (h.keysEnabled && !h.keysEnabled()) return;
    e.preventDefault(); h.onPress(side, e);
  });
  window.addEventListener('keyup', e => { const side = keySide[e.code]; if (side && h.onRelease && (!h.keysEnabled || h.keysEnabled())) h.onRelease(side, e); });
}
