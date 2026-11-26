import { useRef, useEffect } from 'preact/hooks';
import * as S from '../store.js';
import { SCENARIOS, CUSTOM_WHAT, REGIONS, DATE_WORDS, sgn, nb, fmtPct } from '../lib/narrative.js';
import { HONESTY_LINE } from '../lib/config.js';
import { Icon } from './icons.jsx';

function DateStep() {
  const sm = S.sample.value, list = S.samples.value;
  return (
    <section class="step step-date" data-tour="date">
      <h3><span class="num">1</span> Start date</h3>
      <label class="field grow">
        <span class="sr">Start date</span>
        <select value={sm ? sm.file : ''} title="The AI reads the 3 days before this date and plays the atmosphere forward 10 days." onChange={(e) => { S.introOpen.value = false; S.loadSample(e.target.value, S.result.value ? S.result.value.sc : null); }} aria-label="Start date">
          {list.map((s) => <option key={s.file} value={s.file}>{s.date_label}, {DATE_WORDS[s.file] || s.name}</option>)}
        </select>
      </label>
    </section>
  );
}

function Builder() {
  const c = S.custom.value, w = CUSTOM_WHAT[c.what], r = REGIONS.find((x) => x.id === c.where), msg = useRef();
  const set = (p) => (S.custom.value = { ...S.custom.value, ...p });
  const run = () => {
    const { sc, err } = S.customScenario(); if (err) { S.setError(err); return; }
    S.setError(null); S.runWhatIf(sc);
  };
  return (
    <div class="builder" id="builder" data-tour="builder">
      <div class="b-grid">
        <label class="field"><span>What changes</span>
          <select value={c.what} onChange={(e) => { const k = +e.target.value; set({ what: k, amt: CUSTOM_WHAT[k].def }); }}>{CUSTOM_WHAT.map((x, i) => <option key={x.id} value={i}>{x.label}</option>)}</select></label>
        <label class="field"><span>By how much: <b class="amt">{w.fmtv(c.amt)}</b></span>
          <input type="range" min={w.min} max={w.max} step={w.step} value={c.amt} onInput={(e) => set({ amt: +e.target.value })} aria-label="Amount of change" /></label>
        <label class="field"><span>Where</span>
          <select value={c.where} onChange={(e) => set({ where: e.target.value })}>{REGIONS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <div class="b-run"><button class="btn primary" onClick={run} disabled={S.busy.value > 0}>Run my what-if</button></div>
      </div>
      <p class="help">{c.where === 'drawn' && !S.drawBox.value ? 'Now drag a box on the map.' : 'Tip: drag a box on the map to pick your own area.'}</p>
    </div>
  );
}

function WhatIfStep() {
  const cur = S.result.value && !S.customOpen.value ? S.result.value.sc.id : null, busy = S.busy.value > 0, down = S.health.value !== 'ready';
  return (
    <section class="step" data-tour="whatif">
      <h3><span class="num">2</span> Ask a what-if</h3>
      <ul class="rows" role="list">
        {SCENARIOS.map((s) => (
          <li key={s.id}>
            <button class={'row' + (cur === s.id ? ' on' : '')} aria-pressed={cur === s.id} disabled={down || (busy && S.pending.value !== s.id)} aria-disabled={down} onClick={() => { S.introOpen.value = false; S.customOpen.value = false; S.customFresh.value = false; S.runWhatIf(s); }}
              title={`Changes ${s.what} over ${s.area} on the last input day, then replays the 10 days.`}>
              <Icon name={s.icon} /><span class="row-t">{s.title}</span>
              {S.pending.value === s.id && <i class="prog" />}
            </button>
          </li>
        ))}
        <li>
          <button class={'row' + (S.customOpen.value || cur === 'custom' ? ' on' : '')} aria-expanded={S.customOpen.value} disabled={down} aria-disabled={down} onClick={() => { S.play(false); S.customOpen.value = !S.customOpen.value; S.customFresh.value = S.customOpen.value; if (S.customOpen.value) setTimeout(() => { const b = document.getElementById('builder'); b && b.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 30); }}>
            <Icon name="draw" /><span class="row-t">Draw your own</span><span class="row-n">{cur === 'custom' && !S.customOpen.value ? 'edit and run again' : 'what, how much, where'}</span>
          </button>
        </li>
      </ul>
      {S.customOpen.value && <Builder />}
    </section>
  );
}

function Fig({ label, text, num, line, meaning, range, link, onLink, muted, tid }) {
  const dir = num > 0.0001 ? 'up' : num < -0.0001 ? 'down' : 'flat';
  return (
    <article class={'fig' + (muted ? ' muted-fig' : '')} title={meaning} data-fig={tid}>
      <h4>{label}</h4>
      {muted ? <div class="big none" aria-hidden="true">&ndash;</div> : <div class="big"><Icon name={dir} size={18} /><span>{text}</span></div>}
      <div class="fig-line">{line}</div>
      {range && <div class="fig-range">{range}</div>}
      <button class="link" onClick={onLink}>{link}<Icon name="right" size={14} /></button>
    </article>
  );
}

function ResultStep() {
  const r = S.result.value, sm = S.sample.value;
  if (S.customOpen.value && S.customFresh.value) return (
    <section class="step result" data-tour="result"><h3><span class="num">3</span> What changes</h3>
      <p class="empty">Set what changes, by how much and where, then press <b>Run my what-if</b>.</p>
    </section>);
  if (!r) return (
    <section class="step result" data-tour="result"><h3><span class="num">3</span> What changes</h3>
      <p class="empty">{S.health.value === 'down' ? 'The model is not running, so there is no result yet.' : 'Choose a what-if to see where the weather changes.'}</p>
      <div class="ghost" aria-hidden="true"><i /><i /><i /></div>
    </section>);
  const { figs, hl, sc, range } = r;
  const rg = range ? <>Range at &frac12;&times; to 1.5&times; strength: <span data-range-lo={range.lo} data-range-hi={range.hi}>{fmtPct(range.lo).replace(/\u00A0%$/, '')} to {fmtPct(range.hi)}</span>{range.ordered ? '' : '. Size very uncertain'}</> : null;
  return (
    <section class="step result" data-tour="result">
      <h3><span class="num">3</span> What changes</h3>
      <p class="lead-q">If {nb(sc.lead)},</p>
      <p class="headline" aria-live="polite" title={hl.sub}>{hl.text}</p>
      <p class="honest">{HONESTY_LINE}{r.clamped ? ' Rain and moisture changes were limited so they stay above zero.' : ''}</p>
      <div class="figs">
        <Fig tid="rain" label="Monsoon rain" text={figs.farm.text} num={figs.farm.value} muted={figs.farm.muted} line={figs.farm.line} range={rg} meaning={figs.farm.meaning} link="See states" onLink={() => { S.sideTab.value = 'states'; }} />
        <Fig tid="heat" label="Heat risk" text={figs.heat.text} num={figs.heat.value} muted={figs.heat.muted} line={figs.heat.line} meaning={figs.heat.meaning} link="See details" onLink={() => (S.drawer.value = 'states')} />
        <Fig tid="wind" label="Wind power" text={figs.wind.text} num={figs.wind.value} line={figs.wind.line} meaning={figs.wind.meaning} link="See details" onLink={() => (S.drawer.value = 'wind')} />
      </div>
    </section>
  );
}

export function Rail() {
  return (
    <aside class="rail" aria-label="Controls and results">
      <DateStep /><WhatIfStep /><ResultStep />
    </aside>
  );
}
