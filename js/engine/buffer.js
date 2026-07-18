// ===========================================
// PLEXEN Calculator — structured expression buffer (natural display)
// The buffer is a TREE: an ordered list of items, where each item is
// either a leaf token (js/engine/tokens.js) or a CONTAINER with named
// child slots that are themselves item lists:
//   fraction  { type:'frac', slots:{num, den}, order:['num','den'] }
//   power     { type:'pow',  slots:{exp},       order:['exp'] }
// The cursor is a PATH: a stack of container frames plus a position in the
// deepest slot. ◀▶ do an in-order traversal that enters/exits slots; ▲▼
// move between a fraction's numerator and denominator.
//
// evalTokens() flattens the tree back to a flat leaf-token array the parser
// consumes (frac → "(num)÷(den)", pow → "^(exp)"), so the parser/evaluator
// are unchanged. For a leaf-only buffer the flat array equals the root, so
// everything (eval, cursor indices, error positions) matches Phase 2–5.
// ===========================================
import { makeToken } from './tokens.js';

export function isContainer(it) {
    return it.type === 'frac' || it.type === 'pow';
}

export function makeFrac() {
    return { type: 'frac', slots: { num: [], den: [] }, order: ['num', 'den'], bytes: 1 };
}
export function makePow() {
    return { type: 'pow', slots: { exp: [] }, order: ['exp'], bytes: 1 };
}
const TEMPLATES = { frac: makeFrac, pow: makePow };

// Synthetic tokens used when flattening containers for evaluation.
const OPEN = makeToken('(');
const CLOSE = makeToken(')');
const DIVIDE = makeToken('÷');
const POWTOK = makeToken('^(');

export function createBuffer() {
    let root = [];
    // cursor: current slot array + position, and a stack of ancestor frames
    let slot = root;
    let pos = 0;
    let stack = []; // [{ arr, index, container, slot }]

    function reset() { root = []; slot = root; pos = 0; stack = []; }

    function currentContainerFrame() { return stack[stack.length - 1] || null; }

    // ---- editing --------------------------------------------------------
    function insertLeaf(tok) {
        slot.splice(pos, 0, tok);
        pos++;
    }

    function insertTemplate(kind) {
        const make = TEMPLATES[kind];
        if (!make) return;
        const c = make();
        slot.splice(pos, 0, c);
        // descend into the first slot so the user types the numerator/exponent
        enter(c, pos, c.order[0], 'start');
    }

    function enter(container, indexInArr, slotName, where) {
        stack.push({ arr: slot, index: indexInArr, container, slot: slotName });
        slot = container.slots[slotName];
        pos = where === 'end' ? slot.length : 0;
    }

    function del() {
        if (pos > 0) {
            slot.splice(pos - 1, 1); // removes a leaf or a whole container
            pos--;
            return;
        }
        // at the start of a nested slot: step out to the parent (no delete)
        const f = currentContainerFrame();
        if (f) {
            stack.pop();
            slot = f.arr;
            pos = f.index;
        }
    }

    // ---- navigation -----------------------------------------------------
    function moveLeft() {
        if (pos > 0) {
            const left = slot[pos - 1];
            if (isContainer(left)) { enter(left, pos - 1, lastSlot(left), 'end'); return; }
            pos--;
            return;
        }
        const f = currentContainerFrame();
        if (!f) return; // at the very start
        const order = f.container.order;
        const si = order.indexOf(f.slot);
        if (si > 0) { // move to the previous slot of the same container (end)
            f.slot = order[si - 1];
            slot = f.container.slots[f.slot];
            pos = slot.length;
        } else { // exit the container to the left
            stack.pop();
            slot = f.arr;
            pos = f.index;
        }
    }

    function moveRight() {
        if (pos < slot.length) {
            const right = slot[pos];
            if (isContainer(right)) { enter(right, pos, firstSlot(right), 'start'); return; }
            pos++;
            return;
        }
        const f = currentContainerFrame();
        if (!f) return; // at the very end
        const order = f.container.order;
        const si = order.indexOf(f.slot);
        if (si < order.length - 1) { // move to the next slot of the same container (start)
            f.slot = order[si + 1];
            slot = f.container.slots[f.slot];
            pos = 0;
        } else { // exit the container to the right
            stack.pop();
            slot = f.arr;
            pos = f.index + 1;
        }
    }

    // ▲/▼ move between a fraction's numerator and denominator.
    function moveVert(dir) {
        const f = currentContainerFrame();
        if (!f || f.container.type !== 'frac') return;
        const target = dir === 'up' ? 'num' : 'den';
        if (f.slot === target) return;
        f.slot = target;
        slot = f.container.slots[target];
        pos = Math.min(pos, slot.length);
    }
    const moveUp = () => moveVert('up');
    const moveDown = () => moveVert('down');

    function lastSlot(c) { return c.order[c.order.length - 1]; }
    function firstSlot(c) { return c.order[0]; }

    // ---- projections ----------------------------------------------------
    function evalTokens(items = root) {
        const out = [];
        for (const it of items) {
            if (it.type === 'frac') {
                // Wrap the whole fraction in an outer paren so a following ^,
                // postfix, or implicit-mult binds to the fraction as a unit.
                out.push(OPEN, OPEN, ...evalTokens(it.slots.num), CLOSE, DIVIDE, OPEN, ...evalTokens(it.slots.den), CLOSE, CLOSE);
            } else if (it.type === 'pow') {
                out.push(POWTOK, ...evalTokens(it.slots.exp), CLOSE);
            } else {
                out.push(it);
            }
        }
        return out;
    }

    function bytesOf(items = root) {
        let n = 0;
        for (const it of items) {
            if (isContainer(it)) {
                n += it.bytes;
                for (const s of it.order) n += bytesOf(it.slots[s]);
            } else {
                n += it.bytes;
            }
        }
        return n;
    }

    // Linear string (backward-compatible with the flat display for tests).
    function linear(items = root) {
        let s = '';
        for (const it of items) {
            if (it.type === 'frac') s += linear(it.slots.num) + '/' + linear(it.slots.den);
            else if (it.type === 'pow') s += '^(' + linear(it.slots.exp) + ')';
            else s += it.text;
        }
        return s;
    }

    function linearCursorIndex() {
        // Only exact when the cursor is at the root (the case tests rely on).
        if (stack.length) return linear().length;
        let n = 0;
        for (let i = 0; i < pos; i++) n += leafText(root[i]);
        return n;
    }
    function leafText(it) {
        if (it.type === 'frac') return (linear(it.slots.num) + '/' + linear(it.slots.den)).length;
        if (it.type === 'pow') return ('^(' + linear(it.slots.exp) + ')').length;
        return it.text.length;
    }

    // Deep copy — history snapshots must be independent of the live buffer.
    function cloneItems(items) {
        return items.map((it) => {
            if (it.slots) {
                const slots = {};
                for (const s of it.order) slots[s] = cloneItems(it.slots[s]);
                return { ...it, slots };
            }
            return { ...it };
        });
    }

    return {
        reset,
        isEmpty: () => root.length === 0,
        atRoot: () => stack.length === 0,
        insertLeaf,
        insertTemplate,
        del,
        moveLeft, moveRight, moveUp, moveDown,
        cursorToRootEnd() { stack = []; slot = root; pos = root.length; },
        setRootCursor(p) { stack = []; slot = root; pos = Math.max(0, Math.min(p, root.length)); },
        startWithAns(tok) { reset(); root.push(tok); pos = 1; },
        // history snapshot / restore (independent deep copies)
        snapshotTree: () => cloneItems(root),
        setTree(items) { root = cloneItems(items); slot = root; stack = []; pos = root.length; },
        // ▲/▼ can the cursor move vertically inside a fraction here?
        canMoveVert() {
            const f = stack[stack.length - 1];
            return !!(f && f.container.type === 'frac');
        },
        // projections
        evalTokens: () => evalTokens(root),
        bytes: () => bytesOf(root),
        linear: () => linear(root),
        linearCursorIndex,
        rootCursor: () => (stack.length ? -1 : pos),
        // renderer access (identity of the active slot pins the caret)
        tree: () => root,
        cursorSlot: () => slot,
        cursorPos: () => pos,
    };
}
