import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** A stylesheet's text without comments. */
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const root = /:root\s*\{([^}]*)\}/.exec(read('./styles.css'))?.[1] ?? '';
const tokens = Object.fromEntries([...root.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(match => [match[1]!, match[2]!.trim()]));
const resolve = (value: string) => value.replace(/var\(--([\w-]+)\)/g, (_match, name: string) => tokens[name] ?? name);

/** sRGB relative luminance of [r, g, b] (0 to 255). */
function luminance(rgb: number[]) {
  const channel = (value: number) => { const v = value / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * channel(rgb[0]!) + 0.7152 * channel(rgb[1]!) + 0.0722 * channel(rgb[2]!);
}
/** A CSS colour (#rrggbb or rgb(r g b / a)), or a token, laid over an opaque background, as [r, g, b]. */
function over(color: string, background: number[] = [0, 0, 0]) {
  const value = resolve(color);
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  const parts = hex ? [0, 2, 4].map(at => parseInt(hex[1]!.slice(at, at + 2), 16)).concat(1)
    : (/^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+))?\s*\)$/.exec(value)?.slice(1).map(part => (part === undefined ? 1 : Number(part))) ?? []);
  if (parts.length !== 4) throw new Error(`not a colour: ${color}`);
  return parts.slice(0, 3).map((part, index) => part * parts[3]! + background[index]! * (1 - parts[3]!));
}
const contrast = (a: number[], b: number[]) => { const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (high! + 0.05) / (low! + 0.05); };

/** The text colour a stylesheet gives `selector` (the last rule that names it and sets a colour). */
function colorOf(file: string, selector: string) {
  let found: string | undefined;
  for (const [, selectors, body] of read(file).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const names = selectors!.split(',').map(name => name.trim().replace(/\s+/g, ' '));
    const color = /(?:^|;)\s*color:\s*([^;]+)/.exec(body!)?.[1]?.trim();
    if (color && names.includes(selector)) found = color;
  }
  if (!found) throw new Error(`${selector} sets no colour in ${file}`);
  return found;
}

const page = over('var(--surface-bg)'), card = over('var(--surface-card)'), hover = over('#fbfaf8'), subtle = over('var(--surface-subtle)');
const dark = over('var(--chrome-950)'), darkRaised = over('var(--chrome-900)');

describe('small grey text', () => {
  it('meets AA (4.5:1) in --text-3 on the page, the cards and the hovered rows', () => {
    expect(tokens['text-3']).toBe('#76706a');
    for (const background of [page, card, hover]) expect(contrast(over('var(--text-3)', background), background)).toBeGreaterThanOrEqual(4.5);
  });

  it('meets AA where the old grey failed: the fire danger card, the recap, notes and the legend', () => {
    const cases: [string, string, number[][]][] = [
      ['./styles/bpbd.css', '.bd-danger-text .caption', [card]],
      ['./styles/bpbd.css', '.fwi-partial', [card]],
      ['./styles/bpbd.css', '.bd-kpi-note', [card, hover]],
      ['./styles/bpbd.css', '.bd-lane-note', [page]],
      ['./styles/bpbd.css', '.bd-table th', [subtle]],
      ['./styles/bpbd.css', '.bd-assignee.on small', [subtle]],
      ['./styles.css', '.note', [page, card]],
      ['./styles.css', '.map-loading', [over('#e8e6e1')]],
      ['./styles.css', '.option.on .text small', [subtle, over('rgb(232 89 12 / 0.07)', card)]],
      ['./styles/shell.css', '.lg-note', [card]],
    ];
    for (const [file, selector, backgrounds] of cases) {
      const color = colorOf(file, selector);
      for (const background of backgrounds) expect(contrast(over(color, background), background), `${selector}: ${color}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('meets AA in --chrome-text-3 on the three dark surfaces, and on a hovered or chosen role row', () => {
    for (const background of [dark, darkRaised, over('var(--chrome-800)')]) expect(contrast(over('var(--chrome-text-3)', background), background)).toBeGreaterThanOrEqual(4.5);
    const chosen = colorOf('./styles/shell.css', '.rolelist-item.on .rolelist-text small');
    expect(contrast(over(chosen, subtle), subtle)).toBeGreaterThanOrEqual(4.5);
    expect(colorOf('./styles/shell.css', '.rolelist-item:hover:not(:disabled) .rolelist-text small')).toBe(chosen);
  });

  it('keeps the dark sidebar\'s muted and empty lines at least as clear as before the change', () => {
    // #8a837c, the old --text-3, measured 4.95:1 there; the new one would measure 3.78:1.
    for (const selector of ['.dark .muted', '.dark .empty']) {
      const color = colorOf('./styles.css', selector);
      for (const background of [dark, darkRaised]) expect(contrast(over(color, background), background), selector).toBeGreaterThanOrEqual(contrast(over('#8a837c'), background));
    }
  });
});
