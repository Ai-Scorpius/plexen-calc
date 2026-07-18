// ===========================================
// PLEXEN Calculator — VERIFY-mode judgment (pure, headless)
// A VERIFY line is  op0 rel1 op1 rel2 op2 …  where each rel is one of
// = ≠ < > ≤ ≥. Each operand is a normal expression; the line is TRUE iff
// every adjacent comparison holds. Equality is EXACT (the number tower),
// so 4 = √16 is TRUE. The restriction rules (all → Syntax ERROR):
//   empty operand · relation inside parens/function/fraction · ≠ combined
//   with another relation · mixed < / > directions · Pol/Rec present.
// ===========================================
import { evaluateTokens } from './interpret.js';
import { sub, toNumber } from './real.js';

// Token types that open a parenthesis level (a relation inside one is illegal)
const OPENERS = new Set(['open', 'func', 'func2', 'power']);

function scan(flat) {
    const operands = [[]];
    const rels = []; // { op, pos }
    let depth = 0;
    let insidePos = null; // first relation found inside parens
    for (let i = 0; i < flat.length; i++) {
        const t = flat[i];
        if (t.type === 'rel') {
            if (depth !== 0) {
                if (insidePos === null) insidePos = i;
                operands[operands.length - 1].push(t); // keep it so the operand isn't mis-split
            } else {
                rels.push({ op: t.op, pos: i });
                operands.push([]);
            }
            continue;
        }
        if (OPENERS.has(t.type)) depth++;
        else if (t.type === 'close') depth = Math.max(0, depth - 1);
        operands[operands.length - 1].push(t);
    }
    return { operands, rels, insidePos };
}

/** True when the token stream has a relation at the top level. */
export function hasTopLevelRelation(flat) {
    return scan(flat).rels.length > 0;
}

const dirOf = (op) => (op === 'lt' || op === 'le') ? 'lt' : (op === 'gt' || op === 'ge') ? 'gt' : 'eq';

function relHolds(op, a, b) {
    const d = sub(a, b); // exact when both operands are exact
    let sign;
    if (d.k === 'rat') {
        sign = d.p === 0n ? 0 : (d.p < 0n ? -1 : 1);
    } else {
        const n = toNumber(d);
        const eps = 1e-12 * (1 + Math.abs(toNumber(a)));
        sign = Math.abs(n) <= eps ? 0 : (n < 0 ? -1 : 1);
    }
    switch (op) {
        case 'eq': return sign === 0;
        case 'ne': return sign !== 0;
        case 'lt': return sign < 0;
        case 'le': return sign <= 0;
        case 'gt': return sign > 0;
        case 'ge': return sign >= 0;
        default: return false;
    }
}

/**
 * Judge a VERIFY line.
 * @returns {{ok:true, truth:boolean}
 *          | {ok:false, error:'Syntax ERROR'|'Math ERROR'|…, errorPos:number}}
 */
export function judge(flat, opts) {
    const { operands, rels, insidePos } = scan(flat);
    const syntax = (pos = 0) => ({ ok: false, error: 'Syntax ERROR', errorPos: pos });

    if (rels.length === 0) return syntax();
    if (insidePos !== null) return syntax(insidePos);            // relation inside parens/function
    if (operands.some((o) => o.length === 0)) return syntax();   // empty side / consecutive relations
    // Pol/Rec are banned in VERIFY
    if (flat.some((t) => t.type === 'func2' && (t.text === 'Pol(' || t.text === 'Rec('))) return syntax();

    const ops = rels.map((r) => r.op);
    if (ops.includes('ne') && ops.length > 1) return syntax();   // ≠ cannot combine
    const dirs = new Set(ops.map(dirOf));
    if (dirs.has('lt') && dirs.has('gt')) return syntax();       // mixed directions

    const vals = [];
    for (const o of operands) {
        const r = evaluateTokens(o, opts);
        if (!r.ok) return r; // propagate Math/Syntax error from an operand
        vals.push(r.value);
    }

    let truth = true;
    for (let i = 0; i < ops.length; i++) {
        if (!relHolds(ops[i], vals[i], vals[i + 1])) { truth = false; break; }
    }
    return { ok: true, truth };
}
