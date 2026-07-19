// ===========================================
// PLEXEN Calculator — key map
// Each physical key -> { normal, shift, alpha } action.
// Actions are insert strings, or command names prefixed with '@'.
// (Phase 2 replaces the string payloads with token descriptors; the
//  shape of this table survives that change.)
// ===========================================

export const keyMap = {
    // Digits
    '0': { normal: '0', shift: 'Rnd(' },
    '1': { normal: '1', shift: '@statmenu' }, // SHIFT 1 = STAT menu (STAT mode)
    '2': { normal: '2' },
    '3': { normal: '3' },
    '4': { normal: '4' },
    '5': { normal: '5' },
    '6': { normal: '6', shift: '@relmenu' }, // SHIFT 6 = relational-operator menu (VERIF)
    '7': { normal: '7' },
    '8': { normal: '8' },
    '9': { normal: '9', shift: '@clr' }, // SHIFT 9 = CLR menu
    'dot': { normal: '.', shift: 'Ran#', alpha: 'RanInt#(' },

    // Operators
    'add':      { normal: '+', shift: 'Pol(' },
    'subtract': { normal: '-', shift: 'Rec(' },
    // nPr/nCr/GCD/LCM key placement is PROVISIONAL (faceplate shows them near
    // DEL/AC; exact access verified against hardware in Phase 13).
    'multiply': { normal: '×', shift: 'nPr', alpha: 'GCD(' },
    'divide':   { normal: '÷', shift: 'nCr', alpha: 'LCM(' },

    // Function buttons
    'sin': { normal: 'sin(', shift: 'sin⁻¹(', alpha: 'D' },
    'cos': { normal: 'cos(', shift: 'cos⁻¹(', alpha: 'E' },
    'tan': { normal: 'tan(', shift: 'tan⁻¹(', alpha: 'F' },
    'log': { normal: 'log(', shift: '10^(' },
    'ln':  { normal: 'ln(', shift: 'e^(' },
    'sqrt':       { normal: '√(', shift: '∛(' }, // SHIFT √ = cube root
    'square':     { normal: '²' },
    'power':      { normal: '@pow' }, // xⁿ raised-exponent template (natural display)
    // ALPHA x³ = multi-statement ':' — the faceplate photo (ANALYSIS.md
    // "Confirmed accurate" list) shows the pink ':' printed above x³; the
    // audit's [ALPHA][ENG] keystroke claim was its own error.
    'cube':       { normal: '³', alpha: ':' },
    'abs':        { normal: 'Abs(' },
    'reciprocal': { normal: '⁻¹' },
    'factorial':  { normal: '!' },
    'fraction':   { normal: '@frac' },
    'hyp':        { normal: '@hyp', alpha: 'C' },
    'negate':     { normal: '(-)', alpha: 'A' },
    // °'" degree/minute/second key (SHIFT = FACT prime factorization, Phase 7)
    'dms':        { normal: '°', shift: '@fact', alpha: 'B' },

    // Memory & variables
    'ans':   { normal: 'Ans', shift: '@drg' },
    'exp':   { normal: '×10^', shift: 'π', alpha: 'e' },
    'mplus': { normal: '@mplus', shift: '@mminus', alpha: 'M' },
    'rcl':   { normal: '@rcl', shift: '@sto' },

    // Parentheses. Alpha letters per the faceplate photos: X on ')', Y on S⇔D
    'lparen': { normal: '(', shift: '%' },
    'rparen': { normal: ')', shift: ',', alpha: 'X' },

    // Other function buttons
    'eng': { normal: '@eng', shift: '@engback' },
    'sd':  { normal: '@sd', shift: '@abcdc', alpha: 'Y' }, // SHIFT = ab/c⇔d/c

    // Commands
    'equals': { normal: '@equals', shift: '@equalsdec' },
    'ac':     { normal: '@ac', shift: '@off' },
    'del':    { normal: '@del', shift: '@ins' },
    'mode':   { normal: '@mode', shift: '@setup' },
    'on':     { normal: '@on' },
    'shift':  { normal: '@shift' },
    'alpha':  { normal: '@alpha' },

    // Navigation
    'up':    { normal: '@up' },
    'down':  { normal: '@down' },
    'left':  { normal: '@left' },
    'right': { normal: '@right' },
};
