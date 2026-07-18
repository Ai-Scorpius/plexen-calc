// ===========================================
// PLEXEN Calculator — state serialization (pure, headless)
// Tower-aware snapshot of memory + setup for persistence. No localStorage
// here (that lives in js/ui/persist.js) so this stays unit-testable.
// ===========================================
import { int, rat, surd, dec } from './real.js';

export const SCHEMA_VERSION = 1;

export function serializeReal(r) {
    if (r.k === 'rat') return { k: 'rat', p: r.p.toString(), q: r.q.toString() };
    if (r.k === 'surd') return { k: 'surd', a: r.a.toString(), b: r.b.toString(), c: r.c.toString(), d: r.d.toString() };
    return { k: 'dec', x: r.x };
}

export function deserializeReal(o) {
    if (!o || typeof o !== 'object') return int(0);
    try {
        if (o.k === 'rat') return rat(BigInt(o.p), BigInt(o.q));
        if (o.k === 'surd') return surd(BigInt(o.a), BigInt(o.b), BigInt(o.c), BigInt(o.d));
        if (o.k === 'dec' && typeof o.x === 'number') return dec(o.x);
    } catch { /* fall through */ }
    return int(0);
}

export function serializeMemory(mem) {
    const vars = {};
    for (const k in mem.vars) vars[k] = serializeReal(mem.vars[k]);
    return { ans: serializeReal(mem.ans), m: serializeReal(mem.m), vars };
}

export function applyMemory(mem, obj) {
    if (!obj) return;
    mem.ans = deserializeReal(obj.ans);
    mem.m = deserializeReal(obj.m);
    if (obj.vars) for (const k in mem.vars) if (obj.vars[k]) mem.vars[k] = deserializeReal(obj.vars[k]);
}

const ANGLES = ['DEG', 'RAD', 'GRAD'];
const FORMATS = ['NORM1', 'NORM2', 'FIX', 'SCI', 'ENG'];
const IOS = ['MathO', 'LineO', 'LineIO'];
const FRACFORMS = ['dc', 'abc'];
const MARKS = ['dot', 'comma'];
const MODES = ['COMP', 'STAT', 'VERIF'];

export function serializeSetup(state) {
    return {
        angleUnit: state.angleUnit,
        displayFormat: state.displayFormat,
        fixDigits: state.fixDigits,
        io: state.io,
        fracForm: state.fracForm,
        decimalMark: state.decimalMark,
        statFreq: state.statFreq,
        contrast: state.contrast,
        mode: state.mode,
    };
}

export function applySetup(state, obj) {
    if (!obj) return;
    if (ANGLES.includes(obj.angleUnit)) state.set('angleUnit', obj.angleUnit);
    if (FORMATS.includes(obj.displayFormat)) state.set('displayFormat', obj.displayFormat);
    if (obj.fixDigits === null || (Number.isInteger(obj.fixDigits) && obj.fixDigits >= 0 && obj.fixDigits <= 9)) {
        state.set('fixDigits', obj.fixDigits);
    }
    if (IOS.includes(obj.io)) state.set('io', obj.io);
    if (FRACFORMS.includes(obj.fracForm)) state.set('fracForm', obj.fracForm);
    if (MARKS.includes(obj.decimalMark)) state.set('decimalMark', obj.decimalMark);
    if (typeof obj.statFreq === 'boolean') state.set('statFreq', obj.statFreq);
    if (Number.isInteger(obj.contrast) && obj.contrast >= 1 && obj.contrast <= 10) state.set('contrast', obj.contrast);
    if (MODES.includes(obj.mode)) state.set('mode', obj.mode);
}

export function snapshot(calc) {
    return { version: SCHEMA_VERSION, memory: serializeMemory(calc.memory), setup: serializeSetup(calc.state) };
}

export function restore(calc, snap) {
    if (!snap || snap.version !== SCHEMA_VERSION) return false;
    applyMemory(calc.memory, snap.memory);
    applySetup(calc.state, snap.setup);
    return true;
}
