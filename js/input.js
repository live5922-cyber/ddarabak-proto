// input.js · 터치·키 입력. pointerdown 즉시 처리(원칙 3). 화면 좌표 → 무대 좌표(390×844 기준)
// 누르는 자리(기획안 5절): 왼쪽 x 0~195 / 오른쪽 195~390, y 576 아래. 일시정지 48×48 (16,56).

export function attachInput(el, getLayout, h) {
  const down = new Map();   // pointerId → side

  function toStage(e) {
    const L = getLayout();
    return { x: (e.clientX - L.ox) / L.s, y: (e.clientY - L.oy) / L.s };
  }
  function sideOf(p) {
    if (p.y < 576) return null;
    return p.x < 195 ? 'L' : 'R';
  }

  el.addEventListener('pointerdown', e => {
    if (e.cancelable) e.preventDefault();
    const p = toStage(e);
    if (h.onPausePress && p.x >= 8 && p.x <= 72 && p.y >= 48 && p.y <= 112) { h.onPausePress(e); return; }
    const side = sideOf(p);
    if (!side) return;
    down.set(e.pointerId, side);
    h.onPress(side, e);
  }, { passive: false });

  const up = e => {
    const side = down.get(e.pointerId);
    if (!side) return;
    down.delete(e.pointerId);
    let still = false;
    for (const s of down.values()) if (s === side) still = true;
    if (!still && h.onRelease) h.onRelease(side, e);
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('lostpointercapture', up);
  el.addEventListener('contextmenu', e => e.preventDefault());

  // 키보드(컴퓨터에서 시험): F·D·Space·← = 왼쪽, J·K·→ = 오른쪽, Esc·P = 일시정지
  const keySide = { KeyF: 'L', KeyD: 'L', Space: 'L', ArrowLeft: 'L', KeyJ: 'R', KeyK: 'R', ArrowRight: 'R' };
  window.addEventListener('keydown', e => {
    if (e.repeat) return;
    if (e.code === 'Escape' || e.code === 'KeyP') { if (h.onPausePress) h.onPausePress(e); return; }
    const side = keySide[e.code];
    if (!side) return;
    if (h.keysEnabled && !h.keysEnabled()) return;
    e.preventDefault();
    h.onPress(side, e);
  });
  window.addEventListener('keyup', e => {
    const side = keySide[e.code];
    if (side && h.onRelease) h.onRelease(side, e);
  });
}
