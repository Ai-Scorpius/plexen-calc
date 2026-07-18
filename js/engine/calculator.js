// ===========================================
// PLEXEN Calculator — headless controller
// Owns a typed TOKEN buffer + a token-index cursor, resolves SHIFT/ALPHA,
// runs commands, and drives evaluation. Emits an 'update' view-model
// snapshot after every action instead of touching the DOM, so it runs
// (and is tested) with no browser.
// ===========================================
import { createEmitter } from './emitter.js';
import { createState } from './state.js';
import { createMemory } from './memory.js';
import { keyMap } from './keymap.js';
import { evaluateTokens } from './interpret.js';
import { formatReal, hasExactForm, formatEng, engBase, formatDMS, formatFactorization } from './format.js';
import { int, toNumber } from './real.js';
import { makeToken, ansToken, INPUT_BYTE_LIMIT, LOW_SPACE_BYTES } from './tokens.js';
import { createBuffer } from './buffer.js';
import { createStatStore, STAT_TYPES } from './stat.js';
import { judge, hasTopLevelRelation } from './verify.js';

const VAR_NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'X', 'Y', 'M'];

export function createCalculator({ state = createState(), memory = createMemory() } = {}) {
    const emitter = createEmitter();

    const buffer = createBuffer(); // structured (tree) expression buffer
    const statStore = createStatStore(); // STAT-mode data + type
    const statEd = { active: false, row: 0, col: 0 }; // data-editor cursor
    let resultLine = '0';
    let lastErrorPos = 0; // token index of the last error, for cursor recovery
    let lastReal = int(0); // last computed Real (for S⇔D toggling)
    let showDecimal = false; // current result shown as decimal vs exact form
    let engExp = null; // when set, the result is shown in ENG form at this exponent
    let dmsShow = false; // when true, the result is shown in D°M'S" form
    let menu = null; // active modal menu (options | pages | prompt shapes)
    let pending = null; // 'STO' | 'RCL' — waiting for a variable key
    let exprSuffix = ''; // display-only suffix on the entry line ("→A", "X=")
    let lastDual = null; // Pol/Rec dual result payload, re-rendered on format changes
    let lastFracInput = false; // input contained a fraction template (LineO keeps those exact)
    let fracToggle = false; // SHIFT S⇔D per-result ab/c ⇔ d/c override
    let factShow = false; // when true, the result is shown as a prime factorisation
    let statementIndex = 0; // multi-statement (:) stepping position
    let dispIndicator = false; // "Disp" — more statements pending
    let history = []; // past COMP calculations for ▲▼ replay
    let histPos = null; // index into history while scrolling (null = live)
    const HISTORY_MAX = 30;

    // A display-format change (Norm⇄Fix⇄Sci, or the digit count) invalidates the
    // stored result lines, so the hardware drops the replay history. clearHistory
    // is hoisted; state.set only fires change:* on a real value change.
    state.on('change:displayFormat', clearHistory);
    state.on('change:fixDigits', clearHistory);

    function indicators() {
        return {
            S: state.shiftActive,
            A: state.alphaActive,
            M: memory.hasM(),
            STO: pending === 'STO', // waiting for the destination variable key
            RCL: pending === 'RCL', // waiting for the variable key to recall
            STAT: state.mode === 'STAT',
            D: state.angleUnit === 'DEG',
            R: state.angleUnit === 'RAD',
            G: state.angleUnit === 'GRAD',
            FIX: state.displayFormat === 'FIX',
            SCI: state.displayFormat === 'SCI',
            Disp: dispIndicator, // more statements pending in a multi-statement line
            Math: state.io !== 'LineIO' && state.mode !== 'STAT', // STAT forces linear
            up: canScrollUp(), // ▲ a older COMP calculation is available to recall
            down: canScrollDown(), // ▼ a newer calculation is available while scrolling
        };
    }

    function view() {
        const bytesUsed = buffer.bytes();
        return {
            expr: buffer.linear(),
            cursorPos: buffer.linearCursorIndex(),
            resultLine,
            error: state.error,
            isOff: !state.isOn,
            bytesUsed,
            lowSpace: INPUT_BYTE_LIMIT - bytesUsed <= LOW_SPACE_BYTES,
            // structured view for the natural-display renderer
            tree: buffer.tree(),
            cursorSlot: buffer.cursorSlot(),
            cursorLeafPos: buffer.cursorPos(),
            hasResult: state.hasResult,
            exprSuffix,
            contrast: state.contrast,
            menu: menu ? {
                prompt: menu.prompt || null,
                options: menu.pages ? menu.pages[menu.pageIndex].slice()
                       : menu.options ? menu.options.slice() : null,
                pageIndex: menu.pages ? menu.pageIndex : 0,
                pageCount: menu.pages ? menu.pages.length : 1,
            } : null,
            statEditor: statEd.active ? {
                type: statStore.type,
                cols: statCols(),
                rows: statStore.rows.map((r) => ({ x: r.x, y: r.y, f: r.f })),
                row: statEd.row,
                col: statEd.col,
            } : null,
            indicators: indicators(),
        };
    }

    // openMenu(options, onSelect) — flat digit menu (Phase 7 shape), or
    // openMenu(spec) with { pages, onSelect(page,n) } | { prompt, onDigit,
    // onEquals, onLeft, onRight } for SETUP/CLR-style flows.
    function openMenu(specOrOptions, onSelect) {
        if (Array.isArray(specOrOptions)) {
            menu = { options: specOrOptions, onSelect };
        } else {
            menu = { pageIndex: 0, ...specOrOptions };
        }
    }

    // Re-render the result line if one is showing (a SETUP change applies
    // to the value on screen, like the hardware).
    function rerenderIfResult() {
        if (state.hasResult) renderResult();
    }

    // SETUP (SHIFT MODE), two pages — ▼/▲ turn pages, digits select.
    function openSetupMenu() {
        openMenu({
            pages: [
                ['MthIO', 'LineIO', 'Deg', 'Rad', 'Gra', 'Fix', 'Sci', 'Norm'],
                ['ab/c', 'd/c', 'STAT', 'Disp', '◀CONT▶'],
            ],
            onSelect(page, n) {
                if (page === 0) {
                    switch (n) {
                        case 1: // MthIO → output sub-choice
                            openMenu(['MathO', 'LineO'], (k) => {
                                state.set('io', k === 1 ? 'MathO' : 'LineO');
                                rerenderIfResult();
                            });
                            break;
                        case 2: state.set('io', 'LineIO'); rerenderIfResult(); break;
                        case 3: state.set('angleUnit', 'DEG'); break;
                        case 4: state.set('angleUnit', 'RAD'); break;
                        case 5: state.set('angleUnit', 'GRAD'); break;
                        case 6:
                            openMenu({ prompt: 'Fix 0~9?', onDigit: (d) => {
                                state.set('displayFormat', 'FIX');
                                state.set('fixDigits', d);
                                rerenderIfResult();
                            } });
                            break;
                        case 7: // Sci 0~9 (0 ⇒ 10 significant digits)
                            openMenu({ prompt: 'Sci 0~9?', onDigit: (d) => {
                                state.set('displayFormat', 'SCI');
                                state.set('fixDigits', d);
                                rerenderIfResult();
                            } });
                            break;
                        case 8:
                            openMenu({ prompt: 'Norm 1~2?', onDigit: (d) => {
                                if (d !== 1 && d !== 2) return false; // reject: prompt stays open
                                state.set('displayFormat', d === 1 ? 'NORM1' : 'NORM2');
                                state.set('fixDigits', null);
                                rerenderIfResult();
                            } });
                            break;
                    }
                } else {
                    switch (n) {
                        case 1: state.set('fracForm', 'abc'); rerenderIfResult(); break;
                        case 2: state.set('fracForm', 'dc'); rerenderIfResult(); break;
                        case 3: // STAT frequency column — changing it clears the data
                            openMenu(['ON', 'OFF'], (k) => {
                                const next = k === 1;
                                if (next !== state.statFreq) {
                                    statStore.clear();
                                    statEd.row = 0; statEd.col = 0;
                                }
                                state.set('statFreq', next);
                            });
                            break;
                        case 4:
                            openMenu(['Dot', 'Comma'], (k) => {
                                state.set('decimalMark', k === 1 ? 'dot' : 'comma');
                                rerenderIfResult();
                            });
                            break;
                        case 5: // contrast — ◀▶ adjust live, AC exits
                            openMenu({
                                prompt: '◀ CONT ▶',
                                onLeft: () => state.set('contrast', Math.max(1, state.contrast - 1)),
                                onRight: () => state.set('contrast', Math.min(10, state.contrast + 1)),
                            });
                            break;
                    }
                }
            },
        });
    }

    function emit() {
        emitter.emit('update', view());
    }

    function resolveAction(id) {
        const entry = keyMap[id];
        if (!entry) return null;

        let action;
        if (state.shiftActive && entry.shift) {
            action = entry.shift;
            state.clearModifiers();
        } else if (state.alphaActive && entry.alpha) {
            action = entry.alpha;
            state.clearModifiers();
        } else {
            action = entry.normal;
            if (id !== 'shift' && id !== 'alpha') state.clearModifiers();
        }
        return action;
    }

    // Post-result: continue as Ans… (operators/postfix/power) or start fresh.
    function prepareInsert(continueAns) {
        if (!state.hasResult) return;
        if (continueAns) buffer.startWithAns(ansToken());
        else buffer.reset();
        state.set('hasResult', false);
    }

    function endStatements() { statementIndex = 0; dispIndicator = false; }

    // ---- history / replay (▲▼) -----------------------------------------
    function clearHistory() { history = []; histPos = null; }

    function pushHistory() {
        history.push({
            tree: buffer.snapshotTree(),
            resultLine, lastReal, showDecimal, engExp, dmsShow, factShow, lastDual, lastFracInput,
        });
        if (history.length > HISTORY_MAX) history.shift();
        histPos = null;
    }

    // Recall a stored calculation for editing; its result stays on screen.
    function loadHistory(i) {
        const e = history[i];
        buffer.setTree(e.tree);
        lastReal = e.lastReal; resultLine = e.resultLine;
        showDecimal = e.showDecimal; engExp = e.engExp; dmsShow = e.dmsShow;
        factShow = e.factShow; lastDual = e.lastDual; lastFracInput = e.lastFracInput;
        fracToggle = false; exprSuffix = '';
        endStatements();
        state.set('hasResult', false); // editable, with the old result shown
    }

    // ▲ available from a result, a cleared/empty entry (post-AC), or mid-scroll,
    // while an older entry remains; the first ▲ recalls the newest. A partly
    // typed expression is protected (no recall — it would be discarded). ▼ only
    // while scrolling and a newer entry exists. Both need the COMP root, so
    // fraction num↔den nav (canMoveVert) wins inside a fraction.
    const canScrollUp = () =>
        state.mode === 'COMP' && buffer.atRoot() && history.length > 0
        && (state.hasResult || histPos !== null || buffer.isEmpty())
        && (histPos === null || histPos > 0);
    const canScrollDown = () => histPos !== null && histPos < history.length - 1;

    function scrollHistory(dir) { // dir −1 = older (▲), +1 = newer (▼)
        if (dir < 0) {
            if (histPos === null) histPos = history.length - 1; // first ▲: newest
            else if (histPos > 0) histPos -= 1;
            else return;
        } else {
            if (histPos === null || histPos >= history.length - 1) return;
            histPos += 1;
        }
        loadHistory(histPos);
    }

    function insertToken(action) {
        const tok = makeToken(action);
        if (!tok) return;
        exprSuffix = '';
        endStatements();
        histPos = null; // editing exits history-scroll (the recalled expr stays)
        prepareInsert(tok.continueAns);
        // Enforce the 99-byte input buffer (real hardware blocks past this)
        if (buffer.bytes() + tok.bytes > INPUT_BYTE_LIMIT) return;
        buffer.insertLeaf(tok);
    }

    function insertTemplate(kind, continueAns) {
        endStatements();
        histPos = null;
        prepareInsert(continueAns);
        if (buffer.bytes() + 1 > INPUT_BYTE_LIMIT) return;
        buffer.insertTemplate(kind);
    }

    // SETUP Disp: comma decimal mark swaps '.' for ',' in decimal displays
    function markify(s) {
        return state.decimalMark === 'comma' ? s.split('.').join(',') : s;
    }

    // Does the buffer tree contain a fraction template anywhere?
    function treeHasFrac(items) {
        for (const it of items) {
            if (it.type === 'frac') return true;
            if (it.slots) {
                for (const s of it.order) if (treeHasFrac(it.slots[s])) return true;
            }
        }
        return false;
    }

    function renderResult() {
        // Pol/Rec dual results survive format changes (Fix/ab/c/Disp re-render both)
        if (lastDual) {
            const f = (v) => markify(formatReal(v, {
                displayFormat: state.displayFormat, fixDigits: state.fixDigits, fracForm: state.fracForm,
            }));
            // comma decimal mark → semicolon separates the two values
            const sep = state.decimalMark === 'comma' ? '; ' : ', ';
            resultLine = `${lastDual.l1}=${f(lastDual.v1)}${sep}${lastDual.l2}=${f(lastDual.v2)}`;
            return;
        }
        let out;
        if (factShow) {
            out = formatFactorization(lastReal) || resultLine;
        } else if (engExp !== null) {
            out = formatEng(toNumber(lastReal), engExp);
        } else if (dmsShow) {
            out = formatDMS(toNumber(lastReal));
        } else {
            // SHIFT S⇔D flips ab/c ⇔ d/c for this result only
            const fracForm = fracToggle ? (state.fracForm === 'dc' ? 'abc' : 'dc') : state.fracForm;
            // LineO/LineIO — and STAT mode, which forces linear — show
            // decimals, except fraction-template input which stays exact
            // (hardware). Applied at render time so RCL and SETUP
            // re-renders inherit the rule.
            const lineForced = state.io !== 'MathO' || state.mode === 'STAT';
            out = formatReal(lastReal, {
                showDecimal: showDecimal || (lineForced && !lastFracInput),
                displayFormat: state.displayFormat,
                fixDigits: state.fixDigits,
                fracForm,
            });
        }
        resultLine = markify(out);
    }

    // Evaluate the current buffer. Returns true on success.
    // forceDecimal (SHIFT+=) shows the decimal form regardless of input.
    // Split a flat token array on top-level ':' into statements.
    function splitByColon(flat) {
        const stmts = [[]];
        for (const t of flat) {
            if (t.type === 'colon') stmts.push([]);
            else stmts[stmts.length - 1].push(t);
        }
        return stmts.filter((s) => s.length > 0);
    }

    function evaluateExpression(forceDecimal = false) {
        if (buffer.isEmpty()) return false;
        const statements = splitByColon(buffer.evalTokens());
        const idx = Math.min(statementIndex, statements.length - 1);
        const stmt = statements[idx];
        const evalOpts = {
            angleUnit: state.angleUnit, memory,
            displayFormat: state.displayFormat, fixDigits: state.fixDigits,
            stat: statStore,
        };

        // VERIFY mode: a line with a relation is judged TRUE/FALSE (Ans := 1/0)
        if (state.mode === 'VERIF' && hasTopLevelRelation(stmt)) {
            const v = judge(stmt, evalOpts);
            if (v.ok) {
                lastReal = v.truth ? int(1) : int(0);
                memory.setAns(lastReal);
                state.set('hasResult', true);
                buffer.cursorToRootEnd();
                engExp = null; dmsShow = false; factShow = false; fracToggle = false;
                showDecimal = false; lastDual = null; lastFracInput = false;
                if (idx < statements.length - 1) { dispIndicator = true; statementIndex = idx + 1; }
                else { dispIndicator = false; }
                resultLine = v.truth ? 'TRUE' : 'FALSE';
                return true;
            }
            state.set('error', v.error);
            lastErrorPos = v.errorPos;
            return false;
        }

        const res = evaluateTokens(stmt, evalOpts);
        if (res.ok) {
            memory.setAns(res.value);
            state.set('hasResult', true);
            buffer.cursorToRootEnd();
            lastReal = res.value;
            lastDual = res.dual || null; // Pol/Rec dual payload (renderResult formats it)
            lastFracInput = treeHasFrac(buffer.tree());
            engExp = null; factShow = false; fracToggle = false; // fresh result → normal display
            // Step to the next statement; light Disp while more remain
            if (idx < statements.length - 1) { dispIndicator = true; statementIndex = idx + 1; }
            else { dispIndicator = false; }

            // : a decimal point or ×10ⁿ in the input forces a decimal
            // result (the LineO/LineIO rule is applied at render time)
            const hadDecimalInput = stmt.some((t) => t.type === 'dot' || t.type === 'exp10');
            showDecimal = forceDecimal || hadDecimalInput;
            dmsShow = stmt.some((t) => t.type === 'dms'); // DMS result form
            renderResult();
            // Record the calculation for ▲▼ replay (final statement only)
            if (state.mode === 'COMP' && !dispIndicator) pushHistory();
            return true;
        }
        state.set('error', res.error);
        lastErrorPos = res.errorPos;
        return false;
    }

    function clearBuffer() {
        buffer.reset();
    }

    // SHIFT RCL → [variable key]: evaluate what's on screen, store to the
    // variable, show "…→A". Storing via evaluation updates Ans (hardware rule).
    function doSto(letter) {
        if (!buffer.isEmpty() && !state.hasResult) {
            if (!evaluateExpression()) return; // error already set + shown
        }
        const empty = buffer.isEmpty();
        memory.store(letter, memory.getAns());
        if (empty) {
            // Storing plain Ans: the display register must show what was
            // actually stored (lastReal can be stale after AC or RCL)
            lastReal = memory.getAns();
            lastDual = null; lastFracInput = false;
            showDecimal = false;
            engExp = null; dmsShow = false; factShow = false; fracToggle = false;
            renderResult();
        }
        state.set('hasResult', true);
        exprSuffix = (empty ? 'Ans→' : '→') + letter;
    }

    // RCL → [variable key]: display the variable's value ("A=" + value).
    // RCL updates Ans (the manual lists RCL among the Ans-updating keys).
    function doRcl(letter) {
        const v = memory.recall(letter);
        memory.setAns(v);
        buffer.reset();
        endStatements();
        lastReal = v;
        lastDual = null; lastFracInput = false;
        showDecimal = false;
        engExp = null; dmsShow = false; factShow = false; fracToggle = false;
        state.set('hasResult', true);
        exprSuffix = letter + '=';
        renderResult();
    }

    // Factory-default setup (CLR 1:Setup / 3:All)
    function resetSetup() {
        state.set('angleUnit', 'DEG');
        state.set('displayFormat', 'NORM1');
        state.set('fixDigits', null);
        state.set('io', 'MathO');
        state.set('fracForm', 'dc');
        state.set('decimalMark', 'dot');
        state.set('statFreq', true);
        state.set('contrast', 5);
        state.set('mode', 'COMP');
        statStore.clear();
        statEd.active = false;
    }

    // ---- STAT mode: data editor + menus --------------------------------

    function statCols() {
        const cols = ['x'];
        if (statStore.isPaired()) cols.push('y');
        if (state.statFreq) cols.push('FREQ');
        return cols;
    }
    function fieldForCol(c) {
        if (c === 0) return 'x';
        if (statStore.isPaired() && c === 1) return 'y';
        return 'f';
    }

    function enterEditor() {
        statEd.active = true;
        statEd.row = 0;
        statEd.col = 0;
        clearBuffer();
        state.set('hasResult', false);
        state.clearError();
        endStatements();      // no Disp indicator inside the editor
        exprSuffix = '';
    }

    function statMoveCell(id) {
        const rows = statStore.rows;
        if (id === 'up') statEd.row = Math.max(0, statEd.row - 1);
        else if (id === 'down') statEd.row = statEd.row < rows.length ? statEd.row + 1 : 0; // wrap off the blank row
        else if (id === 'left' && statEd.col > 0) statEd.col--;
        else if (id === 'right' && statEd.col < statCols().length - 1) statEd.col++;
    }

    function statCommitCell() {
        if (buffer.isEmpty()) return;
        const res = evaluateTokens(buffer.evalTokens(), {
            angleUnit: state.angleUnit, memory,
            displayFormat: state.displayFormat, fixDigits: state.fixDigits,
            stat: statStore,
        });
        if (!res.ok) {
            state.set('error', res.error);
            lastErrorPos = res.errorPos;
            return;
        }
        const rows = statStore.rows;
        if (statEd.row === rows.length) {
            if (rows.length >= statStore.capacity(state.statFreq)) { clearBuffer(); return; } // data full
            rows.push({ x: 0, y: 0, f: 1 });
        }
        rows[statEd.row][fieldForCol(statEd.col)] = toNumber(res.value);
        clearBuffer();
        statEd.row = Math.min(statEd.row + 1, rows.length); // hardware: move down
    }

    function statDeleteRow() {
        if (statEd.row < statStore.rows.length) {
            statStore.rows.splice(statEd.row, 1);
            statEd.row = Math.min(statEd.row, statStore.rows.length);
        }
    }

    function openStatTypeMenu() {
        openMenu(STAT_TYPES.slice(), (n) => {
            statStore.setType(STAT_TYPES[n - 1]); // clears data
            enterEditor();
        });
    }

    // Insert a stat summary token onto the calculation screen. These submenus
    // are only reachable from the calc-screen STAT menu (the editor menu has
    // no token items), so the current buffer is a real expression, not a
    // half-typed cell — appending is correct (e.g. 4 then ŷ → 4ŷ).
    function statTokenMenu(labels, ids) {
        openMenu(labels, (n) => insertToken(ids[n - 1]));
    }

    function openStatEditMenu() {
        openMenu(['Ins', 'Del-A'], (k) => {
            if (k === 1) { // insert a blank row above the cursor
                if (!statEd.active) enterEditor();
                if (statStore.rows.length < statStore.capacity(state.statFreq)
                    && statEd.row < statStore.rows.length) {
                    statStore.rows.splice(statEd.row, 0, { x: 0, y: 0, f: 1 });
                }
            } else { // Del-A: clear all data
                statStore.clear();
                statEd.row = 0; statEd.col = 0;
            }
        });
    }

    // The SHIFT 1 STAT menu is context-sensitive: the data editor offers
    // Type/Data/Edit; the calculation screen offers the summary submenus.
    // (Exact positions → Phase 13 hardware QA.)
    function openStatMenu() {
        const paired = statStore.isPaired();
        const quad = statStore.isQuad();

        if (statEd.active) {
            openMenu(['Type', 'Data', 'Edit'], (n) => {
                if (n === 1) openStatTypeMenu();
                else if (n === 2) enterEditor();
                else openStatEditMenu();
            });
            return;
        }

        const top = ['Type', 'Data', 'Sum', 'Var'].concat(paired ? ['Reg', 'MinMax'] : ['MinMax']);
        openMenu(top, (n) => {
            switch (top[n - 1]) {
                case 'Type': openStatTypeMenu(); break;
                case 'Data': enterEditor(); break;
                case 'Sum': {
                    // Paired types expose all eight sums; 1-VAR only Σx²/Σx.
                    const labels = paired ? ['Σx²', 'Σx', 'Σy²', 'Σy', 'Σxy', 'Σx³', 'Σx²y', 'Σx⁴'] : ['Σx²', 'Σx'];
                    const ids = paired
                        ? ['stat:sumX2', 'stat:sumX', 'stat:sumY2', 'stat:sumY', 'stat:sumXY', 'stat:sumX3', 'stat:sumX2Y', 'stat:sumX4']
                        : ['stat:sumX2', 'stat:sumX'];
                    statTokenMenu(labels, ids);
                    break;
                }
                case 'Var': {
                    const labels = ['n', 'x̄', 'σx', 'sx'].concat(paired ? ['ȳ', 'σy', 'sy'] : []);
                    const ids = ['stat:n', 'stat:meanX', 'stat:popSDX', 'stat:smpSDX'].concat(paired ? ['stat:meanY', 'stat:popSDY', 'stat:smpSDY'] : []);
                    statTokenMenu(labels, ids);
                    break;
                }
                case 'MinMax': {
                    // 1-VAR adds the quartiles; paired shows the y extrema.
                    const labels = paired ? ['minX', 'maxX', 'minY', 'maxY'] : ['minX', 'maxX', 'Q₁', 'med', 'Q₃'];
                    const ids = paired
                        ? ['stat:minX', 'stat:maxX', 'stat:minY', 'stat:maxY']
                        : ['stat:minX', 'stat:maxX', 'stat:q1', 'stat:med', 'stat:q3'];
                    statTokenMenu(labels, ids);
                    break;
                }
                case 'Reg': {
                    const labels = quad ? ['A', 'B', 'C', 'x̂1', 'x̂2', 'ŷ'] : ['A', 'B', 'r', 'x̂', 'ŷ'];
                    const ids = quad
                        ? ['stat:regA', 'stat:regB', 'stat:regC', 'stat:xhat1', 'stat:xhat2', 'stat:yhat']
                        : ['stat:regA', 'stat:regB', 'stat:regR', 'stat:xhat', 'stat:yhat'];
                    statTokenMenu(labels, ids);
                    break;
                }
            }
        });
    }

    // Commands that only re-render the current result keep the "→A"/"A=" suffix
    const SUFFIX_PRESERVING = ['@shift', '@alpha', '@sd', '@abcdc', '@eng', '@engback', '@fact'];

    function handleCommand(cmd) {
        if (!SUFFIX_PRESERVING.includes(cmd)) exprSuffix = '';
        switch (cmd) {
            case '@shift': state.toggleShift(); break;
            case '@alpha': state.toggleAlpha(); break;

            case '@ac':
                clearBuffer();
                state.clearError();
                state.set('hasResult', false);
                lastReal = int(0);
                showDecimal = false;
                engExp = null;
                dmsShow = false;
                factShow = false;
                fracToggle = false;
                lastDual = null;
                lastFracInput = false;
                menu = null;
                pending = null;
                endStatements();
                histPos = null; // AC exits history-scroll (but keeps the history)
                resultLine = '0';
                break;

            case '@del':
                if (state.hasResult) state.set('hasResult', false); // enter edit mode
                endStatements();
                histPos = null; // deleting from a recalled expr detaches it from history
                buffer.del();
                break;
            // After a result, ◀ re-enters edit with the cursor at the END and
            // ▶ with the cursor at the START (hardware replay-edit rule).
            case '@left':
                if (state.hasResult) { state.set('hasResult', false); break; } // cursor already at root end
                buffer.moveLeft();
                break;
            case '@right':
                if (state.hasResult) { state.set('hasResult', false); buffer.setRootCursor(0); break; }
                buffer.moveRight();
                break;
            // ▲/▼: fraction num↔den navigation when inside a fraction; else
            // COMP history replay (recall a previous calculation for editing).
            case '@up':
                if (buffer.canMoveVert()) buffer.moveUp();
                else if (canScrollUp()) scrollHistory(-1);
                break;
            case '@down':
                if (buffer.canMoveVert()) buffer.moveDown();
                else if (canScrollDown()) scrollHistory(1);
                break;

            case '@frac': insertTemplate('frac', false); break; // fraction template
            case '@pow': insertTemplate('pow', true); break;    // xⁿ raised exponent

            case '@equals':
                evaluateExpression(false);
                break;

            case '@equalsdec': // SHIFT+= : evaluate and force the decimal form
                evaluateExpression(true);
                break;

            case '@sd': // S⇔D : toggle the last result between exact and decimal
                if (state.hasResult && hasExactForm(lastReal)) {
                    engExp = null;
                    dmsShow = false;
                    showDecimal = !showDecimal;
                    renderResult();
                }
                break;

            case '@abcdc': // SHIFT S⇔D : mixed ⇔ improper fraction for this result
                if (state.hasResult && !lastDual && lastReal.k === 'rat' && lastReal.q > 1n) {
                    fracToggle = !fracToggle;
                    showDecimal = false;
                    renderResult();
                }
                break;

            case '@eng': // engineering notation, step exponent up by 3
                if (state.hasResult) {
                    engExp = engExp === null ? engBase(toNumber(lastReal)) : engExp + 3;
                    renderResult();
                }
                break;

            case '@engback': // ←ENG, step exponent down by 3
                if (state.hasResult) {
                    engExp = engExp === null ? engBase(toNumber(lastReal)) : engExp - 3;
                    renderResult();
                }
                break;

            case '@mplus':
            case '@mminus':
                // Real hardware evaluates whatever is on screen, then accumulates
                if (!buffer.isEmpty() && !state.hasResult) {
                    if (!evaluateExpression()) break; // error already set
                }
                if (cmd === '@mplus') memory.mPlus(memory.getAns());
                else memory.mMinus(memory.getAns());
                break;

            case '@sto': pending = 'STO'; break; // STO indicator lights; next key names the variable
            case '@rcl': pending = 'RCL'; break; // RCL indicator lights; next key names the variable

            case '@mode': // MODE: 1 COMP, 2 STAT, 3 VERIF (no TABLE/BASE-N on this model)
                openMenu(['COMP', 'STAT', 'VERIF'], (n) => {
                    const newMode = ['COMP', 'STAT', 'VERIF'][n - 1];
                    const leavingStat = state.mode === 'STAT' && newMode !== 'STAT';
                    if (newMode !== state.mode) clearHistory(); // history is cleared on a mode change
                    state.set('mode', newMode);
                    if (leavingStat) statStore.clear(); // hardware clears data on leaving STAT (Ans kept)
                    statEd.active = false;
                    handleCommand('@ac'); // hardware clears the screen on mode entry (Ans/memory kept)
                    if (newMode === 'STAT') openStatTypeMenu(); // entering STAT asks the type first
                });
                break;

            case '@statmenu': // SHIFT 1 — STAT menu (STAT mode only)
                if (state.mode === 'STAT') openStatMenu();
                break;

            case '@relmenu': // SHIFT 6 — relational operators (VERIFY mode only)
                if (state.mode === 'VERIF') {
                    openMenu(['=', '≠', '>', '<', '≥', '≤'],
                        (n) => insertToken(['rel:eq', 'rel:ne', 'rel:gt', 'rel:lt', 'rel:ge', 'rel:le'][n - 1]));
                }
                break;

            case '@setup': openSetupMenu(); break;

            case '@clr': // CLR: 1 Setup, 2 Memory, 3 All — each with a =/AC confirm
                openMenu(['Setup', 'Memory', 'All'], (n) => {
                    const labels = ['Setup', 'Memory', 'All'];
                    openMenu({
                        prompt: `Reset ${labels[n - 1]}? [=]:Yes [AC]:Cancel`,
                        onEquals: () => {
                            if (n === 1 || n === 3) resetSetup();
                            if (n === 2 || n === 3) memory.clearAll();
                            handleCommand('@ac');
                        },
                    });
                });
                break;

            case '@on':
                clearBuffer();
                statEd.active = false;
                state.clearError();
                state.set('hasResult', false);
                state.set('isOn', true);
                lastReal = int(0);
                showDecimal = false;
                engExp = null;
                dmsShow = false;
                factShow = false;
                fracToggle = false;
                lastDual = null;
                lastFracInput = false;
                menu = null;
                pending = null;
                endStatements();
                clearHistory(); // ON clears the replay history
                resultLine = '0';
                break;

            case '@off':
                state.clearModifiers();
                menu = null;
                pending = null;
                state.set('isOn', false);
                break;

            case '@drg': // DRG▸ menu: append a unit marker converting to the current mode
                openMenu(['°', 'ʳ', 'ᵍ'], (n) => insertToken(['drg_deg', 'drg_rad', 'drg_grad'][n - 1]));
                break;

            case '@fact': // FACT: show the last result's prime factorisation
                if (state.hasResult && formatFactorization(lastReal)) {
                    engExp = null; dmsShow = false;
                    factShow = !factShow;
                    renderResult();
                }
                break;

            case '@hyp': // hyperbolic-function menu
                openMenu(
                    ['sinh', 'cosh', 'tanh', 'sinh⁻¹', 'cosh⁻¹', 'tanh⁻¹'],
                    (n) => insertToken(['sinh(', 'cosh(', 'tanh(', 'sinh⁻¹(', 'cosh⁻¹(', 'tanh⁻¹('][n - 1]),
                );
                break;

            default:
                // Unimplemented commands — silently ignore for now
                break;
        }
    }

    function handleButton(id) {
        if (!state.isOn && id !== 'on') return;

        // Modal menu (hyp, DRG▸, MODE, SETUP, CLR…): digits select, AC cancels,
        // ▲▼ turn SETUP pages, ◀▶ adjust CONT, = confirms CLR.
        if (menu) {
            const m = menu;
            if (id === 'ac') { menu = null; emit(); return; }
            if (id === 'on') { menu = null; handleCommand('@on'); emit(); return; } // hard escape
            if (m.pages) {
                if (id === 'down') { m.pageIndex = Math.min(m.pageIndex + 1, m.pages.length - 1); emit(); return; }
                if (id === 'up') { m.pageIndex = Math.max(m.pageIndex - 1, 0); emit(); return; }
                const opts = m.pages[m.pageIndex];
                if (/^[1-9]$/.test(id) && Number(id) <= opts.length) {
                    const page = m.pageIndex;
                    menu = null;
                    m.onSelect(page, Number(id));
                }
                emit(); return;
            }
            if (m.options) {
                if (/^[1-9]$/.test(id) && Number(id) <= m.options.length) {
                    menu = null;
                    m.onSelect(Number(id));
                }
                emit(); return;
            }
            // prompt shapes: Fix/Sci/Norm digit entry, CLR confirm, CONT adjust.
            // onDigit may return false to reject the digit (prompt stays open),
            // and may itself open a follow-up menu (checked via menu === m).
            if (m.onDigit && /^[0-9]$/.test(id)) {
                const accepted = m.onDigit(Number(id));
                if (accepted !== false && menu === m) menu = null;
                emit(); return;
            }
            if (m.onEquals && id === 'equals') { menu = null; m.onEquals(); emit(); return; }
            if (m.onLeft && id === 'left') { m.onLeft(); emit(); return; }   // stays open
            if (m.onRight && id === 'right') { m.onRight(); emit(); return; } // stays open
            emit(); return;
        }

        // Pending STO/RCL: the next key names the variable (its alpha letter,
        // pressed WITHOUT alpha — hardware behavior). AC/DEL cancels.
        if (pending) {
            if (id === 'ac' || id === 'del') { pending = null; emit(); return; }
            if (id === 'on') { pending = null; handleCommand('@on'); emit(); return; } // hard escape
            const entry = keyMap[id];
            const letter = entry && entry.alpha;
            if (letter && VAR_NAMES.includes(letter)) {
                const kind = pending;
                pending = null;
                if (kind === 'STO') doSto(letter);
                else doRcl(letter);
            }
            // other keys are inert while the STO/RCL indicator is lit
            emit(); return;
        }

        // Error recovery (real hardware): AC clears; ◀/▶ jump the cursor to
        // the offending token; DEL enters edit-recovery at that token.
        if (state.error) {
            if (id === 'ac') {
                state.clearError();
                handleCommand('@ac');
            } else if (id === 'left' || id === 'right') {
                state.clearError();
                buffer.setRootCursor(lastErrorPos);
            } else if (id === 'del') {
                state.clearError();
                buffer.setRootCursor(lastErrorPos);
                buffer.del();
            }
            emit();
            return;
        }

        const action = resolveAction(id);
        if (action == null) { emit(); return; }

        // STAT data editor. Interception runs AFTER resolveAction so SHIFT/
        // ALPHA resolve first (SHIFT+AC → OFF, SHIFT+1 → STAT menu). = commits
        // the cell, arrows move cells and DEL deletes the row when no entry is
        // in progress, AC exits to the calc screen; MODE/SETUP/CLR/STAT-menu
        // pass through; the memory/coordinate ops the manual forbids are
        // swallowed. Everything else builds the cell entry.
        if (statEd.active) {
            if (action === '@off') { handleCommand('@off'); emit(); return; }
            if (action === '@ac') { statEd.active = false; handleCommand('@ac'); emit(); return; }
            if (action === '@equals') { statCommitCell(); emit(); return; }
            if (action === '@statmenu') { openStatMenu(); emit(); return; }
            if (buffer.isEmpty()) {
                if (action === '@up' || action === '@down' || action === '@left' || action === '@right') {
                    statMoveCell(action.slice(1)); emit(); return;
                }
                if (action === '@del') { statDeleteRow(); emit(); return; }
            }
            // ops forbidden in the Stat editor
            if (['@mplus', '@mminus', '@sto', '@rcl'].includes(action) || action === 'Pol(' || action === 'Rec(' || action === ':') {
                emit(); return;
            }
            // @mode / @setup / @clr / @on and cell-building keys fall through
        }

        if (action.charAt(0) === '@') {
            handleCommand(action);
        } else if (action === '°' && state.hasResult) {
            // °'" on a result toggles decimal ⇔ DMS (not a new entry)
            engExp = null;
            dmsShow = !dmsShow;
            renderResult();
        } else {
            insertToken(action);
        }

        emit();
    }

    return {
        state,
        memory,
        handleButton,
        // Auto Power Off (hardware parity): the UI idle timer calls this to
        // blank the display; memory survives and ON revives it.
        powerOff() { handleCommand('@off'); emit(); },
        getView: view,
        getExpr: () => buffer.linear(),
        getEvalString: () => buffer.evalTokens().map((t) => t.evalStr).join(''),
        getCursorPos: () => buffer.linearCursorIndex(),
        getTokenCursor: () => buffer.rootCursor(),
        getTokens: () => buffer.tree().slice(),
        on: emitter.on,
        off: emitter.off,
    };
}
