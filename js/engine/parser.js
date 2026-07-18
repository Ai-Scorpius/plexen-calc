// ===========================================
// PLEXEN Calculator — recursive-descent parser
// Consumes the typed token array (js/engine/tokens.js) and produces an
// AST. Encodes the Scientific precedence, tightest first:
//
//   postfix (x² x³ x⁻¹ x!)  >  power (x^)  >  unary minus (-)
//   >  implicit multiplication (2π, 2(3), 5sin30 — TIGHTER than × ÷)
//   >  explicit × ÷  >  binary + −
//
// (nPr/nCr, fractions, roots, %, DMS arrive in later phases at their
//  documented levels.) Nodes carry `pos` = the token index they start at,
//  so evaluation errors can jump the cursor to the offending token.
//
// Throws { kind: 'syntax' | 'stack', pos } on malformed input.
// ===========================================

const FUNC_NAMES = {
    'sin(': 'sin', 'cos(': 'cos', 'tan(': 'tan',
    'sin⁻¹(': 'asin', 'cos⁻¹(': 'acos', 'tan⁻¹(': 'atan',
    'log(': 'log', 'ln(': 'ln', '√(': 'sqrt', 'Abs(': 'abs',
    '10^(': 'pow10', 'e^(': 'exp', 'Rnd(': 'rnd', '∛(': 'cbrt',
    'sinh(': 'sinh', 'cosh(': 'cosh', 'tanh(': 'tanh',
    'sinh⁻¹(': 'asinh', 'cosh⁻¹(': 'acosh', 'tanh⁻¹(': 'atanh',
};
const POSTFIX_OPS = { '²': 'sq', '³': 'cube', '⁻¹': 'inv', '!': 'fact', '%': 'pct' };
const FUNC2_NAMES = { 'GCD(': 'gcd', 'LCM(': 'lcm', 'RanInt#(': 'ranint', 'Pol(': 'pol', 'Rec(': 'rec' };
const MAX_DEPTH = 24; // parenthesis/function nesting → Stack ERROR beyond this

export function parse(tokens) {
    let i = 0;
    let depth = 0;

    const type = () => (i < tokens.length ? tokens[i].type : null);
    const text = () => (i < tokens.length ? tokens[i].text : null);
    const atEnd = () => i >= tokens.length;
    const err = (kind, pos = i) => { throw { kind, pos }; };

    function expectClose() {
        if (type() === 'close') { i++; return; }
        if (atEnd()) return;          // auto-close a trailing paren
        err('syntax');                // stray token where ')' was expected
    }

    function parseExpr() { return parseAddSub(); }

    function parseAddSub() {
        let node = parseMulDiv();
        while (type() === 'op' && (text() === '+' || text() === '-')) {
            const t = text() === '+' ? 'add' : 'sub';
            const pos = i; i++;
            node = { t, a: node, b: parseMulDiv(), pos };
        }
        return node;
    }

    function parseMulDiv() {
        let node = parseNpr();
        while (type() === 'op' && (text() === '×' || text() === '÷')) {
            const t = text() === '×' ? 'mul' : 'div';
            const pos = i; i++;
            node = { t, a: node, b: parseNpr(), pos };
        }
        return node;
    }

    // nPr / nCr — binary, tighter than ×÷, looser than implicit multiplication.
    function parseNpr() {
        let node = parseImplicitMul();
        while (type() === 'binop') {
            const t = text() === 'P' ? 'nPr' : 'nCr';
            const pos = i; i++;
            node = { t, a: node, b: parseImplicitMul(), pos };
        }
        return node;
    }

    function canStartFactor() {
        const tt = type();
        return tt === 'digit' || tt === 'dot' || tt === 'exp10' || tt === 'open'
            || tt === 'func' || tt === 'const' || tt === 'ans' || tt === 'var' || tt === 'stat';
    }

    function parseImplicitMul() {
        let node = parseStatPost();
        while (canStartFactor()) {
            const pos = i;
            node = { t: 'mul', a: node, b: parseStatPost(), pos };
        }
        return node;
    }

    // x̂ / x̂1 / x̂2 / ŷ estimates — looser than unary minus ( priority 6),
    // so −2ŷ parses as ŷ(−2), not −ŷ(2).
    function parseStatPost() {
        let node = parseUnary();
        while (type() === 'statpost') {
            const op = tokens[i].op; const pos = i; i++;
            node = { t: 'statpost', op, x: node, pos };
        }
        return node;
    }

    function parseUnary() {
        if (type() === 'neg') { const pos = i; i++; return { t: 'neg', x: parseUnary(), pos }; }
        if (type() === 'op' && text() === '-') { const pos = i; i++; return { t: 'neg', x: parseUnary(), pos }; }
        if (type() === 'op' && text() === '+') { i++; return parseUnary(); }
        return parseFactor();
    }

    // Postfix and power, left-associative: 5³³ = (5³)³, 2^(3)² = (2³)²... etc.
    function parseFactor() {
        let node = parsePrimary();
        for (;;) {
            if (type() === 'postfix') {
                const op = POSTFIX_OPS[text()] || tokens[i].op; const pos = i; i++;
                node = { t: 'postfix', op, x: node, pos };
                continue;
            }
            if (type() === 'power') { // '^(' — needs a base, opens a paren
                const pos = i; i++;
                const b = parseExpr();
                expectClose();
                node = { t: 'pow', a: node, b, pos };
                continue;
            }
            break;
        }
        return node;
    }

    function parseNumber() {
        const pos = i;
        let s = '';
        while (type() === 'digit' || type() === 'dot') { s += text(); i++; }
        const mant = s === '' ? '1' : s; // leading ×10^ → mantissa 1
        if (mant === '.' || (mant.match(/\./g) || []).length > 1) err('syntax', pos);
        let exp = 0;
        if (type() === 'exp10') { // ×10^ binds as part of the literal ()
            i++;
            let sign = 1;
            if (type() === 'neg') { i++; sign = -1; }
            let ds = '';
            while (type() === 'digit') { ds += text(); i++; }
            if (ds === '') err('syntax', pos);
            exp = sign * parseInt(ds, 10);
        }
        // Keep the exact source so the evaluator can build a rational.
        return { t: 'num', text: mant, exp, pos };
    }

    function parsePrimary() {
        if (depth > MAX_DEPTH) err('stack');
        const tt = type();
        const pos = i;

        if (tt === 'digit' || tt === 'dot' || tt === 'exp10') {
            const first = parseNumber();
            // DMS literal: D° [M° [S°]] — each component followed by °
            if (type() === 'dms') {
                i++; // consume ° after degrees
                const parts = [first];
                while (parts.length < 3 && (type() === 'digit' || type() === 'dot')) {
                    const c = parseNumber();
                    if (type() !== 'dms') err('syntax');
                    i++; // consume ° after this component
                    parts.push(c);
                }
                return { t: 'dms', parts, pos };
            }
            return first;
        }

        if (tt === 'open') {
            i++; depth++;
            const e = parseExpr();
            depth--;
            expectClose();
            return e;
        }

        if (tt === 'func') {
            const name = FUNC_NAMES[text()];
            i++; depth++;
            const arg = parseExpr();
            depth--;
            expectClose();
            return { t: 'func', name, x: arg, pos };
        }

        if (tt === 'func2') { // GCD( , ) / LCM( , )
            const name = FUNC2_NAMES[text()];
            i++; depth++;
            const a = parseExpr();
            if (type() !== 'comma') err('syntax');
            i++;
            const b = parseExpr();
            depth--;
            expectClose();
            return { t: 'func2', name, a, b, pos };
        }

        if (tt === 'const') { const name = text() === 'π' ? 'pi' : 'e'; i++; return { t: 'const', name, pos }; }
        if (tt === 'ans') { i++; return { t: 'ans', pos }; }
        if (tt === 'ran') { i++; return { t: 'ran', pos }; }
        if (tt === 'var') { const name = text(); i++; return { t: 'var', name, pos }; }
        if (tt === 'stat') { const name = tokens[i].stat; i++; return { t: 'stat', name, pos }; }

        // op / close / comma / postfix / power without operand, or EOF
        err('syntax');
    }

    const ast = parseExpr();
    if (!atEnd()) err('syntax');
    return ast;
}
