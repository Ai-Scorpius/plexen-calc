// ===========================================
// PLEXEN Calculator — Display (DOM view)
// Subscribes to the controller's 'update' snapshots and renders them via
// the natural-display box renderer. The only module besides chrome/main
// that touches the DOM.
// ===========================================
import { renderExpr, renderResultInto } from './render-expr.js';

export function createDisplay(calculator, root = document) {
    const exprEl = root.getElementById('display-main');
    const resultEl = root.getElementById('display-result');
    const statusEl = root.querySelector('.display-status');
    const lcdEl = root.querySelector('.display');

    function setIndicator(name, active) {
        const el = statusEl.querySelector('[data-ind="' + name + '"]');
        if (!el) return;
        el.classList.toggle('active', !!active);
        // Hidden indicators leave the a11y tree too (belt-and-suspenders with
        // the CSS visibility toggle), so only lit flags are announced.
        el.setAttribute('aria-hidden', active ? 'false' : 'true');
    }

    // The expression line is role="img"; keep its accessible name in step with
    // whatever the LCD is showing so a screen-reader user reads the live state.
    function setExprLabel(text) {
        exprEl.setAttribute('aria-label', text);
    }

    // Compact cell format for the STAT editor grid
    function fmtCell(v) {
        const n = Number(v.toPrecision(8));
        const s = String(n);
        return s.length > 9 ? n.toExponential(2) : s;
    }

    // STAT data editor: header + a 3-row window around the cursor + entry line
    function renderStatEditor(view) {
        const ed = view.statEditor;
        const grid = document.createElement('div');
        grid.className = 'stat-grid';

        const header = document.createElement('div');
        header.className = 'stat-row stat-header';
        header.appendChild(cellSpan('', 'stat-rn'));
        ed.cols.forEach((c) => header.appendChild(cellSpan(c, 'stat-cell')));
        grid.appendChild(header);

        const total = ed.rows.length + 1; // +1 blank entry row
        const start = Math.max(0, Math.min(ed.row - 1, total - 3));
        for (let r = start; r < Math.min(start + 3, total); r++) {
            const rowEl = document.createElement('div');
            rowEl.className = 'stat-row';
            rowEl.appendChild(cellSpan(String(r + 1), 'stat-rn'));
            ed.cols.forEach((c, ci) => {
                const isBlank = r === ed.rows.length;
                const raw = isBlank ? '' : fmtCell(c === 'x' ? ed.rows[r].x : c === 'y' ? ed.rows[r].y : ed.rows[r].f);
                const cls = 'stat-cell' + (r === ed.row && ci === ed.col ? ' stat-active' : '');
                rowEl.appendChild(cellSpan(raw, cls));
            });
            grid.appendChild(rowEl);
        }

        exprEl.innerHTML = '';
        exprEl.appendChild(grid);
        // entry line: the in-progress cell entry, or the highlighted cell value
        const current = ed.row < ed.rows.length
            ? fmtCell(ed.cols[ed.col] === 'x' ? ed.rows[ed.row].x : ed.cols[ed.col] === 'y' ? ed.rows[ed.row].y : ed.rows[ed.row].f)
            : '';
        resultEl.textContent = view.expr !== '' ? view.expr : current;
    }

    function cellSpan(text, cls) {
        const s = document.createElement('span');
        s.className = cls;
        s.textContent = text;
        return s;
    }

    function render(view) {
        if (view.isOff) {
            exprEl.textContent = '';
            resultEl.textContent = '';
            setExprLabel('Calculator off');
            statusEl.querySelectorAll('.ind').forEach((el) => {
                el.classList.remove('active');
                el.setAttribute('aria-hidden', 'true');
            });
            return;
        }

        // SETUP ◀CONT▶ contrast: CSS filter over the whole LCD
        if (lcdEl && typeof view.contrast === 'number') {
            lcdEl.style.filter = `contrast(${(0.5 + 0.1 * view.contrast).toFixed(2)})`;
        }

        if (!view.menu && !view.error && view.statEditor) {
            renderStatEditor(view);
            setExprLabel('Statistics data editor');
            const ind2 = view.indicators;
            Object.keys(ind2).forEach((name) => setIndicator(name, ind2[name]));
            return;
        }

        if (view.menu) {
            // Modal menu: prompt text, or numbered options (+ page hint)
            if (view.menu.prompt) {
                exprEl.textContent = view.menu.prompt;
                setExprLabel(view.menu.prompt);
            } else {
                const pageHint = view.menu.pageCount > 1
                    ? (view.menu.pageIndex < view.menu.pageCount - 1 ? '  ▼' : '  ▲')
                    : '';
                const optsText = view.menu.options.map((o, i) => `${i + 1}:${o}`).join('  ');
                exprEl.textContent = optsText + pageHint;
                setExprLabel('Menu — ' + optsText);
            }
            resultEl.textContent = '';
        } else if (view.error) {
            exprEl.textContent = view.error;
            setExprLabel(view.error);
            resultEl.textContent = '';
        } else {
            renderExpr(exprEl, view);
            renderResultInto(resultEl, view.resultLine);
            setExprLabel('Expression: ' + (view.expr && view.expr.length ? view.expr : 'empty'));
        }

        const ind = view.indicators;
        Object.keys(ind).forEach((name) => setIndicator(name, ind[name]));
    }

    calculator.on('update', render);
    // Paint the initial state immediately
    render(calculator.getView());

    return { render };
}
