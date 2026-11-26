import * as S from '../store.js';
import { SKILL_DAY1_PCT, SKILL_DAY10_TEXT, SPEED_KM_PER_DAY, LOCAL_KM } from '../lib/config.js';
import { Icon } from './icons.jsx';

const hhmm = (d) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }) + ' IST';
export function TrustStrip() {
  const r = S.result.value, n = S.nullTest.value, up = S.health.value === 'ready';
  const f = r && Number.isFinite(r.rip.fracInside[0]) ? r.rip.fracInside[0] * 100 : null, loc = f != null ? f.toFixed(1) : null;
  return (
    <footer class="trust" data-tour="trust" aria-label="Why trust it">
      <div class="t-item"><b>Check</b></div>
      <p data-locality={loc || ''}>{loc ? <><span class="t-num">{loc}&nbsp;%</span> of the day-1 change stays within ~{LOCAL_KM}&nbsp;km of your box.{f >= 95 ? ' No smearing.' : ''}</> : <span class="muted">Run a what-if to see how much of the change stays near your box on day 1.</span>}</p>
      <p>The model can move a change at most <span class="t-num">~{SPEED_KM_PER_DAY}&nbsp;km</span> per day &mdash; a built-in limit, like a speed limit.</p>
      <p class="t-null" aria-live="polite">
        {!up ? <span class="muted">No change in = no change out: not tested yet (model not running).</span>
          : !n ? <span class="muted">No change in = no change out: not tested yet. </span> : n.state === 'running' ? <span class="muted">Testing: no change in, forecast out&hellip;</span> : n.state === 'ok'
          ? <><span class="t-ok"><Icon name="check" size={14} /> Identical forecast</span> when nothing is changed (checked at {hhmm(n.at)}). </> : <span class="t-bad">Forecasts differ by up to {n.m.toExponential(1)}. </span>}
        {up && <button class="link" onClick={S.runNull} disabled={n && n.state === 'running'}>Run again</button>}
      </p>
      <p><span class="t-num">{SKILL_DAY1_PCT}&nbsp;%</span> lower error than &ldquo;tomorrow = today&rdquo; on day 1{SKILL_DAY10_TEXT ? ' ' + SKILL_DAY10_TEXT : ''}, tested on 2019&ndash;21 with a copy trained only on 2005&ndash;18.</p>
    </footer>
  );
}
