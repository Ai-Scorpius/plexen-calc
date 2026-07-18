// ===========================================
// PLEXEN Calculator — natural-display renderer
// Renders the structured expression tree (js/engine/buffer.js) as nested
// HTML/CSS boxes: stacked fractions, raised exponent boxes, empty ■ slots,
// and the caret at its path position. Also stacks fraction/surd RESULTS.
// No canvas; the caret is kept visible by scrolling the container only
// (never the page — fixes B24).
// ===========================================

function caretEl(view) {
    const c = document.createElement('span');
    c.className = view.lowSpace ? 'cursor cursor-low' : 'cursor';
    return c;
}
function placeholderEl() {
    const p = document.createElement('span');
    p.className = 'eph';
    p.textContent = '□';
    return p;
}

function fracBox(numFrag, denFrag) {
    const box = document.createElement('span');
    box.className = 'efrac';
    const n = document.createElement('span'); n.className = 'enum'; n.appendChild(numFrag);
    const bar = document.createElement('span'); bar.className = 'ebar';
    const d = document.createElement('span'); d.className = 'eden'; d.appendChild(denFrag);
    box.append(n, bar, d);
    return box;
}

function renderSlot(items, view, isRoot = false) {
    const frag = document.createDocumentFragment();
    // No caret on a result screen (hardware); ◀/▶ re-enter edit mode
    const isCursorSlot = items === view.cursorSlot && !view.hasResult;

    if (items.length === 0) {
        if (isCursorSlot) frag.appendChild(caretEl(view));
        else if (!isRoot) frag.appendChild(placeholderEl());
        return frag;
    }
    for (let i = 0; i < items.length; i++) {
        if (isCursorSlot && i === view.cursorLeafPos) frag.appendChild(caretEl(view));
        frag.appendChild(renderItem(items[i], view));
    }
    if (isCursorSlot && view.cursorLeafPos === items.length) frag.appendChild(caretEl(view));
    return frag;
}

function renderItem(it, view) {
    if (it.type === 'frac') {
        return fracBox(renderSlot(it.slots.num, view), renderSlot(it.slots.den, view));
    }
    if (it.type === 'pow') {
        const sup = document.createElement('sup');
        sup.className = 'epow';
        sup.appendChild(renderSlot(it.slots.exp, view));
        return sup;
    }
    const span = document.createElement('span');
    span.className = 'etok';
    span.textContent = it.text;
    return span;
}

export function renderExpr(exprEl, view) {
    exprEl.innerHTML = '';
    exprEl.appendChild(renderSlot(view.tree, view, true));

    // Display-only suffix: "→A" after STO, "A=" after RCL
    if (view.exprSuffix) {
        const s = document.createElement('span');
        s.className = 'etok';
        s.textContent = view.exprSuffix;
        exprEl.appendChild(s);
    }

    // B24: scroll only the container to keep the caret in view (not the page)
    const caret = exprEl.querySelector('.cursor');
    if (caret) {
        const cl = caret.offsetLeft;
        const cw = exprEl.clientWidth;
        if (cl < exprEl.scrollLeft) exprEl.scrollLeft = Math.max(0, cl - 8);
        else if (cl > exprEl.scrollLeft + cw - 10) exprEl.scrollLeft = cl - cw + 14;
    }
}

// ---- result line: stack pure fractions, draw √ vinculums ---------------
function rootBox(radStr) {
    const r = document.createElement('span');
    r.className = 'rroot';
    r.appendChild(document.createTextNode('√'));
    const rad = document.createElement('span');
    rad.className = 'rrad';
    rad.textContent = radStr;
    r.appendChild(rad);
    return r;
}
function renderInline(str) {
    const frag = document.createDocumentFragment();
    const re = /√(\d+)/g;
    let last = 0, m;
    while ((m = re.exec(str))) {
        if (m.index > last) frag.appendChild(document.createTextNode(str.slice(last, m.index)));
        frag.appendChild(rootBox(m[1]));
        last = re.lastIndex;
    }
    if (last < str.length) frag.appendChild(document.createTextNode(str.slice(last)));
    return frag;
}

export function renderResultInto(el, str) {
    el.innerHTML = '';
    // Fraction: [whole ]NUM/den — the optional whole part is an ab/c mixed
    // number ("1 1/2"); den is trailing digits (and not ×10ⁿ / DMS)
    const m = /^(-?)(?:(\d+) )?([^\s/]+)\/(\d+)$/.exec(str);
    if (m && !str.includes('×10') && !str.includes('°')) {
        const numText = m[3].replace(/^\((.*)\)$/, '$1');
        const frac = fracBox(renderInline(numText), document.createTextNode(m[4]));
        if (m[1]) el.appendChild(document.createTextNode('-'));
        if (m[2]) el.appendChild(document.createTextNode(m[2]));
        el.appendChild(frac);
        return;
    }
    el.appendChild(renderInline(str));
}
