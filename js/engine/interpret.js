// ===========================================
// PLEXEN Calculator — AST evaluator (exact-math tower)
// Walks the parser's AST computing in Real values (js/engine/real.js), so
// integer/fraction inputs stay exact (1÷5 → 1/5, √8 → 2√2) and irrational
// operations fall back to a decimal. Applies the Scientific domain
// rules and error taxonomy:
//   parse failure        → Syntax ERROR (with token position)
//   domain/range failure → Math ERROR
//   nesting too deep      → Stack ERROR
// ===========================================
import { parse } from './parser.js';
import { statValue, estimateY, estimateX, estimateXQuad } from './stat.js';
import {
    rat, int, dec, ONE, fromDecimalString,
    add, sub, mul, div, neg, pow, factorial, sqrt as sqrtReal,
    nPr, nCr, gcdReal, lcmReal, cbrt,
    toNumber, isExact,
} from './real.js';

const MAX_MAG = 1e100; //  overflows beyond ±9.999999999×10⁹⁹

function absReal(r) {
    if (r.k === 'dec') return dec(Math.abs(r.x));
    return toNumber(r) < 0 ? neg(r) : r;
}

function applyFunc(name, xR, ctx, pos) {
    const U = ctx.U;
    const x = toNumber(xR);
    const D = (v) => dec(v);
    switch (name) {
        case 'sqrt':
            try { return sqrtReal(xR); } catch { throw { kind: 'math', pos }; }
        case 'cbrt': return cbrt(xR);
        case 'abs': return absReal(xR);
        case 'sin': return D(Math.sin(x * U));
        case 'cos': return D(Math.cos(x * U));
        case 'tan': {
            if (ctx.angleUnit === 'DEG') {
                const m = ((x % 180) + 180) % 180;
                if (Math.abs(m - 90) < 1e-9) throw { kind: 'math', pos };
            } else if (ctx.angleUnit === 'GRAD') {
                const m = ((x % 200) + 200) % 200;
                if (Math.abs(m - 100) < 1e-9) throw { kind: 'math', pos };
            }
            const r = Math.tan(x * U);
            if (!isFinite(r)) throw { kind: 'math', pos };
            return D(r);
        }
        case 'asin': if (x < -1 || x > 1) throw { kind: 'math', pos }; return D(Math.asin(x) / U);
        case 'acos': if (x < -1 || x > 1) throw { kind: 'math', pos }; return D(Math.acos(x) / U);
        case 'atan': return D(Math.atan(x) / U);
        case 'log': if (x <= 0) throw { kind: 'math', pos }; return D(Math.log10(x));
        case 'ln': if (x <= 0) throw { kind: 'math', pos }; return D(Math.log(x));
        case 'exp': return D(Math.exp(x));            // e^x
        case 'pow10': return pow(int(10), xR);        // 10^x — exact for integer x
        case 'sinh': return D(Math.sinh(x));          // hyperbolic — no angle mode
        case 'cosh': return D(Math.cosh(x));
        case 'tanh': return D(Math.tanh(x));
        case 'asinh': return D(Math.asinh(x));
        case 'acosh': if (x < 1) throw { kind: 'math', pos }; return D(Math.acosh(x));
        case 'atanh': if (x <= -1 || x >= 1) throw { kind: 'math', pos }; return D(Math.atanh(x));
        case 'rnd': {
            // Round to the current display precision (affects later arithmetic)
            const { displayFormat, fixDigits } = ctx;
            let r;
            if (displayFormat === 'FIX' && fixDigits != null) r = Number(x.toFixed(fixDigits));
            else if (displayFormat === 'SCI' && fixDigits != null) r = Number(x.toExponential((fixDigits === 0 ? 10 : fixDigits) - 1));
            else r = Number(x.toPrecision(10)); // NORM: 10 significant figures
            return D(r);
        }
        default: throw { kind: 'math', pos };
    }
}

// RanInt#(a,b) — random integer in [a,b]; non-integer or a>b → Argument ERROR
function ranint(a, b, ctx) {
    const isInt = (r) => r.k === 'rat' && r.q === 1n;
    if (!isInt(a) || !isInt(b)) throw { kind: 'argument' };
    const lo = Number(a.p), hi = Number(b.p);
    if (lo > hi) throw { kind: 'argument' };
    return int(lo + Math.floor(ctx.rng() * (hi - lo + 1)));
}

// Pol(x,y) → (r, θ); Rec(r,θ) → (X, Y). Stores the pair to X/Y and records
// a dual result in ctx.dual for the display. Returns the first value.
function polRec(name, a, b, ctx) {
    if (name === 'pol') {
        const x = toNumber(a), y = toNumber(b);
        const r = sqrtReal(add(mul(a, a), mul(b, b)));       // exact r when possible
        const theta = dec(Math.atan2(y, x) / ctx.U);         // in the current angle unit, (−180°,180°]
        ctx.memory.store('X', r);
        ctx.memory.store('Y', theta);
        ctx.dual = { l1: 'r', v1: r, l2: 'θ', v2: theta };
        return r;
    }
    // Rec
    const r = toNumber(a), th = toNumber(b) * ctx.U;
    const X = dec(r * Math.cos(th)), Y = dec(r * Math.sin(th));
    ctx.memory.store('X', X);
    ctx.memory.store('Y', Y);
    ctx.dual = { l1: 'X', v1: X, l2: 'Y', v2: Y };
    return X;
}

function evalNode(node, ctx) {
    switch (node.t) {
        case 'num': {
            let r = fromDecimalString(node.text);
            if (node.exp) r = mul(r, pow(int(10), int(node.exp)));
            return r;
        }
        case 'const': return node.name === 'pi' ? dec(Math.PI) : dec(Math.E);
        case 'dms': {
            // D + M/60 + S/3600, exact (the tower keeps 60ths rational)
            let v = evalNode(node.parts[0], ctx);
            if (node.parts[1]) v = add(v, div(evalNode(node.parts[1], ctx), int(60)));
            if (node.parts[2]) v = add(v, div(evalNode(node.parts[2], ctx), int(3600)));
            return v;
        }
        case 'ans': return ctx.memory.getAns();
        case 'ran': return dec(Math.floor(ctx.rng() * 1000) / 1000); // 0.000–0.999
        case 'var': return ctx.memory.recall(node.name);
        case 'stat': { // summary variable (SHIFT 1 menu)
            if (!ctx.stat) throw { kind: 'math', pos: node.pos };
            try { return dec(statValue(ctx.stat, node.name)); }
            catch (e) { throw { kind: (e && e.kind) || 'math', pos: node.pos }; }
        }
        case 'statpost': { // x̂ / x̂1 / x̂2 / ŷ estimates
            if (!ctx.stat) throw { kind: 'math', pos: node.pos };
            const v = toNumber(evalNode(node.x, ctx));
            try {
                if (node.op === 'yhat') return dec(estimateY(ctx.stat, v));
                if (node.op === 'xhat') return dec(estimateX(ctx.stat, v));
                return dec(estimateXQuad(ctx.stat, v, node.op === 'xhat1' ? 1 : 2));
            } catch (e) { throw { kind: (e && e.kind) || 'math', pos: node.pos }; }
        }
        case 'neg': return neg(evalNode(node.x, ctx));
        case 'add': return add(evalNode(node.a, ctx), evalNode(node.b, ctx));
        case 'sub': return sub(evalNode(node.a, ctx), evalNode(node.b, ctx));
        case 'mul': return mul(evalNode(node.a, ctx), evalNode(node.b, ctx));
        case 'div':
            try { return div(evalNode(node.a, ctx), evalNode(node.b, ctx)); }
            catch { throw { kind: 'math', pos: node.pos }; }
        case 'pow':
            try { return pow(evalNode(node.a, ctx), evalNode(node.b, ctx)); }
            catch { throw { kind: 'math', pos: node.pos }; }
        case 'postfix': {
            const x = evalNode(node.x, ctx);
            try {
                switch (node.op) {
                    case 'sq': return mul(x, x);
                    case 'cube': return mul(mul(x, x), x);
                    case 'inv': return div(ONE, x);
                    case 'fact': return factorial(x);
                    case 'pct': return div(x, int(100)); // % → x/100
                    case 'drg_deg': case 'drg_rad': case 'drg_grad': {
                        // Convert x from the marked unit to the current angle mode
                        const fromRad = node.op === 'drg_deg' ? Math.PI / 180 : node.op === 'drg_rad' ? 1 : Math.PI / 200;
                        return dec(toNumber(x) * fromRad / ctx.U);
                    }
                    default: throw { kind: 'math', pos: node.pos };
                }
            } catch (e) { throw (e && e.kind) ? { kind: e.kind, pos: node.pos } : e; }
        }
        case 'nPr': case 'nCr': case 'func2': {
            const a = evalNode(node.a, ctx), b = evalNode(node.b, ctx);
            try {
                if (node.t === 'nPr') return nPr(a, b);
                if (node.t === 'nCr') return nCr(a, b);
                if (node.name === 'gcd') return gcdReal(a, b);
                if (node.name === 'lcm') return lcmReal(a, b);
                if (node.name === 'ranint') return ranint(a, b, ctx);
                return polRec(node.name, a, b, ctx); // Pol / Rec (dual result)
            } catch (e) { throw (e && e.kind) ? { kind: e.kind, pos: node.pos } : e; }
        }
        case 'func': return applyFunc(node.name, evalNode(node.x, ctx), ctx, node.pos);
        default: throw { kind: 'math', pos: node.pos };
    }
}

/**
 * Evaluate a token buffer.
 * @returns {{ok:true, value:Real}
 *          | {ok:false, error:'Syntax ERROR'|'Math ERROR'|'Stack ERROR', errorPos:number}}
 */
export function evaluateTokens(tokens, { angleUnit = 'DEG', memory, displayFormat = 'NORM1', fixDigits = null, rng = Math.random, stat = null } = {}) {
    if (!tokens || tokens.length === 0) return { ok: false, error: 'Syntax ERROR', errorPos: 0 };

    const U = angleUnit === 'DEG' ? Math.PI / 180
            : angleUnit === 'GRAD' ? Math.PI / 200
            : 1;

    try {
        const ast = parse(tokens);
        const ctx = { U, angleUnit, memory, displayFormat, fixDigits, rng, stat, dual: null };
        const value = evalNode(ast, ctx);
        const n = toNumber(value);
        if (typeof n !== 'number' || isNaN(n) || !isFinite(n)) throw { kind: 'math' };
        if (Math.abs(n) >= MAX_MAG) throw { kind: 'math' };
        return ctx.dual ? { ok: true, value, dual: ctx.dual } : { ok: true, value };
    } catch (e) {
        const kind = e && e.kind;
        const errorPos = (e && typeof e.pos === 'number') ? e.pos : tokens.length;
        if (kind === 'syntax') return { ok: false, error: 'Syntax ERROR', errorPos };
        if (kind === 'stack') return { ok: false, error: 'Stack ERROR', errorPos };
        if (kind === 'argument') return { ok: false, error: 'Argument ERROR', errorPos };
        if (kind === 'math') return { ok: false, error: 'Math ERROR', errorPos };
        return { ok: false, error: 'Syntax ERROR', errorPos: 0 };
    }
}

// re-exported for callers that want to format the result value
export { isExact, toNumber };
