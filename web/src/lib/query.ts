// Explorer query grammar v2 (F11, Datadog explorer syntax). Space-separated
// tokens AND implicitly; `-tok` / `!tok` / `not:tok` negate; `key:value`
// scopes a token to one field; `a|b` inside a value is OR; `*` and `?` are
// wildcards; "quoted phrase" keeps embedded spaces. Anything unrecognized
// degrades to free-text substring match — parsing never throws.

export interface QueryTerm {
  /** field name when the token was `key:value` (lowercased) */
  key?: string;
  /** raw value — may still carry `|` alternatives and `*`/`?` wildcards */
  value: string;
  negated: boolean;
  /** token (or `key:` value) was wrapped in double quotes — literal match */
  phrase: boolean;
}

export interface QueryAST {
  raw: string;
  terms: QueryTerm[];
}

export type QueryFields = Record<string, string | string[] | undefined>;

/** Whitespace split that keeps "quoted spans" (and key:"quoted" values)
 *  together. An unterminated quote simply runs to the end of input. */
function splitTokens(q: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (const ch of q) {
    if (ch === '"') { quoted = !quoted; cur += ch; continue; }
    if (quoted || !/\s/.test(ch)) { cur += ch; continue; }
    if (cur) { out.push(cur); cur = ''; }
  }
  if (cur) out.push(cur);
  return out;
}

function parseTerm(raw: string): QueryTerm | null {
  let s = raw;
  let negated = false;
  // a leading run of -/! flips parity; `not:` is a word-prefix negation
  while (s.startsWith('-') || s.startsWith('!')) {
    negated = !negated;
    s = s.slice(1);
  }
  if (/^not:/i.test(s)) {
    negated = !negated;
    s = s.slice(4);
  }
  if (!s) return null;

  let phrase = false;
  const unquote = (v: string): string => {
    if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
      phrase = true;
      return v.slice(1, -1);
    }
    if (v.startsWith('"')) { // unterminated — treat the rest as the phrase
      phrase = true;
      return v.slice(1);
    }
    return v;
  };

  const ci = s.indexOf(':');
  if (ci > 0) {
    return { key: s.slice(0, ci).toLowerCase(), value: unquote(s.slice(ci + 1)), negated, phrase };
  }
  return { value: unquote(s), negated, phrase };
}

export function parseQuery(q: string): QueryAST {
  const terms: QueryTerm[] = [];
  for (const tok of splitTokens(q)) {
    const term = parseTerm(tok);
    if (term) terms.push(term);
  }
  return { raw: q, terms };
}

const WILDCARD = /[*?]/;

/** Wildcard → regex. The pattern is NOT anchored: `conv*` reads as
 *  "contains conv…" so dotted UNS paths match on any segment boundary —
 *  consistent with the free-text substring baseline. */
function toRegex(v: string): RegExp {
  const src = v.replace(/[.*+?^${}()|[\]\\]/g, (ch) =>
    ch === '*' ? '.*' : ch === '?' ? '.' : `\\${ch}`);
  return new RegExp(src, 'i');
}

function altMatch(alt: string, text: string): boolean {
  if (alt === '') return true;
  if (WILDCARD.test(alt)) return toRegex(alt).test(text);
  return text.toLowerCase().includes(alt.toLowerCase());
}

function valueMatch(term: QueryTerm, text: string): boolean {
  // quoted phrases are literal — `|` and wildcards inside them stay inert
  if (term.phrase) return text.toLowerCase().includes(term.value.toLowerCase());
  return term.value.split('|').some((alt) => altMatch(alt, text));
}

function fieldValues(fields: QueryFields, key: string): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (k.toLowerCase() !== key || v === undefined) continue;
    if (Array.isArray(v)) out.push(...v);
    else out.push(v);
  }
  return out;
}

function allValues(fields: QueryFields): string[] {
  const out: string[] = [];
  for (const v of Object.values(fields)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) out.push(...v);
    else out.push(v);
  }
  return out;
}

function termHit(term: QueryTerm, fields: QueryFields): boolean {
  const hit = term.key === undefined
    ? allValues(fields).some((v) => valueMatch(term, v))
    : fieldValues(fields, term.key).some((v) => valueMatch(term, v));
  // a negated term on a missing field passes — "not sev:critical" is true
  // when there is no sev at all
  return term.negated ? !hit : hit;
}

export function matchQuery(ast: QueryAST, fields: QueryFields): boolean {
  return ast.terms.every((t) => termHit(t, fields));
}
