// Console v6 colour pairs (plan §1.3). The theme file is the only place a
// colour value may live, so the contrast targets are asserted against it
// rather than against a component that happens to render it.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../dd-theme.css', import.meta.url), 'utf8');
// Dark ink lives in tokens.css (imported after this file and not ours), so the
// dark check reads the real mapping instead of assuming dd-theme's light value.
const tokensCss = readFileSync(new URL('../../theme/tokens.css', import.meta.url), 'utf8');

/** Custom properties inside the block that opens after `start`. */
function parseAt(src: string, start: string, from = 0): Record<string, string> {
  const at = src.lastIndexOf(start, from || src.length);
  if (at < 0) throw new Error(`block not found: ${start}`);
  const open = src.indexOf('{', at);
  let depth = 0;
  let end = open;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) { end = i; break; }
  }
  const out: Record<string, string> = {};
  for (const m of src.slice(open, end).matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const light = parseAt(css, '@theme {');
const dark = {
  ...parseAt(tokensCss, ':root[data-theme=dark]'),
  ...parseAt(css, ':root[data-theme=dark]'),
};

const hex = (name: string) => {
  const v = light[name];
  if (!v) throw new Error(`missing token ${name}`);
  return v;
};

function luminance(color: string): number {
  const c = color.replace('#', '');
  const ch = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('readout ink and secondary text reach 7:1 on the readout panel', () => {
  const panel = hex('--color-readout');
  expect(contrast(hex('--color-readout-ink'), panel)).toBeGreaterThanOrEqual(7);
  expect(contrast(hex('--color-readout-dim'), panel)).toBeGreaterThanOrEqual(7);
});

test('a stale or failed readout stays legible on the dark panel', () => {
  const panel = hex('--color-readout');
  expect(contrast(hex('--color-warn-on-dark'), panel)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(hex('--color-crit-on-dark'), panel)).toBeGreaterThanOrEqual(4.5);
});

test('the selected row keeps ink at 4.5:1 in both themes', () => {
  expect(contrast(hex('--color-ink'), hex('--color-row-selected'))).toBeGreaterThanOrEqual(4.5);
  expect(contrast(dark['--color-ink'], dark['--color-row-selected'])).toBeGreaterThanOrEqual(4.5);
});

test('every command chip label reaches 4.5:1', () => {
  const ink = hex('--color-cmd-ink');
  for (const kind of ['home', 'move', 'set', 'wait', 'loop', 'end', 'other']) {
    expect(contrast(ink, hex(`--color-cmd-${kind}`))).toBeGreaterThanOrEqual(4.5);
  }
});

test('console v6 density tokens are declared', () => {
  expect(hex('--row-h-compact')).toBe('28px');
  expect(hex('--row-h')).toBe('32px');
  expect(hex('--tool-btn-w')).toBe('56px');
  expect(hex('--font-mono')).toContain('IBM Plex Mono');
});

test('legacy token names keep their values', () => {
  expect(hex('--color-blue')).toBe('#2a64c8');
  expect(hex('--color-ink')).toBe('#18202a');
  expect(hex('--color-paper')).toBe('#ffffff');
  expect(hex('--color-line')).toBe('#dfe3e8');
  expect(hex('--color-danger')).toBe('#b42318');
});
