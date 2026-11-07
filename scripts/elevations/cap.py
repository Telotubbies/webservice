"""Render each mapped plant part orthographically from the real GLB into web/public/elevations/*.webp (2x).

Usage: python scripts/elevations/cap.py   (needs `bun install` in web/ and Edge for Playwright)
Writes web/public/elevations/<slug>.webp and web/src/features/line/elevations.json (metre sizes per image).
"""
import sys, os, re, json, base64, io, threading, functools, http.server
from PIL import Image
from playwright.sync_api import sync_playwright
sys.stdout.reconfigure(encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
WEB = os.path.join(ROOT, 'web')
OUT = os.path.join(WEB, 'public', 'elevations'); os.makedirs(OUT, exist_ok=True)
PPM = 52          # px per metre = 2x of the board's 26 css px/m
TINY_PPM = 440    # parts under 0.6 m (the motor) are rendered close up; the board enlarges them to a minimum size
src = open(os.path.join(WEB, 'src', 'lib', 'plantModel.ts'), encoding='utf-8').read()
parts = [{'label': m[0], 'kind': m[1], 'nodes': [int(x) for x in m[2].split(',')]}
         for m in re.findall(r"\{ label: '([^']+)', kind: '([^']+)', nodes: \[([\d, ]+)\]", src)]
parts = [p for p in parts if p['kind'] != 'pipe']   # a pipe's box spans the plant; flow is drawn as connectors
for p in parts:
    if p['kind'] == 'conveyor': p['pitch'] = 32      # thin belts: slight 3/4 angle so the top shows
    if p['label'] == 'Motor': p['ppm'] = TINY_PPM
# The skip hoist part (node 15) is only the bucket; the track it rides is scenery.
# Nodes found with window.probe([-4.5,0.5,-1.5,1.5,12]).
parts.append({'label': 'Skip track', 'kind': 'scenery', 'pitch': 0, 'nodes': [9, 14, 66, 68, 70, 72, 75, 77, 79, 82, 84, 86, 89, 91, 93, 96, 98, 100, 103, 105, 107, 110, 112, 114, 116]})
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Q, directory=WEB))
threading.Thread(target=srv.serve_forever, daemon=True).start()
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, channel='msedge', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'])
    pg = b.new_page()
    pg.on('pageerror', lambda e: print('ERR', str(e)[:300]))
    pg.route('**/__cap.html', lambda r: r.fulfill(path=os.path.join(HERE, 'cap.html'), content_type='text/html'))
    pg.goto(f'http://127.0.0.1:{srv.server_address[1]}/__cap.html')
    pg.wait_for_function('window.ready===true', timeout=60000)
    res = pg.evaluate('(a)=>window.capture(a.parts,a.k)', {'parts': parts, 'k': PPM})
    b.close()
man = {}; total = 0
for r in res:
    if r.get('empty'): print('EMPTY', r['label']); continue
    slug = re.sub(r'[^a-z0-9]+', '-', r['label'].lower()).strip('-')
    im = Image.open(io.BytesIO(base64.b64decode(r['url'].split(',')[1]))).convert('RGBA')
    fn = slug + '.webp'; path = os.path.join(OUT, fn)
    im.save(path, 'WEBP', quality=80, method=6); total += os.path.getsize(path)
    man[r['label']] = {'file': fn, 'w': r['w'], 'h': r['h'], 'mw': r['mw'], 'mh': r['mh'], 'view': r['view'],
                       'box': r['box']['min'] + r['box']['max']}
    print(r['label'], r['view'], r['w'], r['h'], os.path.getsize(path))
json.dump(man, open(os.path.join(WEB, 'src', 'features', 'line', 'elevations.json'), 'w'), indent=1)
print('done', len(man), 'files', round(total / 1024), 'KB')
