// ===========================================
// PLEXEN Calculator — State Machine
// Central state with pub/sub. Pure and headless.
// ===========================================
import { createEmitter } from './emitter.js';

export function createState() {
    const emitter = createEmitter();

    const state = {
        mode: 'COMP',           // COMP | STAT | VERIF (the Scientific has no TABLE/BASE-N)
        subMode: null,
        shiftActive: false,
        alphaActive: false,
        angleUnit: 'DEG',       // DEG | RAD | GRAD
        displayFormat: 'NORM1', // NORM1 | NORM2 | FIX | SCI | ENG
        fixDigits: null,
        io: 'MathO',            // MathO (natural, exact results) | LineO (natural in, decimal out) | LineIO
        fracForm: 'dc',         // d/c improper | ab/c mixed-number fraction results
        decimalMark: 'dot',     // dot | comma (SETUP Disp)
        statFreq: true,         // STAT frequency column on/off (used in Phase 9)
        contrast: 5,            // 1–10, SETUP ◀CONT▶
        isOn: true,
        error: null,            // null | 'Math ERROR' | 'Syntax ERROR'
        hasResult: false,       // true after = pressed, clears on next digit

        set(key, val) {
            const old = this[key];
            if (old === val) return;
            this[key] = val;
            emitter.emit('change', key, old, val);
            emitter.emit('change:' + key, old, val);
        },

        toggleShift() {
            if (this.alphaActive) this.set('alphaActive', false);
            this.set('shiftActive', !this.shiftActive);
        },

        toggleAlpha() {
            if (this.shiftActive) this.set('shiftActive', false);
            this.set('alphaActive', !this.alphaActive);
        },

        clearModifiers() {
            this.set('shiftActive', false);
            this.set('alphaActive', false);
        },

        clearError() {
            this.set('error', null);
        },

        on: emitter.on,
        off: emitter.off,
    };

    return state;
}
