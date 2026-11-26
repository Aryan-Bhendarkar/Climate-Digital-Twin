import { useRef, useEffect } from 'preact/hooks';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

/** Thin uPlot wrapper: re-creates the chart when `opts`/`data` identity changes, resizes with its box. */
export function Chart({ data, opts, height = 160, label }) {
  const box = useRef(), plot = useRef();
  useEffect(() => {
    const el = box.current; if (!el || !data) return;
    const w = Math.max(120, el.clientWidth);
    plot.current = new uPlot({ width: w, height, legend: { show: false }, cursor: { drag: { x: false, y: false } }, ...opts }, data, el);
    const ro = new ResizeObserver(() => plot.current && plot.current.setSize({ width: Math.max(120, el.clientWidth), height }));
    ro.observe(el);
    return () => { ro.disconnect(); plot.current && plot.current.destroy(); plot.current = null; };
  }, [data, opts, height]);
  return <div class="chart" ref={box} role="img" aria-label={label} />;
}
export const AX = { stroke: '#566870', font: '11px "IBM Plex Sans", system-ui', grid: { stroke: 'rgba(15,37,48,.08)', width: 1 }, ticks: { stroke: '#9AA5A3', width: 1, size: 4 }, size: 36, gap: 4 };
