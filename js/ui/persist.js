// ===========================================
// PLEXEN Calculator — persistence (browser)
// Saves memory + setup to localStorage so Ans/M/vars and the angle/format
// settings survive a reload (like the real calculator keeps them through
// power-off). Serialization is the pure engine/serialize.js.
// ===========================================
import { snapshot, restore } from '../engine/serialize.js';

const KEY = 'plexen-calc';

export function loadInto(calc) {
    try {
        const raw = localStorage.getItem(KEY);
        if (raw) restore(calc, JSON.parse(raw));
    } catch { /* corrupt or unavailable storage → start fresh */ }
}

export function attachSave(calc) {
    let queued = false;
    const save = () => {
        queued = false;
        try { localStorage.setItem(KEY, JSON.stringify(snapshot(calc))); } catch { /* ignore */ }
    };
    // Coalesce bursts of keypresses into one write per frame-ish tick.
    calc.on('update', () => {
        if (queued) return;
        queued = true;
        Promise.resolve().then(save);
    });
}
