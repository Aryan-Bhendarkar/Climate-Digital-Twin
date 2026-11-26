import { useRef, useEffect } from 'preact/hooks';
import * as S from '../store.js';
import { SCENARIOS, CUSTOM_WHAT, REGIONS, DATE_WORDS, sgn, nb } from '../lib/narrative.js';
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
  const cur = S.result.value && !S.customOpen.value ? S.result.value.sc.id : null, busy = S.busy.value > 0;
  return (
    <section class="step" data-tour="whatif">
      <h3><span class="num">2</span> Ask a what-if</h3>
      <ul class="rows" role="list">
        {SCENARIOS.map((s) => (
          <li key={s.id}>
            <button class={'row' + (cur === s.id ? ' on' : '')} aria-pressed={cur === s.id} disabled={busy && S.pending.value !== s.id} onClick={() => { S.introOpen.value = false; S.customOpen.value = false; S.runWhatIf(s); }}
              title={`Changes ${s.what} over ${s.area} on the last input day, then replays the 10 days.`}>
              <Icon name={s.icon} /><span class="row-t">{s.title}</span>
              {S.pending.value === s.id && <i class="prog" />}
            </button>
          </li>
        ))}
        <li>
          <button class={'row' + (S.customOpen.value ? ' on' : '')} aria-expanded={S.customOpen.value} onClick={() => { S.customOpen.value = !S.customOpen.value; if (S.customOpen.value) setTimeout(() => { const b = document.getElementById('builder'); b && b.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 30); }}>
            <Icon name="draw" /><span class="row-t">Draw your own</span><span class="row-n">what, how much, where</span>
          </button>
        </li>
      </ul>
      {S.customOpen.value && <Builder />}
    </section>
  );
}

function Fig({ label, text, num, line, meaning, range, link, onLink }) {
  const dir = num > 0.0001 ? 'up' : num < -0.0001 ? 'down' : 'flat';
  return (
    <article class="fig" title={meaning}>
      <h4>{label}</h4>
      <div class="big"><Icon name={dir} size={18} /><span>{text}</span></div>
      <div class="fig-line">{line}</div>
      {range && <div class="fig-range">{range}</div>}
      
      <button class="link" onClick={onLink}>{link}<Icon name="right" size={14} /></button>
    </article>
  );
}

function ResultStep() {
  const r = S.result.value, sm = S.sample.value;
  if (!r) return (
    <section class="step result" data-tour="result"><h3><span class="num">3</span> What changes</h3>
      <p class="empty">Choose a what-if to see where the weather changes.</p>
      <div class="ghost" aria-hidden="true"><i /><i /><i /></div>
    </section>);
  const { figs, hl, sc, range } = r;
  const rg = range ? `Range: ${sgn(Math.round(range.lo))} to ${sgn(Math.round(range.hi))} %` : null;
  return (
    <section class="step result" data-tour="result">
      <h3><span class="num">3</span> What changes</h3>
      <p class="lead-q">If {nb(sc.lead)},</p>
      <p class="headline" aria-live="polite">{hl.text}</p>
            <div class="figs">
        <Fig label="Farmers" text={figs.farm.text} num={figs.farm.value} line={figs.farm.line} range={rg} meaning={figs.farm.meaning} link="See states" onLink={() => { S.sideTab.value = 'states'; }} />
        <Fig label="Heat risk" text={figs.heat.text} num={figs.heat.value} line={figs.heat.line} meaning={figs.heat.meaning} link="See details" onLink={() => (S.drawer.value = 'states')} />
        <Fig label="Wind power" text={figs.wind.text} num={figs.wind.value} line={figs.wind.line} meaning={figs.wind.meaning} link="See details" onLink={() => (S.drawer.value = 'wind')} />
      </div>
      <p class="honest">{hl.sub} Replay of {sm ? sm.date_label : ''} · direction reliable, size approximate.{r.clamped ? ' Rain and moisture changes were limited so they stay above zero.' : ''}</p>
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
