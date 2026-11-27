// The forking timeline. Timeline Prime runs straight on; the Multiverse splits from it at day 0 and rises with the number
// of cities beyond the changed area that feel the change each day. The line's texture says how firm each stretch is.
// With a place open, the same fork shows that place's own difference, above or below Prime.
import { trust, KINDS, TRUST } from './insights.js';
import { effectKey } from './impact-view.js';

const DAYS = 10;
const signed = (x) => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(Math.abs(x) >= 10 ? 0 : 1);

/** Cities beyond the change on watch, per day, with the commonest direction of change that day. */
export function forkSeries(rows) {
  const away = rows.filter((r) => !r.inside);
  return Array.from({ length: DAYS }, (_, d) => {
    const on = away.filter((r) => r.t.days[d]?.level);
    const tally = {};
    for (const r of on) { const k = effectKey(r.t.days[d].kind, r.t.days[d].delta); tally[k] = (tally[k] || 0) + 1; }
    return { n: on.length, tone: Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0] || null };
  });
}

export function createFork(app) {
  const S = app.S, svg = document.getElementById('sFork'), range = document.getElementById('sDay'), days = document.getElementById('sDays');
  // every day is a button under the line, so day 3 or day 5 is one click from day 4
  days.innerHTML = Array.from({ length: DAYS }, (_, i) => `<button type="button" data-day="${i + 1}">${i + 1}</button>`).join('');
  days.onclick = (e) => { const b = e.target.closest('[data-day]'); if (b) app.setDay(+b.dataset.day); };
  let key = '', pts = [], base = 0, labels = [];
  const H = 104;
  let PAD = 46, END = 92;

  function model() {
    const place = app.explore?.openPlace?.(), rows = app.places?.rows().cities || [];
    if (!S.mv || !rows.length) return { mode: 'empty' };
    if (place?.t?.level !== undefined && place.t.level > 0) {
      const k = place.t.kind, s = place.t.series[k], diff = s.m.map((m, d) => m - s.p[d]), max = Math.max(...diff.map(Math.abs), 1e-6);
      return { mode: 'place', diff, max, kind: k, name: place.name };
    }
    const series = forkSeries(rows);
    return { mode: 'all', series, max: Math.max(12, ...series.map((d) => d.n)) };
  }

  function build(m, w) {
    PAD = w < 520 ? 22 : 46; END = w < 520 ? 66 : 92;
    base = m.mode === 'place' ? 46 : H - 24;
    const x = (d) => PAD + (d * (w - PAD - END)) / DAYS;
    const y = (d) => (m.mode === 'place' ? base - (m.diff[d - 1] / m.max) * 30 : base - (m.series[d - 1].n ? 8 + (46 * m.series[d - 1].n) / m.max : 3));
    pts = [[x(0), base], ...(m.mode === 'empty' ? [] : Array.from({ length: DAYS }, (_, i) => [x(i + 1), y(i + 1)]))];
    const tone = (d) => `var(--fx-${m.mode === 'place' ? effectKey(m.kind, m.diff[d - 1]) : m.series[d - 1].tone || 'none'})`;
    const curve = (a, b) => `C${(a[0] + b[0]) / 2} ${a[1]} ${(a[0] + b[0]) / 2} ${b[1]} ${b[0]} ${b[1]}`;
    let out = `<path class="past" d="M${x(0) - 34} ${base}H${x(0)}"/><path class="prime" d="M${x(0)} ${base}H${x(DAYS)}"/>`;
    out += `<text class="tick" x="${x(0)}" y="${H - 5}">${w >= 520 ? 'Change' : 0}</text>`;
    [...days.children].forEach((b, i) => (b.style.left = `${x(i + 1)}px`));
    if (m.mode === 'empty') {
      out += `<path class="stub" d="M${x(0)} ${base}${curve([x(0), base], [x(2.2), base - 40])}"/><text class="hint" x="${x(2.5)}" y="${base - 36}">Choose a change to fork the timeline</text>`;
      labels = [];
    } else {
      out += `<g class="mv"><path class="gap" d="M${x(0)} ${base}${pts.slice(1).map((p, i) => curve(pts[i], p)).join('')}L${x(DAYS)} ${base}Z"/>`;
      for (let d = 1; d <= DAYS; d++) if (Math.abs(pts[d][1] - base) > 4) out += `<line class="rung" x1="${pts[d][0]}" x2="${pts[d][0]}" y1="${base}" y2="${pts[d][1]}" style="stroke:${tone(d)}"/>`;
      for (let d = 1; d <= DAYS; d++) out += `<path class="line ${trust(d, app.beyond?.())}" d="M${pts[d - 1][0]} ${pts[d - 1][1]}${curve(pts[d - 1], pts[d])}"/>`;
      out += `</g><text class="name" x="${x(DAYS) + 10}" y="${pts[DAYS][1] + 4}">Multiverse</text>`;
      if (m.mode === 'all' && base - pts[DAYS][1] >= 30) out += `<text class="hint" x="${x(DAYS) + 10}" y="${pts[DAYS][1] + 18}">cities hit</text>`;
      labels = m.mode === 'place' ? m.diff.map((v) => `${m.name} ${signed(v)} ${KINDS[m.kind].unit}`) : m.series.map((d) => `${d.n} ${d.n === 1 ? 'city' : 'cities'} beyond the change`);
    }
    out += `<text class="name prime-name" x="${x(DAYS) + 10}" y="${base + (m.mode !== 'empty' && Math.abs(pts[DAYS][1] - base) < 16 ? 16 : 4)}">Prime</text>`;
    svg.innerHTML = `<title>The Multiverse leaves Prime at day 0. Height: how far apart they are each day. Rung colour: the commonest kind of change that day.</title>${out}<g id="forkHead"></g>`;
    // the native slider lies over days 1 to 10, so dragging and the keyboard work as they always do
    range.style.left = `${x(1) - 8}px`; range.style.width = `${x(DAYS) - x(1) + 16}px`;
  }

  function head() {
    const g = document.getElementById('forkHead'); if (!g) return;
    const w = svg.clientWidth, d = S.day, x = PAD + (d * (w - PAD - END)) / DAYS, p = pts[d];
    const label = labels[d - 1], k = trust(d, app.beyond?.());
    g.innerHTML = `<line class="play" x1="${x}" x2="${x}" y1="18" y2="${H - 18}"/><circle class="on-prime" cx="${x}" cy="${base}" r="3.5"/>`
      + (p ? `<circle class="on-mv" cx="${p[0]}" cy="${p[1]}" r="6.5"/>` : '')
      + (label ? `<text class="read" x="${x > w / 2 ? x - 10 : x + 10}" y="13" text-anchor="${x > w / 2 ? 'end' : 'start'}">${label}</text>` : '');
    range.setAttribute('aria-valuetext', `Day ${d}${label ? `, ${label}, ${TRUST[k].toLowerCase()}` : ''}`);
    [...days.children].forEach((b, i) => {
      const name = [`Day ${i + 1}`, app.dateOf(i + 1)].filter(Boolean).join(', ');
      b.title = name; b.setAttribute('aria-label', name); if (i + 1 === d) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    });
  }

  function render() {
    const w = svg.clientWidth; if (!w) return;
    const m = model(), next = JSON.stringify([m, w, app.beyond?.()]);
    if (next !== key) {
      const fresh = m.mode !== 'empty' && !key.startsWith(next.slice(0, 40));
      key = next; svg.setAttribute('viewBox', `0 0 ${w} ${H}`); build(m, w);
      svg.classList.remove('fresh'); if (fresh) { void svg.getBoundingClientRect(); svg.classList.add('fresh'); }
    }
    head();
  }
  new ResizeObserver(() => render()).observe(svg);
  return { render };
}
