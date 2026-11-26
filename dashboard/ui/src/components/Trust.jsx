import * as S from '../store.js';
import { SKILL_DAY1_PCT, SPEED_KM_PER_DAY } from '../lib/config.js';
import { Icon } from './icons.jsx';

const hhmmss = (d) => d.toLocaleTimeString('en-GB', { hour12: false });
export function TrustStrip() {
  const r = S.result.value, n = S.nullTest.value, loc = r && Number.isFinite(r.rip.fracInside[0]) ? (r.rip.fracInside[0] * 100).toFixed(1) : null;
  return (
    <footer class="trust" data-tour="trust" aria-label="Why trust it">
      <div class="t-item"><b>Check</b></div>
      <p><span class="t-num">{loc ? loc + ' %' : '–'}</span> of your change stays inside your box on day 1. No smearing.</p>
      <p><span class="t-num">&le; ~{SPEED_KM_PER_DAY} km</span> a day is the most a change can travel, by design.</p>
      <p class="t-null" aria-live="polite">
        {!n ? <span class="muted">No change in = no change out. </span> : n.state === 'running' ? <span class="muted">Testing: no change in, forecast out…</span> : n.state === 'ok'
          ? <><span class="t-ok"><Icon name="check" size={14} /> Identical (bit-for-bit)</span> when nothing is changed, tested {hhmmss(n.at)}. </> : <span class="t-bad">Forecasts differ by up to {n.m.toExponential(1)}. </span>}
        <button class="link" onClick={S.runNull} disabled={n && n.state === 'running'}>Run again</button>
      </p>
      <p><span class="t-num">+{SKILL_DAY1_PCT} %</span> better than &ldquo;tomorrow = today&rdquo; on day 1, on years the model never saw (2019&ndash;21).</p>
    </footer>
  );
}
