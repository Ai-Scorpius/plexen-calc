// ===========================================
// PLEXEN Calculator — Memory Manager
// Ans, M (independent memory), Variables A-F, X, Y.
// Values are Real tower values (js/engine/real.js), so stored results stay
// exact. Pure and headless.
// ===========================================
import { int, add, sub, toNumber } from './real.js';

export function createMemory() {
    return {
        ans: int(0),
        m: int(0),
        vars: { A: int(0), B: int(0), C: int(0), D: int(0), E: int(0), F: int(0), X: int(0), Y: int(0), M: int(0) },

        getAns() { return this.ans; },
        setAns(v) { this.ans = v; },

        getMReal() { return this.m; },
        getM() { return toNumber(this.m); }, // numeric view for indicators/tests
        mPlus(v) { this.m = add(this.m, v); this.vars.M = this.m; },
        mMinus(v) { this.m = sub(this.m, v); this.vars.M = this.m; },
        clearM() { this.m = int(0); this.vars.M = int(0); },

        store(name, v) {
            if (name === 'M') this.m = v;
            this.vars[name] = v;
        },

        recall(name) {
            if (name === 'Ans') return this.ans;
            return this.vars[name] || int(0);
        },

        clearAll() {
            this.ans = int(0);
            this.m = int(0);
            for (const k in this.vars) this.vars[k] = int(0);
        },

        hasM() { return toNumber(this.m) !== 0; },
    };
}
