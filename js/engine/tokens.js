// ===========================================
// PLEXEN Calculator — token model
// The expression buffer is an array of typed tokens, not a flat string.
// Each token carries:
//   type       category (digit, op, func, postfix, …)
//   text       what it draws on the LCD (linear mode)
//   evalStr    what the Phase-3 adapter feeds to evaluate()
//   bytes      input-buffer cost toward the 99-byte limit
//   continueAns  pressed right after '=', continue as Ans<token> (needs a
//                left operand) rather than starting a fresh expression
//
// For now text === evalStr for every token, so joining evalStr reproduces
// exactly the old flat buffer — evaluate() is unchanged and every fixture
// still passes. The win is in EDITING: DEL removes a whole token, the
// cursor only ever lands on token boundaries, and post-result semantics
// are decided per token type.
//
// Byte costs are provisional (real Scientific values get calibrated against
// hardware in Phase 13); they exist so the 99-byte limit is enforced.
// ===========================================

export const INPUT_BYTE_LIMIT = 99;
export const LOW_SPACE_BYTES = 10; // ■ cursor shows at/below this many free bytes

// spec builder
function spec(type, s, bytes, continueAns = false) {
    return { type, text: s, evalStr: s, bytes, continueAns };
}

const SPECS = Object.create(null);
function register(type, list, bytes, continueAns = false) {
    for (const s of list) SPECS[s] = spec(type, s, bytes, continueAns);
}

// Digits and decimal point (parts of a number literal)
register('digit', ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'], 1);
register('dot', ['.'], 1);

// Binary operators — continue as Ans after a result
register('op', ['+', '-', '×', '÷'], 1, true);

// Grouping
register('open', ['('], 1);
register('close', [')'], 1);
register('comma', [','], 1);

// Unary minus marker
register('neg', ['(-)'], 1);

// Functions that open a parenthesis (need no left operand → start fresh)
register('func', ['sin(', 'cos(', 'tan(', 'log(', 'ln(', '√(', 'Abs('], 4);
register('func', ['sin⁻¹(', 'cos⁻¹(', 'tan⁻¹('], 5);
register('func', ['10^(', 'e^('], 4);
register('func', ['Rnd(', '∛('], 4);

// Ran# — nullary random value; RanInt#( a , b ) — random integer function
SPECS['Ran#'] = { type: 'ran', text: 'Ran#', evalStr: 'Ran#', bytes: 2, continueAns: false };
register('func2', ['RanInt#('], 6);

// Power opens a paren but needs a left operand → continue as Ans
register('power', ['^('], 2, true);

// Postfix operators — need a left operand → continue as Ans
register('postfix', ['²', '³', '⁻¹', '!', '%'], 2, true);

// Binary combinatorial operators (nPr, nCr) — display as P / C
SPECS['nPr'] = { type: 'binop', text: 'P', evalStr: 'P', bytes: 2, continueAns: true };
SPECS['nCr'] = { type: 'binop', text: 'C', evalStr: 'C', bytes: 2, continueAns: true };

// Two-argument comma functions (comma is legal only inside their parens)
register('func2', ['GCD(', 'LCM(', 'Pol(', 'Rec('], 4);

// Scientific-notation entry key
register('exp10', ['×10^'], 2);

// VERIFY-mode relational operators (via the SHIFT 6 menu)
const REL = { 'rel:eq': '=', 'rel:ne': '≠', 'rel:gt': '>', 'rel:lt': '<', 'rel:ge': '≥', 'rel:le': '≤' };
for (const [id, text] of Object.entries(REL)) {
    SPECS[id] = { type: 'rel', op: id.slice(4), text, evalStr: text, bytes: 1, continueAns: false };
}

// Degree / minute / second separator (D°M'S")
register('dms', ['°'], 1);

// Hyperbolic functions (via the hyp menu) — angle-unit-independent
register('func', ['sinh(', 'cosh(', 'tanh(', 'sinh⁻¹(', 'cosh⁻¹(', 'tanh⁻¹('], 5);

// DRG▸ unit markers (via the DRG menu): convert the preceding value from
// this unit to the current angle mode. Distinct token type from the DMS °.
SPECS['drg_deg'] = { type: 'postfix', op: 'drg_deg', text: '°', evalStr: '°', bytes: 1, continueAns: true };
SPECS['drg_rad'] = { type: 'postfix', op: 'drg_rad', text: 'ʳ', evalStr: 'ʳ', bytes: 1, continueAns: true };
SPECS['drg_grad'] = { type: 'postfix', op: 'drg_grad', text: 'ᵍ', evalStr: 'ᵍ', bytes: 1, continueAns: true };

// Constants
register('const', ['π', 'e'], 1);

// Ans
register('ans', ['Ans'], 1);

// Multi-statement separator (ALPHA ENG)
register('colon', [':'], 1);

// STAT summary variables (inserted via the SHIFT 1 menu in STAT mode).
// type 'stat' + a stat name resolved against the stat store at eval time.
const STAT_VARS = {
    'stat:n': 'n', 'stat:meanX': 'x̄', 'stat:popSDX': 'σx', 'stat:smpSDX': 'sx',
    'stat:meanY': 'ȳ', 'stat:popSDY': 'σy', 'stat:smpSDY': 'sy',
    'stat:sumX': 'Σx', 'stat:sumX2': 'Σx²', 'stat:sumY': 'Σy', 'stat:sumY2': 'Σy²',
    'stat:sumXY': 'Σxy', 'stat:sumX3': 'Σx³', 'stat:sumX2Y': 'Σx²y', 'stat:sumX4': 'Σx⁴',
    'stat:minX': 'minX', 'stat:maxX': 'maxX', 'stat:minY': 'minY', 'stat:maxY': 'maxY',
    'stat:q1': 'Q₁', 'stat:med': 'med', 'stat:q3': 'Q₃',
    'stat:regA': 'A', 'stat:regB': 'B', 'stat:regC': 'C', 'stat:regR': 'r',
};
for (const [id, text] of Object.entries(STAT_VARS)) {
    SPECS[id] = { type: 'stat', stat: id.slice(5), text, evalStr: text, bytes: 3, continueAns: false };
}

// STAT estimate postfixes (Reg menu): value then x̂/ŷ
const STAT_POSTFIX = { 'stat:xhat': ['xhat', 'x̂'], 'stat:xhat1': ['xhat1', 'x̂1'], 'stat:xhat2': ['xhat2', 'x̂2'], 'stat:yhat': ['yhat', 'ŷ'] };
for (const [id, [op, text]] of Object.entries(STAT_POSTFIX)) {
    SPECS[id] = { type: 'statpost', op, text, evalStr: text, bytes: 3, continueAns: true };
}

// Variables A–F, X, Y, M
register('var', ['A', 'B', 'C', 'D', 'E', 'F', 'X', 'Y', 'M'], 1);

/** Build a fresh token for an insert-action string, or null if unknown. */
export function makeToken(action) {
    const s = SPECS[action];
    return s ? { ...s } : null;
}

/** The Ans token, used when a post-result key continues the calculation. */
export function ansToken() {
    return makeToken('Ans');
}

/** LCD string (linear mode) for the whole buffer. */
export function tokensDisplay(tokens) {
    let out = '';
    for (const t of tokens) out += t.text;
    return out;
}

/** Adapter: the string handed to evaluate(). */
export function tokensEval(tokens) {
    let out = '';
    for (const t of tokens) out += t.evalStr;
    return out;
}

/** Character offset of a token-index cursor, for the flat renderer. */
export function charIndex(tokens, tokenCursor) {
    let n = 0;
    for (let i = 0; i < tokenCursor; i++) n += tokens[i].text.length;
    return n;
}

/** Total input-buffer bytes consumed. */
export function tokensBytes(tokens) {
    let n = 0;
    for (const t of tokens) n += t.bytes;
    return n;
}
