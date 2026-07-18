// ===========================================
// PLEXEN Calculator — window chrome
// Draggable floating window, minimize-to-dock, close, resize clamp.
// This is window decoration, not part of the real calculator.
// ===========================================

export function initChrome() {
    const calc = document.getElementById('calculator');
    const titleBar = document.getElementById('title-bar');
    const btnMin = document.getElementById('btn-minimize');
    const btnClose = document.getElementById('btn-close');
    const btnRestore = document.getElementById('btn-restore');
    const dock = document.getElementById('minimized-dock');
    if (!calc || !titleBar) return;

    const WIN_KEY = 'plexen-calc-win';

    // Default: centered. Overridden below if a saved position exists.
    calc.style.left = (window.innerWidth - calc.offsetWidth) / 2 + 'px';
    calc.style.top = Math.max(20, (window.innerHeight - calc.offsetHeight) / 2) + 'px';

    let isDragging = false, dragX = 0, dragY = 0;

    function clamp(x, y) {
        calc.style.left = Math.max(-calc.offsetWidth + 80, Math.min(window.innerWidth - 80, x)) + 'px';
        calc.style.top = Math.max(0, Math.min(window.innerHeight - 40, y)) + 'px';
    }

    function saveWin() {
        try {
            localStorage.setItem(WIN_KEY, JSON.stringify({
                left: calc.offsetLeft, top: calc.offsetTop,
                minimized: dock && dock.style.display === 'block',
            }));
        } catch { /* ignore */ }
    }

    (function restoreWin() {
        try {
            const s = JSON.parse(localStorage.getItem(WIN_KEY) || 'null');
            if (!s) return;
            if (typeof s.left === 'number' && typeof s.top === 'number') clamp(s.left, s.top);
            if (s.minimized && dock) { calc.style.display = 'none'; dock.style.display = 'block'; }
        } catch { /* ignore */ }
    })();

    // Drag is a desktop affordance. On a coarse (touch) pointer the window is
    // scaled up and fixed — dragging would fight scrolling — so we skip it.
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (!coarse) {
        titleBar.addEventListener('mousedown', function (e) {
            if (e.target.closest('.title-btn')) return;
            isDragging = true;
            dragX = e.clientX - calc.offsetLeft;
            dragY = e.clientY - calc.offsetTop;
            calc.style.transition = 'none';
            document.body.style.cursor = 'grabbing';
            e.preventDefault();
        });
        document.addEventListener('mousemove', function (e) {
            if (!isDragging) return;
            clamp(e.clientX - dragX, e.clientY - dragY);
        });
        document.addEventListener('mouseup', function () {
            if (isDragging) { isDragging = false; calc.style.transition = ''; document.body.style.cursor = ''; saveWin(); }
        });

        titleBar.addEventListener('touchstart', function (e) {
            if (e.target.closest('.title-btn')) return;
            isDragging = true;
            dragX = e.touches[0].clientX - calc.offsetLeft;
            dragY = e.touches[0].clientY - calc.offsetTop;
            calc.style.transition = 'none';
        }, { passive: true });
        document.addEventListener('touchmove', function (e) {
            if (!isDragging) return;
            clamp(e.touches[0].clientX - dragX, e.touches[0].clientY - dragY);
        }, { passive: true });
        document.addEventListener('touchend', function () { if (isDragging) { isDragging = false; calc.style.transition = ''; saveWin(); } });
    }

    if (btnMin) btnMin.addEventListener('click', function () { calc.style.display = 'none'; dock.style.display = 'block'; saveWin(); });
    if (btnRestore) btnRestore.addEventListener('click', function () { calc.style.display = ''; dock.style.display = 'none'; saveWin(); });
    // Close really closes (no dock); reload the page to get it back
    if (btnClose) btnClose.addEventListener('click', function () { calc.style.display = 'none'; dock.style.display = 'none'; saveWin(); });

    // Keep the window reachable when the viewport shrinks or rotates
    window.addEventListener('resize', function () {
        clamp(calc.offsetLeft, calc.offsetTop);
        saveWin();
    });
}
