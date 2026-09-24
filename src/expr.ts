/**
 * A tiny, safe math expression language — what makes a scene interactive
 * without making it executable.
 *
 * Brilliant-style interactives need formulas: a curve `exp(-a*x)*sin(b*x)`
 * that follows two sliders, a point at `300 + 40*a`, a readout `{2*a:1}`. A
 * spec may come from a model or a stranger, so `eval`/`new Function` are out
 * of the question. This is a real parser instead: numbers, named variables,
 * + − × ÷ % ^, parentheses and a whitelist of functions. Nothing else parses,
 * every name is checked when the expression is compiled, and lookups go
 * through Maps, so `constructor` or `__proto__` can never reach JavaScript.
 *
 * Grammar (precedence low → high; ^ is right-associative):
 *   expr  := term (('+' | '-') term)*
 *   term  := unary (('*' | '/' | '%') unary)*
 *   unary := ('-' | '+') unary | power
 *   power := atom ('^' unary)?
 *   atom  := number | name | name '(' expr (',' expr)* ')' | '(' expr ')'
 */

export class ExprError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExprError';
  }
}

export type Env = Readonly<Record<string, number>>;
export type Compiled = (env: Env) => number;

/** Longest expression accepted, and deepest nesting. Specs are data; keep them small. */
export const EXPR_LIMITS = { length: 500, depth: 40 } as const;

const FUNCTIONS = new Map<string, { arity: number | 'any'; fn: (...a: number[]) => number }>([
  ['sin', { arity: 1, fn: Math.sin }],
  ['cos', { arity: 1, fn: Math.cos }],
  ['tan', { arity: 1, fn: Math.tan }],
  ['asin', { arity: 1, fn: Math.asin }],
  ['acos', { arity: 1, fn: Math.acos }],
  ['atan', { arity: 1, fn: Math.atan }],
  ['atan2', { arity: 2, fn: Math.atan2 }],
  ['sinh', { arity: 1, fn: Math.sinh }],
  ['cosh', { arity: 1, fn: Math.cosh }],
  ['tanh', { arity: 1, fn: Math.tanh }],
  ['exp', { arity: 1, fn: Math.exp }],
  ['ln', { arity: 1, fn: Math.log }],
  ['log', { arity: 1, fn: Math.log10 }],
  ['log2', { arity: 1, fn: Math.log2 }],
  ['sqrt', { arity: 1, fn: Math.sqrt }],
  ['cbrt', { arity: 1, fn: Math.cbrt }],
  ['abs', { arity: 1, fn: Math.abs }],
  ['sign', { arity: 1, fn: Math.sign }],
  ['floor', { arity: 1, fn: Math.floor }],
  ['ceil', { arity: 1, fn: Math.ceil }],
  ['round', { arity: 1, fn: Math.round }],
  ['pow', { arity: 2, fn: Math.pow }],
  ['mod', { arity: 2, fn: (a, b) => ((a % b) + b) % b }],
  ['clamp', { arity: 3, fn: (v, lo, hi) => Math.min(hi, Math.max(lo, v)) }],
  ['lerp', { arity: 3, fn: (a, b, t) => a + (b - a) * t }],
  ['min', { arity: 'any', fn: Math.min }],
  ['max', { arity: 'any', fn: Math.max }],
  ['hypot', { arity: 'any', fn: Math.hypot }],
]);

const CONSTANTS = new Map<string, number>([
  ['pi', Math.PI],
  ['e', Math.E],
  ['tau', Math.PI * 2],
]);

/** Names a parameter may not take, because the language already means something by them. */
export function isReservedName(name: string): boolean {
  return FUNCTIONS.has(name) || CONSTANTS.has(name) || name === 't' || name === 'x';
}

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'name'; value: string }
  | { kind: 'op'; value: string };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i++;
    } else if (/[0-9.]/.test(ch)) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new ExprError(`bad number at ${i}`);
      tokens.push({ kind: 'num', value: Number(m[0]) });
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_]\w*/.exec(src.slice(i))!;
      tokens.push({ kind: 'name', value: m[0] });
      i += m[0].length;
    } else if ('+-*/%^(),'.includes(ch)) {
      tokens.push({ kind: 'op', value: ch });
      i++;
    } else {
      throw new ExprError(`unexpected ${JSON.stringify(ch)} at ${i}`);
    }
  }
  return tokens;
}

/**
 * Parse and compile `src`, allowing the variables in `vars` (plus constants
 * and functions). Throws `ExprError` on anything else — at compile time, so a
 * bad spec fails when it is loaded, not in the middle of a frame.
 */
export function compile(src: string, vars: Iterable<string>): Compiled {
  if (typeof src !== 'string') throw new ExprError('expression must be a string');
  if (src.length > EXPR_LIMITS.length) throw new ExprError(`expression longer than ${EXPR_LIMITS.length} characters`);
  const allowed = new Set(vars);
  const tokens = tokenize(src);
  let pos = 0;
  let depth = 0;

  const peek = () => tokens[pos];
  const isOp = (v: string) => {
    const t = tokens[pos];
    return t?.kind === 'op' && t.value === v;
  };
  const expectOp = (v: string) => {
    if (!isOp(v)) throw new ExprError(`expected ${JSON.stringify(v)}`);
    pos++;
  };
  const nest = <T>(f: () => T): T => {
    if (++depth > EXPR_LIMITS.depth) throw new ExprError('expression nested too deeply');
    try {
      return f();
    } finally {
      depth--;
    }
  };

  const expr = (): Compiled =>
    nest(() => {
      let left = term();
      while (isOp('+') || isOp('-')) {
        const op = tokens[pos++]!.value;
        const l = left;
        const r = term();
        left = op === '+' ? (env) => l(env) + r(env) : (env) => l(env) - r(env);
      }
      return left;
    });

  const term = (): Compiled => {
    let left = unary();
    while (isOp('*') || isOp('/') || isOp('%')) {
      const op = tokens[pos++]!.value;
      const l = left;
      const r = unary();
      left =
        op === '*' ? (env) => l(env) * r(env) : op === '/' ? (env) => l(env) / r(env) : (env) => l(env) % r(env);
    }
    return left;
  };

  const unary = (): Compiled =>
    nest(() => {
      if (isOp('-')) {
        pos++;
        const u = unary();
        return (env) => -u(env);
      }
      if (isOp('+')) {
        pos++;
        return unary();
      }
      return power();
    });

  const power = (): Compiled => {
    const base = atom();
    if (isOp('^')) {
      pos++;
      const exp = unary();
      return (env) => Math.pow(base(env), exp(env));
    }
    return base;
  };

  const atom = (): Compiled => {
    const t = peek();
    if (!t) throw new ExprError('unexpected end of expression');
    if (t.kind === 'num') {
      pos++;
      const v = t.value;
      return () => v;
    }
    if (t.kind === 'op' && t.value === '(') {
      pos++;
      const inner = expr();
      expectOp(')');
      return inner;
    }
    if (t.kind === 'name') {
      pos++;
      const name = t.value;
      if (isOp('(')) {
        const f = FUNCTIONS.get(name);
        if (!f) throw new ExprError(`unknown function ${JSON.stringify(name)}`);
        pos++;
        const args: Compiled[] = [];
        if (!isOp(')')) {
          args.push(expr());
          while (isOp(',')) {
            pos++;
            args.push(expr());
          }
        }
        expectOp(')');
        if (f.arity !== 'any' && args.length !== f.arity) {
          throw new ExprError(`${name} takes ${f.arity} argument${f.arity === 1 ? '' : 's'}`);
        }
        if (f.arity === 'any' && args.length === 0) throw new ExprError(`${name} needs arguments`);
        return (env) => f.fn(...args.map((a) => a(env)));
      }
      const c = CONSTANTS.get(name);
      if (c !== undefined) return () => c;
      if (!allowed.has(name)) throw new ExprError(`unknown name ${JSON.stringify(name)}`);
      // Own-property read only: env objects are plain, but never trust the prototype.
      return (env) => (Object.prototype.hasOwnProperty.call(env, name) ? env[name]! : NaN);
    }
    throw new ExprError(`unexpected ${JSON.stringify(t.value)}`);
  };

  const result = expr();
  if (pos !== tokens.length) throw new ExprError(`unexpected ${JSON.stringify(String(tokens[pos]!.value))}`);
  return result;
}

/**
 * A text template: literal text with `{expr}` or `{expr:digits}` holes, e.g.
 * `"a = {a:2}, period = {2*pi/b:1} s"`. Returns a function producing the
 * string, and throws `ExprError` on a bad hole.
 */
export function compileTemplate(src: string, vars: Iterable<string>): (env: Env) => string {
  const allowed = [...vars];
  const parts: Array<string | ((env: Env) => string)> = [];
  const re = /\{([^{}:]+)(?::(\d))?\}/g;
  let last = 0;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    parts.push(src.slice(last, m.index));
    const f = compile(m[1]!, allowed);
    const digits = m[2] === undefined ? undefined : Number(m[2]);
    parts.push((env) => {
      const v = f(env);
      if (!Number.isFinite(v)) return '—';
      return digits === undefined ? String(Math.round(v * 1000) / 1000) : v.toFixed(digits);
    });
    last = m.index + m[0].length;
  }
  parts.push(src.slice(last));
  return (env) => parts.map((p) => (typeof p === 'string' ? p : p(env))).join('');
}

/** True when `src` contains at least one `{…}` hole. */
export const isTemplate = (src: string): boolean => /\{[^{}]+\}/.test(src);
