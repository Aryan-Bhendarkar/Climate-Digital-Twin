"""End-to-end check of the v3 dashboard against the live model server through devserver.py.

    python3 tests/dashboard_ui/e2e.py [--base http://127.0.0.1:8180] [--shots DIR]

Asserts: zero console/page errors, only 127.0.0.1 requests, the result is visible on load, every scenario / tab /
scrubber / draw-your-own / null test / tour / expert drawer works, and the server-down message is judge-friendly.
"""
import argparse, re, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--base', default='http://127.0.0.1:8180')
ap.add_argument('--shots', default='/mnt/user-data/outputs/Devforge/research/dashboard_v3_fix')
a = ap.parse_args()
SH = Path(a.shots); SH.mkdir(parents=True, exist_ok=True)
URL = a.base + '/v2/?server=api'
fails, n = [], [0]

def check(ok, msg):
    print(('PASS ' if ok else 'FAIL ') + msg)
    if not ok: fails.append(msg)

def shot(pg, name):
    n[0] += 1; pg.screenshot(path=str(SH / f'{n[0]:02d}_{name}.png'))

def watch(pg, bag):
    pg.on('console', lambda m: bag['err'].append(m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: bag['err'].append('pageerror: ' + str(e)))
    pg.on('requestfailed', lambda r: bag['err'].append('failed: ' + r.url))
    pg.on('request', lambda r: bag['hosts'].add(re.sub(r'^\w+://([^/:]+).*', r'\1', r.url)) if not r.url.startswith('data:') else None)

def settle(pg, t=2500):
    pg.wait_for_function("document.querySelectorAll('.busy-veil').length===0", timeout=20000); pg.wait_for_timeout(t)

NUM = re.compile(r'([+\u2212-]?\d+(?:\.\d+)?)')
def num(s): m = NUM.search(s.replace('\u00a0', ' ')); return float(m.group(1).replace('\u2212', '-')) if m else None

def consistency(pg, tag):
    """Honesty checks on one result: range contains main, headline numbers == bar numbers, card == bar, plate == headline."""
    if pg.locator('[data-fig=rain] .none').count() == 0:
        pg.wait_for_selector('[data-range-lo]', timeout=20000)
        r = pg.locator('[data-range-lo]'); lo, hi = float(r.get_attribute('data-range-lo')), float(r.get_attribute('data-range-hi'))
        main = num(pg.locator('[data-fig=rain] .big').inner_text())
        check(lo <= main <= hi, f'{tag}: range {lo}..{hi} contains main {main}')
        shown = [num(x) for x in r.inner_text().split(' to ')]
        check(shown[0] == lo and shown[1] == hi, f'{tag}: range text {shown} matches data')
    hl = pg.locator('.headline').inner_text().replace('\u00a0', ' ')
    if pg.locator('.states .link', has_text='Show all').count(): pg.locator('.states .link', has_text='Show all').click(); pg.wait_for_timeout(150)
    bars = {li.get_attribute('data-state'): li.get_attribute('data-val').replace('\u00a0', ' ') for li in pg.locator('.states li[data-state]').all()}
    named = [(st, v) for st, v in bars.items() if re.search(r'(^|: | and |, |; )' + re.escape(st) + ' ', hl)]
    ok = bool(named) and all(f'{st} {v}' in hl for st, v in named) if hl.startswith('10-day rain') else True
    check(ok, f'{tag}: headline numbers == bar numbers {named} in "{hl[:90]}"')
    if pg.locator('[data-fig=rain] .none').count() == 0:
        st = re.sub(r'^10-day rain in ', '', pg.locator('[data-fig=rain] .fig-line').inner_text())
        card = pg.locator('[data-fig=rain] .big span').inner_text().replace('\u00a0', ' ')
        check(bars.get(st) == card, f'{tag}: card {st} {card} == bar {bars.get(st)}')
    check('%' not in ''.join(v for st, v in bars.items() if 'mm' in v), f'{tag}: dry states in mm only')
    title = pg.locator('.plate-title').inner_text()
    check(title.startswith('Only the change: rain'), f'{tag}: plate shows the headline variable: {title}')
    loc = pg.locator('[data-locality]').get_attribute('data-locality'); tr = pg.locator('.trust').inner_text()
    check(not loc or ('No smearing' in tr) == (float(loc) >= 95), f'{tag}: "No smearing" only at >= 95 % ({loc})')
    if pg.locator('.states .link', has_text='Show fewer').count(): pg.locator('.states .link', has_text='Show fewer').click()

with sync_playwright() as p:
    b = p.chromium.launch()
    bag = {'err': [], 'hosts': set()}
    pg = b.new_page(viewport={'width': 1366, 'height': 768}); watch(pg, bag)
    pg.goto(URL); pg.wait_for_selector('.headline', timeout=30000); settle(pg)
    check(pg.locator('.headline').inner_text().strip() != '', 'auto-run: headline visible on load')
    check('Rajasthan' in pg.locator('.lead-q').inner_text(), 'auto-run: scenario is Dry air over Rajasthan')
    check(pg.locator('.row.on').count() == 1, 'auto-run: one scenario row selected')
    check(pg.locator('.hero').is_visible(), 'hero strip visible')
    shot(pg, 'landing_1366x768')
    hb = pg.locator('.honest').bounding_box(); tt = pg.locator('.trust').bounding_box()
    check('not a forecast' in pg.locator('.honest').inner_text() and hb['y'] + hb['height'] <= tt['y'], 'honesty line visible above the trust strip at 1366x768')
    check('direction reliable' not in pg.content() and 'Works offline' not in pg.content() and 'Plate 2' not in pg.content(), 'old wording gone')
    consistency(pg, 'landing')
    y0 = pg.locator('.map-box canvas').bounding_box()['y']; pg.get_by_role('button', name='Explore on my own').click(); pg.wait_for_timeout(400)
    check(abs(pg.locator('.map-box canvas').bounding_box()['y'] - y0) < 1, 'no plate jump when the hero closes')
    # draw-your-own fully visible at 1366x768
    pg.get_by_role('button', name=re.compile('Draw your own')).click(); pg.wait_for_timeout(500)
    bb = pg.locator('.b-run button').bounding_box()
    check(bb and bb['y'] + bb['height'] <= 712, 'draw-your-own: Run button visible without scrolling the page')
    check('Press' in pg.locator('[data-tour=result]').inner_text() or 'press' in pg.locator('[data-tour=result]').inner_text(), 'draw-your-own: old result hidden while editing')
    shot(pg, 'draw_your_own_setup')
    pg.locator('.builder select').nth(1).select_option('cen'); pg.get_by_role('button', name='Run my what-if').click(); settle(pg)
    check('Central India' in pg.locator('.lead-q').inner_text(), 'draw-your-own: custom run lands')
    hb = pg.locator('.headline').bounding_box(); check(hb['y'] >= 0 and hb['y'] + hb['height'] <= 712, 'draw-your-own: result headline in view after Run')
    consistency(pg, 'draw-your-own')
    shot(pg, 'draw_your_own_result')
    # drag a box on the map
    pg.get_by_role('button', name=re.compile('Draw your own')).click(); pg.wait_for_timeout(300)
    pg.locator('.builder select').nth(1).select_option('drawn')
    box = pg.locator('.map-box canvas').bounding_box()
    pg.mouse.move(box['x'] + 150, box['y'] + 250); pg.mouse.down(); pg.mouse.move(box['x'] + 260, box['y'] + 330, steps=5); pg.mouse.up()
    shot(pg, 'draw_your_own_dragbox')
    pg.get_by_role('button', name='Run my what-if').click(); settle(pg)
    check('area you drew' in pg.locator('.lead-q').inner_text(), 'draw-your-own: dragged box run')
    consistency(pg, 'dragged box')
    # each scenario
    for i in range(5):
        pg.locator('.rows .row').nth(i).click(); settle(pg, 1500)
        txt = pg.locator('.headline').inner_text()
        check(len(txt) > 15 and pg.locator('.row.on').count() == 1, f'scenario {i}: {txt[:90]}')
        consistency(pg, f'scenario {i}')
        shot(pg, f'scenario_{i+1}_1366x768')
    # tabs + variables
    pg.get_by_role('tab', name='With your change', exact=True).click(); pg.wait_for_timeout(300)
    check(pg.get_by_role('tab', name='With your change', exact=True).get_attribute('aria-selected') == 'true', 'tab: With your change')
    pg.get_by_role('tab', name='Normal forecast', exact=True).click(); pg.wait_for_timeout(300); shot(pg, 'tab_normal_pressure')
    for v in ['Temperature', 'Wind', 'Moisture', 'Pressure', 'Rain']:
        pg.get_by_role('tab', name=v, exact=True).click(); pg.wait_for_timeout(250)
        if v in ('Wind', 'Pressure'): shot(pg, 'var_' + v.lower())
    pg.get_by_role('tab', name='Only the change', exact=True).click()
    # scrubber
    pg.get_by_role('button', name='Play the 10 days').click(); pg.wait_for_timeout(900)
    pg.locator('.scrub input').fill('1'); pg.wait_for_timeout(1000)
    check(pg.get_by_role('button', name='Play the 10 days').count() == 1 and 'Day 1' in pg.locator('.scrub-day').inner_text(), 'scrubber: dragging pauses playback')
    check('Day 1' in pg.locator('.scrub-day').inner_text(), 'scrubber: day 1'); shot(pg, 'scrub_day1')
    pg.locator('.scrub input').fill('10'); pg.wait_for_timeout(300)
    check('Day 10' in pg.locator('.scrub-day').inner_text(), 'scrubber: day 10')
    pg.keyboard.press('ArrowLeft'); pg.wait_for_timeout(100)
    check('Day 9' in pg.locator('.scrub-day').inner_text(), 'keyboard: arrow left')
    # side panel tabs + place
    pg.get_by_role('tab', name='Spread').click(); pg.wait_for_timeout(500); check(pg.locator('.mini').count() == 4, 'spread: 4 small multiples'); shot(pg, 'spread')
    box = pg.locator('.map-box canvas').bounding_box()
    pg.mouse.click(box['x'] + 300, box['y'] + 260); pg.wait_for_timeout(600)
    check(pg.locator('.place .chart canvas').count() > 0, 'place: click map shows series'); shot(pg, 'place_series')
    pg.get_by_role('tab', name='States').click()
    # null test
    pg.get_by_role('button', name='Run again').click(); pg.wait_for_selector('.t-ok', timeout=20000)
    check('Identical forecast' in pg.locator('.t-null').inner_text() and 'IST' in pg.locator('.t-null').inner_text(), 'null test: identical, timestamp in IST')
    # expert drawer
    pg.get_by_role('button', name='Expert view').click(); pg.wait_for_selector('.drawer'); pg.wait_for_timeout(400)
    check(pg.locator('.tbl tbody tr').count() > 10, 'expert: state table'); shot(pg, 'expert_states')
    pg.get_by_role('tab', name='Ripple').click(); pg.wait_for_timeout(600); shot(pg, 'expert_ripple')
    pg.get_by_role('tab', name='Wind power').click(); check(pg.locator('.tbl tbody tr').count() == 6, 'expert: wind table')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300); check(pg.locator('.drawer').count() == 0, 'expert: Esc closes')
    # tour
    pg.get_by_role('button', name='Start tour').first.click(); pg.wait_for_selector('.tour-card'); pg.wait_for_timeout(1500)
    for k in range(7):
        check(f'Step {k+1} of 7' in pg.locator('.tour-card').inner_text(), f'tour step {k+1}')
        pg.wait_for_function("!document.querySelector('.tour-card p').innerText.includes('running')", timeout=30000); settle(pg, 900)
        body = pg.locator('.tour-card p').inner_text()
        check('running' not in body and 'last day' not in body, f'tour step {k+1} copy: {body[:110]}')
        fs = pg.evaluate("parseFloat(getComputedStyle(document.querySelector('.tour-card p')).fontSize)"); check(fs >= 13, f'tour caption font {fs}px >= 13')
        if k == 6: check(pg.locator('.builder select').nth(1).input_value() == 'bob' and 'Bay of Bengal' in body, 'tour step 7: form preset matches the caption')
        shot(pg, f'tour_step{k+1}_1366x768')
        pg.locator('.tour-card .btn.primary').click(); pg.wait_for_timeout(300)
    check(pg.locator('.tour-card').count() == 0, 'tour: Done closes')
    pg.keyboard.press('t'); pg.wait_for_selector('.tour-card'); pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    check(pg.locator('.tour-card').count() == 0, 'tour: Esc exits')
    check(not bag['err'], 'zero console/page errors ' + str(bag['err'][:3]))
    check(bag['hosts'] <= {'127.0.0.1'}, 'only 127.0.0.1 requests: ' + str(bag['hosts']))
    pg.close()
    # 1920x1080 and DPR 2
    for (w, h, dpr, nm) in [(1920, 1080, 1, '1920x1080'), (1366, 768, 2, 'dpr2_1366x768')]:
        c = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=dpr); q = c.new_page(); bag2 = {'err': [], 'hosts': set()}; watch(q, bag2)
        q.goto(URL); q.wait_for_selector('.headline', timeout=30000); settle(q, 3000); shot(q, 'landing_' + nm)
        if dpr == 1:
            consistency(q, nm)
            q.get_by_role('tab', name='Spread').click(); q.wait_for_timeout(600); shot(q, 'spread_' + nm); q.get_by_role('tab', name='States').click()
            for i in range(5):
                q.locator('.rows .row').nth(i).click(); settle(q, 1500); consistency(q, f'{nm} scenario {i}'); shot(q, f'scenario_{i+1}_{nm}')
            q.get_by_role('button', name=re.compile('Draw your own')).click(); q.wait_for_timeout(400); shot(q, 'draw_your_own_setup_' + nm)
            q.get_by_role('button', name='Run my what-if').click(); settle(q); shot(q, 'draw_your_own_result_' + nm)
            q.get_by_role('button', name='Start tour').first.click(); q.wait_for_selector('.tour-card'); q.wait_for_timeout(1200)
            for k in range(7):
                settle(q, 900); shot(q, f'tour_step{k+1}_{nm}'); q.locator('.tour-card .btn.primary').click(); q.wait_for_timeout(300)
        check(not bag2['err'] and bag2['hosts'] <= {'127.0.0.1'}, f'{nm}: no errors, local only'); c.close()
    # server down (expected network errors are excluded)
    q = b.new_page(viewport={'width': 1366, 'height': 768}); q.goto(a.base + '/v2/?server=http://127.0.0.1:9'); q.wait_for_selector('.banner', timeout=20000); q.wait_for_timeout(800)
    t = q.locator('.banner').inner_text()
    check("isn't running" in t.replace('’', "'") and '127.0.0.1' not in t and 'python' not in t.lower(), 'server down: friendly message without technical text: ' + t[:80])
    hd = q.locator('.status').inner_text()
    check('Model not running' in hd and 'serve.py' in hd and 'No internet needed' not in hd, 'server down: header ' + hd.replace('\n', ' '))
    check(q.locator('.rows .row[aria-disabled=true]').count() == 6, 'server down: scenario rows disabled')
    check('not tested yet' in q.locator('.t-null').inner_text(), 'server down: null test not tested yet')
    shot(q, 'server_down_1366x768')
    c = b.new_context(viewport={'width': 1920, 'height': 1080}); q2 = c.new_page(); q2.goto(a.base + '/v2/?server=http://127.0.0.1:9'); q2.wait_for_selector('.banner', timeout=20000); q2.wait_for_timeout(800); shot(q2, 'server_down_1920x1080'); c.close()
    q.get_by_role('button', name='Details').click(); check('python serve.py' in q.locator('.banner').inner_text(), 'server down: details behind toggle'); q.close()
    # v1 still reachable
    q = b.new_page(viewport={'width': 1366, 'height': 768}); q.goto(a.base + '/index.html?ui=v1&server=api'); q.wait_for_timeout(3000)
    check(q.locator('#story').count() == 1 and q.locator('#hdMain').count() == 1, 'v1 reachable at ?ui=v1'); q.close()
    # parity with v1 (same live model, same rollouts): the three impact figures must match v1's cards
    def lead(s): return re.match(r'\s*([+\u2212-]?[\d.]+)', s.replace('\u00a0', ' ')).group(1) if re.match(r'\s*([+\u2212-]?[\d.]+)', s.replace('\u00a0', ' ')) else s.strip()
    q = b.new_page(viewport={'width': 1366, 'height': 768}); q.goto(a.base + '/index.html?ui=v1&server=api'); q.wait_for_selector('.s-card', timeout=20000); q.wait_for_timeout(2500)
    v1 = {}
    for sid in ['bob', 'weak', 'arab', 'dry', 'lowp']:
        q.locator(f'.s-card[data-id={sid}]').click(); q.wait_for_function("document.getElementById('sBusy').hidden", timeout=20000); q.wait_for_timeout(600)
        v1[sid] = [lead(q.locator(i).inner_text()) for i in ('#farmBig', '#heatBig', '#windBig')]
    q.close()
    q = b.new_page(viewport={'width': 1366, 'height': 768}); q.goto(URL + '&auto=none'); q.wait_for_selector('.rows', timeout=20000); q.wait_for_timeout(1500)
    for i, sid in enumerate(['bob', 'weak', 'arab', 'dry', 'lowp']):
        q.locator('.rows .row').nth(i).click(); settle(q, 800)
        v2 = [lead(x) for x in q.locator('.fig .big').all_inner_texts()]
        heat_ok = v2[1] in ('\u2013', '') or abs(float(v2[1].replace('\u2212', '-'))) == abs(float(v1[sid][1].replace('\u2212', '-')))
        check(v2[0] == v1[sid][0] and v2[2] == v1[sid][2] and heat_ok, f'parity {sid}: v1 {v1[sid]} vs v3 {v2} (rain, wind equal; heat hidden below 2 days)')
    # accessibility (axe-core, serious/critical only)
    q.add_script_tag(path=str(Path(__file__).resolve().parents[2] / 'dashboard/ui/node_modules/axe-core/axe.min.js'))
    res = q.evaluate("axe.run(document, {resultTypes:['violations']}).then(r => r.violations.filter(v => ['serious','critical'].includes(v.impact)).map(v => v.id + ': ' + v.nodes.map(n => n.target.join(' ')).slice(0,3).join(' | ')))")
    check(not res, 'axe: no serious/critical violations ' + str(res)); q.close()
    b.close()
print(f'{len(fails)} failure(s)'); sys.exit(1 if fails else 0)
