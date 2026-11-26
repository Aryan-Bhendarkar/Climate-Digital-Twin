import { useEffect, useState, useRef } from 'preact/hooks';
import * as S from '../store.js';
import { STEPS, nextStep, prevStep, exitTour } from '../tour.js';

export function Tour() {
  const i = S.tour.value, [rect, setRect] = useState(null), card = useRef();
  useEffect(() => {
    if (i == null) return;
    const upd = () => { const el = document.querySelector(`[data-tour="${STEPS[i].target}"]`); if (el) { const r = el.getBoundingClientRect(); setRect({ x: r.left, y: r.top, w: r.width, h: r.height }); } };
    upd(); const iv = setInterval(upd, 250); window.addEventListener('resize', upd);
    return () => { clearInterval(iv); window.removeEventListener('resize', upd); };
  }, [i]);
  useEffect(() => { if (i != null && card.current) card.current.focus(); }, [i]);
  if (i == null) return null;
  const st = STEPS[i], pad = 6, vw = innerWidth, vh = innerHeight, CW = 340, CH = 190;
  let left = 24, top = 80;
  if (rect) {
    if (rect.x + rect.w + CW + 24 < vw) { left = rect.x + rect.w + 14; top = Math.min(Math.max(12, rect.y), vh - CH - 12); }
    else if (rect.x - CW - 24 > 0) { left = rect.x - CW - 14; top = Math.min(Math.max(12, rect.y), vh - CH - 12); }
    else if (rect.y + rect.h + CH + 24 < vh) { left = Math.min(Math.max(12, rect.x), vw - CW - 12); top = rect.y + rect.h + 14; }
    else { left = Math.min(Math.max(12, rect.x + 12), vw - CW - 12); top = Math.max(12, rect.y - CH - 14); }
  }
  return (
    <div class="tour" aria-live="polite">
      {rect && <div class="spot" style={{ left: rect.x - pad + 'px', top: rect.y - pad + 'px', width: rect.w + pad * 2 + 'px', height: rect.h + pad * 2 + 'px' }} />}
      <div class="tour-card" ref={card} tabIndex={-1} role="dialog" aria-label={`Tour step ${i + 1} of ${STEPS.length}`} style={{ left: left + 'px', top: top + 'px', width: CW + 'px' }}>
        <div class="tc-step">Step {i + 1} of {STEPS.length}</div>
        <h3>{st.title}</h3>
        <p>{st.body}</p>
        <div class="tc-nav">
          <button class="link" onClick={exitTour}>Exit (Esc)</button>
          <span>{i > 0 && <button class="btn" onClick={prevStep}>Back</button>} <button class="btn primary" onClick={nextStep}>{i === STEPS.length - 1 ? 'Done' : 'Next'}</button></span>
        </div>
      </div>
    </div>
  );
}
