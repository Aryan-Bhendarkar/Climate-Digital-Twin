import { useEffect, useState } from 'preact/hooks';
import * as S from './store.js';
import { MapCanvas, HoverTip, PlateHead, Legend, Scrubber } from './components/MapStage.jsx';
import { Rail } from './components/Rail.jsx';
import { SidePanel } from './components/SidePanel.jsx';
import { TrustStrip } from './components/Trust.jsx';
import { Drawer } from './components/Drawer.jsx';
import { Tour } from './components/Tour.jsx';
import { Icon } from './components/icons.jsx';
import { startTour, exitTour } from './tour.js';

function Mark() { return <svg class="mark" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="none" stroke="#0F2530" stroke-width="1.5" /><path d="M12 5a7 7 0 1 1-7 7a4.4 4.4 0 0 1 4.4-4.4a2.8 2.8 0 1 1-2.8 2.8" fill="none" stroke="#14506E" stroke-width="1.5" stroke-linecap="round" /></svg>; }

function Header() {
  const h = S.health.value, ms = S.speedMs.value, [ext, setExt] = useState(0);
  useEffect(() => { const f = () => { const o = location.origin; let so = ''; try { so = new URL(S.api.url).origin; } catch (e) { /* ignore */ } setExt(performance.getEntriesByType('resource').filter((r) => { try { const x = new URL(r.name).origin; return x !== o && x !== so && !r.name.startsWith('data:'); } catch (e) { return false; } }).length); }; f(); const t = setInterval(f, 3000); return () => clearInterval(t); }, []);
  const label = h === 'ready' ? 'Model running' : h === 'loading' ? 'Model loading' : h === 'down' ? 'Model not running \u2014 start serve.py' : 'Connecting';
  return (
    <header class="top">
      <div class="brand"><Mark /><h1>Monsoon Multiverse</h1></div>
      <div class="status" role="status" title={ext ? `${ext} request(s) left this computer` : 'Verified live: no request has left this computer. The model runs here, with no internet.'}>
        <i class={'dot ' + (ext ? 'bad' : h === 'ready' ? 'ok' : h === 'down' ? 'off' : 'warm')} />
        {ext ? <><span>{ext} outside request(s)</span><span class="sep" /></> : h === 'ready' ? <><span>No internet needed</span><span class="sep" /></> : null}<span>{label}</span>
        {ms && h === 'ready' ? <><span class="sep" /><span>{(Math.max(ms, 50) / 1000).toFixed(1)} s per forecast</span></> : null}
      </div>
      <div class="top-btns"><button class="btn" onClick={startTour} data-tour-btn>Start tour</button><button class="btn" onClick={() => (S.drawer.value = S.drawer.value ? null : 'states')}>Expert view</button></div>
    </header>
  );
}
function Hero() {
  if (!S.introOpen.value) return (
    <section class="hero closed" aria-label="About">
      <p class="hero-sentence small">Change the weather in one corner of India. Watch the next 10 days change everywhere else.</p>
      <div class="hero-btns"><button class="link" onClick={startTour}>Take the 1-minute tour</button></div>
    </section>);
  return (
    <section class="hero" data-tour="hero">
      <p class="hero-sentence">Change the weather in one corner of India. Watch the next 10 days change everywhere else.</p>
      <ol class="hero-steps" aria-label="How it works in 3 steps"><li><b>1</b> Pick a date</li><li><b>2</b> Ask a what-if</li><li><b>3</b> See who is affected</li></ol>
      <div class="hero-btns"><button class="btn primary" onClick={startTour}>Start tour</button><button class="link" onClick={() => (S.introOpen.value = false)}>Explore on my own</button></div>
    </section>);
}
function Banner() {
  const e = S.error.value, [url, setUrl] = useState(''), [det, setDet] = useState(false);
  if (!e) return null;
  return (
    <div class="banner" role="alert">
      <div class="b-main"><Icon name="warn" /><span>{e.msg}</span>
        {e.engine && <><button class="link" onClick={() => setDet(!det)} aria-expanded={det}>{det ? 'Hide details' : 'Details'}</button><button class="btn small" onClick={() => S.retry(det && url ? url : '')}>Retry</button></>}
        {!e.engine && <button class="link" onClick={() => S.setError(null)}>Dismiss</button>}</div>
      {e.engine && det && <div class="b-det"><span>{e.details}</span><label>Server address <input value={url || S.api.url} spellcheck={false} onInput={(ev) => setUrl(ev.target.value)} /></label></div>}
    </div>);
}

export function App() {
  useEffect(() => {
    S.boot().then(() => { if (S.params.get('tour')) startTour(); }).catch((e) => { console.warn(e); S.setError('The dashboard could not start. Reload the page.', String(e && e.message)); });
    const key = (e) => {
      const tag = document.activeElement && document.activeElement.tagName;
      if (e.key === 'Escape') { if (S.tour.value != null) exitTour(); else if (S.drawer.value) S.drawer.value = null; else if (S.place.value) S.place.value = null; return; }
      if (/INPUT|SELECT|TEXTAREA|BUTTON/.test(tag) && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (/INPUT|SELECT|TEXTAREA/.test(tag)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === ' ') { e.preventDefault(); S.play(!S.playing.value); }
      else if (e.key === 'ArrowRight') { S.play(false); S.setDay(S.day.value + 1); } else if (e.key === 'ArrowLeft') { S.play(false); S.setDay(S.day.value - 1); }
      else if (/^[1-5]$/.test(e.key)) S.varKey.value = ['t2m', 'tp', 'wind', 'tcwv', 'msl'][+e.key - 1];
      else if (e.key === 't' || e.key === 'T') startTour();
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  return (
    <div class="app" data-health={S.health.value}>
      <Header /><Hero /><Banner />
      <main class="main">
        <section class="plate" aria-label="Map of India">
          <PlateHead />
          <div class="plate-body">
            <div class="plate-map"><MapCanvas /><Scrubber /><Legend /></div>
            <SidePanel />
          </div>
        </section>
        <Rail />
      </main>
      <TrustStrip />
      <HoverTip /><Drawer /><Tour />
    </div>);
}
