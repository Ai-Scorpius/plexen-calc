// ===========================================
// PLEXEN Calculator — exact-math number tower
// A Real is one of:
//   { k:'rat',  p, q }        exact rational p/q  (BigInt, q>0, reduced)
//   { k:'surd', a, b, c, d }  exact (a + b·√c)/d  (BigInt; c square-free ≥2, d>0)
//   { k:'dec',  x }           inexact JS double   (irrational / fallback)
//
// Arithmetic stays exact while it can (rationals; surds sharing a radicand)
// and drops to 'dec' otherwise — mirroring how the Scientific keeps a result
// exact until an operation forces a decimal. Everything a calculation can
// produce funnels through these constructors so results auto-reduce.
// ===========================================

// ---- BigInt helpers --------------------------------------------------
function gcdBig(a, b) {
    a = a < 0n ? -a : a;
    b = b < 0n ? -b : b;
    while (b) { [a, b] = [b, a % b]; }
    return a;
}

function isqrtBig(n) {
    if (n < 0n) return -1n;
    if (n < 2n) return n;
    let x = n, y = (x + 1n) / 2n;
    while (y < x) { x = y; y = (x + n / x) / 2n; }
    return x;
}

// Largest square factor removed: √n = f·√m with m square-free. Returns [f, m].
function reduceRadical(n) {
    if (n <= 0n) return [0n, n];
    let f = 1n, m = n;
    let d = 2n;
    while (d * d <= m) {
        while (m % (d * d) === 0n) { m /= d * d; f *= d; }
        d += 1n;
    }
    return [f, m];
}

const digitsOf = (b) => (b < 0n ? -b : b).toString().length;

// ---- constructors ----------------------------------------------------
export function rat(p, q = 1n) {
    p = BigInt(p); q = BigInt(q);
    if (q === 0n) throw { kind: 'math' };
    if (q < 0n) { p = -p; q = -q; }
    const g = gcdBig(p, q) || 1n;
    return { k: 'rat', p: p / g, q: q / g };
}

export const int = (n) => rat(BigInt(n), 1n);
export const dec = (x) => ({ k: 'dec', x });
export const ZERO = int(0);
export const ONE = int(1);

// (a + b√c)/d, normalized. Collapses to a rational when b or c degenerate.
export function surd(a, b, c, d) {
    a = BigInt(a); b = BigInt(b); c = BigInt(c); d = BigInt(d);
    if (d === 0n) throw { kind: 'math' };
    if (c < 0n) throw { kind: 'math' };
    // pull square factors out of c into b
    if (c > 1n) { const [f, m] = reduceRadical(c); b *= f; c = m; }
    if (b === 0n || c === 0n) return rat(a, d);
    if (c === 1n) return rat(a + b, d);
    if (d < 0n) { a = -a; b = -b; d = -d; }
    const g = gcdBig(gcdBig(a < 0n ? -a : a, b < 0n ? -b : b), d) || 1n;
    return { k: 'surd', a: a / g, b: b / g, c, d: d / g };
}

// Exact rational from a decimal string ("12.34", ".5", "-3") — so 0.1 is
// literally 1/10, and 0.1 + 0.2 is exactly 3/10.
export function fromDecimalString(s) {
    let neg = false;
    if (s[0] === '-') { neg = true; s = s.slice(1); }
    const [ip = '0', fp = ''] = s.split('.');
    const p = BigInt((ip || '0') + fp) * (neg ? -1n : 1n);
    const q = 10n ** BigInt(fp.length);
    return rat(p, q);
}

// ---- coercion --------------------------------------------------------
export function toNumber(r) {
    switch (r.k) {
        case 'rat': return Number(r.p) / Number(r.q);
        case 'surd': return (Number(r.a) + Number(r.b) * Math.sqrt(Number(r.c))) / Number(r.d);
        default: return r.x;
    }
}
export const isRat = (r) => r.k === 'rat';
export const isExact = (r) => r.k === 'rat' || r.k === 'surd';

// ---- arithmetic ------------------------------------------------------
export function neg(a) {
    if (a.k === 'rat') return { k: 'rat', p: -a.p, q: a.q };
    if (a.k === 'surd') return surd(-a.a, -a.b, a.c, a.d);
    return dec(-a.x);
}

export function add(a, b) {
    if (a.k === 'rat' && b.k === 'rat') return rat(a.p * b.q + b.p * a.q, a.q * b.q);
    // rational + surd, or surds with the same radicand
    const sa = asSurd(a), sb = asSurd(b);
    if (sa && sb && sa.c === sb.c) {
        const d = sa.d * sb.d;
        return surd(sa.a * sb.d + sb.a * sa.d, sa.b * sb.d + sb.b * sa.d, sa.c, d);
    }
    return dec(toNumber(a) + toNumber(b));
}
export const sub = (a, b) => add(a, neg(b));

export function mul(a, b) {
    if (a.k === 'rat' && b.k === 'rat') return rat(a.p * b.p, a.q * b.q);
    const sa = asSurd(a), sb = asSurd(b);
    if (sa && sb && sa.c === sb.c) {
        // (a1+b1√c)(a2+b2√c) = a1a2 + b1b2·c + (a1b2+a2b1)√c
        const d = sa.d * sb.d;
        const A = sa.a * sb.a + sa.b * sb.b * sa.c;
        const B = sa.a * sb.b + sb.a * sa.b;
        return surd(A, B, sa.c, d);
    }
    // rational × surd
    if (sa && b.k === 'rat') return surd(sa.a * b.p, sa.b * b.p, sa.c, sa.d * b.q);
    if (sb && a.k === 'rat') return surd(sb.a * a.p, sb.b * a.p, sb.c, sb.d * a.q);
    return dec(toNumber(a) * toNumber(b));
}

export function div(a, b) {
    if (a.k === 'rat' && b.k === 'rat') {
        if (b.p === 0n) throw { kind: 'math' };
        return rat(a.p * b.q, a.q * b.p);
    }
    // surd ÷ rational
    const sa = asSurd(a);
    if (sa && b.k === 'rat') {
        if (b.p === 0n) throw { kind: 'math' };
        return surd(sa.a * b.q, sa.b * b.q, sa.c, sa.d * b.p);
    }
    // rational ÷ surd → rationalize: p/(a+b√c) = p(a−b√c)/(a²−b²c)
    const sb = asSurd(b);
    if (a.k === 'rat' && sb) {
        const denom = sb.a * sb.a - sb.b * sb.b * sb.c; // times 1/d² but cancels
        if (denom === 0n) throw { kind: 'math' };
        // a/((sb.a+sb.b√c)/sb.d) = a·sb.d·(sb.a−sb.b√c)/denom
        return surd(a.p * sb.d * sb.a, -a.p * sb.d * sb.b, sb.c, a.q * denom);
    }
    const bn = toNumber(b);
    if (bn === 0) throw { kind: 'math' };
    return dec(toNumber(a) / bn);
}

// View a rational as a degenerate surd (b=0) so add/mul can share a path.
function asSurd(r) {
    if (r.k === 'surd') return r;
    if (r.k === 'rat') return { a: r.p, b: 0n, c: 0n, d: r.q };
    return null;
}

// Integer power; exact for rational/surd bases, else inexact.
export function pow(base, exp) {
    if (exp.k === 'rat' && exp.q === 1n) {
        let n = exp.p;
        if (n > -1000n && n < 1000n) { // keep BigInt powers bounded
            if (base.k === 'rat') {
                if (n >= 0n) return rat(base.p ** n, base.q ** n);
                if (base.p === 0n) throw { kind: 'math' };
                const m = -n;
                return rat(base.q ** m, base.p ** m);
            }
            if (base.k === 'surd') {
                if (n === 0n) return ONE;
                const neg1 = n < 0n;
                let m = neg1 ? -n : n;
                let acc = ONE;
                for (let i = 0n; i < m; i++) acc = mul(acc, base);
                return neg1 ? div(ONE, acc) : acc;
            }
        }
    }
    const r = Math.pow(toNumber(base), toNumber(exp));
    if (isNaN(r) || !isFinite(r)) throw { kind: 'math' };
    return dec(r);
}

export function factorial(a) {
    if (a.k !== 'rat' || a.q !== 1n) throw { kind: 'math' };
    const n = a.p;
    if (n < 0n || n > 69n) throw { kind: 'math' };
    let f = 1n;
    for (let i = 2n; i <= n; i++) f *= i;
    return { k: 'rat', p: f, q: 1n };
}

function asIntBig(a) {
    if (a.k !== 'rat' || a.q !== 1n) throw { kind: 'math' };
    return a.p;
}

// nPr = n!/(n−r)! — exact. Domain 0 ≤ r ≤ n < 10¹⁰.
export function nPr(nR, rR) {
    const n = asIntBig(nR), r = asIntBig(rR);
    if (r < 0n || n < 0n || r > n || n >= 10000000000n) throw { kind: 'math' };
    let acc = 1n;
    for (let i = 0n; i < r; i++) acc *= (n - i);
    return { k: 'rat', p: acc, q: 1n };
}

// nCr = nPr/r! — exact (divides evenly).
export function nCr(nR, rR) {
    const p = nPr(nR, rR).p;
    const r = asIntBig(rR);
    let rf = 1n;
    for (let i = 2n; i <= r; i++) rf *= i;
    return rat(p, rf);
}

export function gcdReal(aR, bR) {
    return { k: 'rat', p: gcdBig(asIntBig(aR), asIntBig(bR)), q: 1n };
}

export function lcmReal(aR, bR) {
    const a = asIntBig(aR), b = asIntBig(bR);
    const g = gcdBig(a, b);
    if (g === 0n) return { k: 'rat', p: 0n, q: 1n };
    const l = (a / g) * b;
    return { k: 'rat', p: l < 0n ? -l : l, q: 1n };
}

// integer cube root of a BigInt (handles negatives)
function icbrt(n) {
    const neg = n < 0n;
    let m = neg ? -n : n;
    if (m < 2n) return neg ? -m : m;
    let x = m, y = (2n * x + m / (x * x)) / 3n;
    while (y < x) { x = y; y = (2n * x + m / (x * x)) / 3n; }
    return neg ? -x : x;
}

// ∛ of a rational → exact when it's a perfect cube; else inexact.
export function cbrt(a) {
    if (a.k === 'rat') {
        const pc = icbrt(a.p), qc = icbrt(a.q);
        if (pc ** 3n === a.p && qc ** 3n === a.q) return rat(pc, qc);
    }
    return dec(Math.cbrt(toNumber(a)));
}

// √ of a rational → exact surd/rational; else inexact.
export function sqrt(a) {
    if (a.k === 'rat') {
        if (a.p < 0n) throw { kind: 'math' };
        // √(p/q) = √(p·q) / q
        return surd(0n, 1n, a.p * a.q, a.q);
    }
    const n = toNumber(a);
    if (n < 0) throw { kind: 'math' };
    return dec(Math.sqrt(n));
}

// ---- display ---------------------------------------------------------
// Returns the exact fraction/surd string, or null if the value should be
// shown as a decimal (integer too long, or fits the ≤10-digit rule fails).
export function toExactString(r) {
    if (r.k === 'rat') {
        if (r.q === 1n) return digitsOf(r.p) <= 10 ? r.p.toString() : null;
        if (digitsOf(r.p) + digitsOf(r.q) <= 10) return `${r.p}/${r.q}`;
        return null;
    }
    if (r.k === 'surd') {
        // Build (a + b√c)/d in the calculator's linear glyphs. A pure b√c
        // numerator (a=0) needs no parentheses before /d.
        const root = `√${r.c}`;
        let numer, twoTerm = false;
        if (r.a === 0n) {
            numer = (r.b === 1n ? root : r.b === -1n ? `-${root}` : `${r.b}${root}`);
        } else {
            const sign = r.b < 0n ? '-' : '+';
            const bAbs = r.b < 0n ? -r.b : r.b;
            const bStr = bAbs === 1n ? root : `${bAbs}${root}`;
            numer = `${r.a}${sign}${bStr}`;
            twoTerm = true;
        }
        const s = r.d === 1n ? numer : `${twoTerm ? `(${numer})` : numer}/${r.d}`;
        return s.replace(/[()]/g, '').length <= 12 ? s : null; // rough fit rule
    }
    return null;
}
