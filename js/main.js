// ===========================================
// PLEXEN Scientific — bootstrap
// Creates the headless controller, binds the DOM view, wires input.
// ===========================================
import { createCalculator } from './engine/calculator.js';
import { createDisplay } from './ui/display.js';
import { initChrome } from './ui/chrome.js';
import { loadInto, attachSave } from './ui/persist.js';

function init() {
    const calc = createCalculator();
    loadInto(calc);       // restore Ans/M/vars/setup before the first render
    createDisplay(calc);
    attachSave(calc);     // persist on every change
    initChrome();

    // Buttons fire on native 'click' so keyboard (Tab+Enter/Space) and
    // assistive tech activate them for free, and mobile no longer needs a
    // touchstart preventDefault scroll-trap.
    document.querySelectorAll('[data-id]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            calc.handleButton(this.getAttribute('data-id'));
        });
    });

    // Physical keyboard
    const map = {
        '0': '0', '1': '1', '2': '2', '3': '3', '4': '4',
        '5': '5', '6': '6', '7': '7', '8': '8', '9': '9',
        '.': 'dot',
        '+': 'add', '-': 'subtract', '*': 'multiply', '/': 'divide',
        'Enter': 'equals', '=': 'equals',
        'Backspace': 'del',
        'Escape': 'ac',
        '(': 'lparen', ')': 'rparen',
        'ArrowLeft': 'left', 'ArrowRight': 'right',
        'ArrowUp': 'up', 'ArrowDown': 'down',
        's': 'sin', 'c': 'cos', 't': 'tan',
        'l': 'log', 'n': 'ln',
        '^': 'power',
        '!': 'factorial',
    };

    document.addEventListener('keydown', function (e) {
        // Ctrl/Cmd+C with nothing selected copies the result line (the display
        // is user-select:text, so a real selection still copies natively).
        if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
            const sel = window.getSelection && window.getSelection().toString();
            if (!sel) {
                const resultEl = document.getElementById('display-result');
                const text = resultEl ? resultEl.textContent : '';
                if (text && navigator.clipboard) navigator.clipboard.writeText(text).catch(function () {});
            }
            return;
        }
        // Never shadow other browser/OS shortcuts
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        // Let a focused button's own click handle its activation keys,
        // rather than double-firing via the map below.
        if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.closest && e.target.closest('[data-id]')) return;
        // Dead keyboard while the window is hidden or powered off
        const calcEl = document.getElementById('calculator');
        if (!calcEl || calcEl.style.display === 'none') return;
        if (!calc.state.isOn) return;

        if (map[e.key]) {
            e.preventDefault();
            calc.handleButton(map[e.key]);
        }
    });

    // Auto Power Off (~10 min idle), matching the hardware. Any calculator
    // action emits 'update', which reschedules the timer; when it fires the
    // display blanks (memory survives) and ON revives it. While off we don't
    // reschedule — pressing ON emits an update that restarts the countdown.
    const AUTO_OFF_MS = 10 * 60 * 1000;
    let idleTimer = null;
    function resetIdle() {
        if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
        if (!calc.state.isOn) return;
        idleTimer = setTimeout(function () { calc.powerOff(); }, AUTO_OFF_MS);
    }
    calc.on('update', resetIdle);
    resetIdle();

    // PWA: register the offline service worker. It is network-first, so it
    // never serves a stale module while online (see sw.js for the reasoning).
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', function () {
            navigator.serviceWorker.register('sw.js').catch(function () { /* non-fatal */ });
        });
    }

    console.log('PLEXEN Scientific initialized');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
