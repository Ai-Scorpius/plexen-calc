// ===========================================
// PLEXEN Calculator — statistics engine (pure, headless)
// Data store + summary statistics + the Scientific regression family:
//   1-VAR, A+BX, _+CX² (quadratic), ln X, e^X, A·B^X, A·X^B, 1/X
// All computation in JS numbers (hardware shows decimal stats).
// Throws { kind: 'math' } on undefined statistics (no data, n−1=0,
// domain failures in transformed regressions, zero denominators).
// ===========================================

export const STAT_TYPES = ['1-VAR', 'A+BX', '_+CX²', 'ln X', 'e^X', 'A·B^X', 'A·X^B', '1/X'];

const mathErr = () => { throw { kind: 'math' }; };

export function createStatStore() {
    return {
        type: '1-VAR',
        rows: [], // { x, y, f }  (y used by paired types, f by the FREQ setting)

        setType(t) {
            if (!STAT_TYPES.includes(t)) mathErr();
            // Hardware keeps the data when switching between paired types;
            // it only clears when crossing the 1-VAR ↔ paired boundary.
            if ((this.type === '1-VAR') !== (t === '1-VAR')) this.rows = [];
            this.type = t;
        },
        clear() { this.rows = []; },
        isPaired() { return this.type !== '1-VAR'; },
        isQuad() { return this.type === '_+CX²'; },

        // Row capacity for the Scientific: 40 (1-var), 20 (1-var+freq),
        // 40 (paired), 26 (paired+freq).
        capacity(freqOn) {
            return this.isPaired() ? (freqOn ? 26 : 40) : (freqOn ? 20 : 40);
        },
    };
}

// ---- frequency-weighted sums ------------------------------------------
export function computeSums(rows) {
    const s = { n: 0, sumX: 0, sumX2: 0, sumX3: 0, sumX4: 0, sumY: 0, sumY2: 0, sumXY: 0, sumX2Y: 0 };
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const r of rows) {
        const f = r.f;
        if (f <= 0) continue; // zero-frequency rows contribute nothing
        s.n += f;
        s.sumX += f * r.x;
        s.sumX2 += f * r.x * r.x;
        s.sumX3 += f * r.x ** 3;
        s.sumX4 += f * r.x ** 4;
        s.sumY += f * r.y;
        s.sumY2 += f * r.y * r.y;
        s.sumXY += f * r.x * r.y;
        s.sumX2Y += f * r.x * r.x * r.y;
        if (r.x < minX) minX = r.x;
        if (r.x > maxX) maxX = r.x;
        if (r.y < minY) minY = r.y;
        if (r.y > maxY) maxY = r.y;
    }
    s.minX = minX; s.maxX = maxX; s.minY = minY; s.maxY = maxY;
    return s;
}

// Two-pass SD (numerically stable — the one-pass Σx²−nx̄² form catastrophically
// cancels for high-magnitude, low-spread data). `sel` picks x or y from a row.
function sdFromRows(rows, sel, sum, n) {
    if (n <= 0) return { mean: NaN, pop: null, smp: null };
    const mean = sum / n;
    let s2 = 0;
    let scale = 0;
    for (const r of rows) {
        if (r.f <= 0) continue;
        const d = sel(r) - mean;
        s2 += r.f * d * d;
        const a = Math.abs(sel(r));
        if (a > scale) scale = a;
    }
    // Snap cancellation residue to 0 (BCD hardware shows 0 for constant data);
    // the floor sits well below any spread a 10-digit display could resolve.
    if (s2 <= scale * scale * n * 1e-20) s2 = 0;
    return {
        mean,
        pop: Math.sqrt(s2 / n),
        smp: n > 1 ? Math.sqrt(s2 / (n - 1)) : null,
    };
}

// Median / quartiles over the frequency-expanded, sorted x data.  uses
// the "exclusive" hinge method (quartiles are medians of the halves, the
// overall median excluded when n is odd). Exact method → Phase 13 hardware QA.
function quartiles(rows) {
    const xs = [];
    for (const r of rows) {
        if (r.f <= 0) continue;
        if (r.f !== Math.floor(r.f) || r.f > 100000) mathErr(); // guard runaway expansion
        for (let k = 0; k < r.f; k++) xs.push(r.x);
    }
    if (xs.length === 0) mathErr();
    xs.sort((a, b) => a - b);
    const med = (arr) => {
        const m = arr.length;
        return m % 2 ? arr[(m - 1) / 2] : (arr[m / 2 - 1] + arr[m / 2]) / 2;
    };
    const n = xs.length;
    const half = Math.floor(n / 2);
    const lower = xs.slice(0, half);
    const upper = xs.slice(n - half); // excludes the middle element when n is odd
    return { q1: med(lower), med: med(xs), q3: med(upper) };
}

// ---- regression -------------------------------------------------------
// Transform each paired type onto a linear fit v = a + b·u, then map back.
function transform(type, x, y) {
    switch (type) {
        case 'A+BX': return [x, y];
        case 'ln X': if (x <= 0) mathErr(); return [Math.log(x), y];
        case 'e^X': if (y <= 0) mathErr(); return [x, Math.log(y)];
        case 'A·B^X': if (y <= 0) mathErr(); return [x, Math.log(y)];
        case 'A·X^B': if (x <= 0 || y <= 0) mathErr(); return [Math.log(x), Math.log(y)];
        case '1/X': if (x === 0) mathErr(); return [1 / x, y];
        default: mathErr();
    }
}

function linearFit(pairs) {
    let n = 0, su = 0, su2 = 0, sv = 0, sv2 = 0, suv = 0;
    for (const [u, v, f] of pairs) {
        n += f; su += f * u; su2 += f * u * u; sv += f * v; sv2 += f * v * v; suv += f * u * v;
    }
    if (n < 2) mathErr();
    const Suu = su2 - (su * su) / n;
    const Svv = sv2 - (sv * sv) / n;
    const Suv = suv - (su * sv) / n;
    if (Suu === 0) mathErr();
    const b = Suv / Suu;
    const a = sv / n - b * (su / n);
    // r needs Svv; a horizontal fit (all v equal) leaves a/b well-defined but
    // r undefined → null (not an error). Clamp to [−1,1] against rounding.
    const r = Svv > 0 ? Math.max(-1, Math.min(1, Suv / Math.sqrt(Suu * Svv))) : null;
    return { a, b, r };
}

/** Regression coefficients for the store's type: {A, B, C?, r?}. */
export function regression(store) {
    const rows = store.rows.filter((r) => r.f > 0);
    if (store.type === '1-VAR') mathErr();

    if (store.isQuad()) {
        // Normal equations for y = A + Bx + Cx² (Cramer's rule)
        const s = computeSums(rows);
        if (s.n < 3) mathErr();
        const M = [
            [s.n, s.sumX, s.sumX2, s.sumY],
            [s.sumX, s.sumX2, s.sumX3, s.sumXY],
            [s.sumX2, s.sumX3, s.sumX4, s.sumX2Y],
        ];
        const det3 = (m) =>
            m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
            m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
            m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
        const D = det3(M.map((row) => row.slice(0, 3)));
        if (D === 0) mathErr();
        const col = (k) => M.map((row) => row.slice(0, 3).map((v, j) => (j === k ? row[3] : v)));
        const A = det3(col(0)) / D;
        const B = det3(col(1)) / D;
        const C = det3(col(2)) / D;
        return { A, B, C };
    }

    const pairs = rows.map((r) => { const [u, v] = transform(store.type, r.x, r.y); return [u, v, r.f]; });
    const { a, b, r } = linearFit(pairs);
    switch (store.type) {
        case 'A+BX': return { A: a, B: b, r };
        case 'ln X': return { A: a, B: b, r };
        case '1/X': return { A: a, B: b, r };
        case 'e^X': return { A: Math.exp(a), B: b, r };
        case 'A·B^X': return { A: Math.exp(a), B: Math.exp(b), r };
        case 'A·X^B': return { A: Math.exp(a), B: b, r };
        default: mathErr();
    }
}

/** ŷ: estimate y at the given x. */
export function estimateY(store, x) {
    const g = regression(store);
    switch (store.type) {
        case 'A+BX': return g.A + g.B * x;
        case '_+CX²': return g.A + g.B * x + g.C * x * x;
        case 'ln X': if (x <= 0) mathErr(); return g.A + g.B * Math.log(x);
        case 'e^X': return g.A * Math.exp(g.B * x);
        case 'A·B^X': return g.A * Math.pow(g.B, x);
        case 'A·X^B': return g.A * Math.pow(x, g.B);
        case '1/X': if (x === 0) mathErr(); return g.A + g.B / x;
        default: mathErr();
    }
}

/** x̂: estimate x at the given y (linear-family types). */
export function estimateX(store, y) {
    const g = regression(store);
    switch (store.type) {
        case 'A+BX': if (g.B === 0) mathErr(); return (y - g.A) / g.B;
        case 'ln X': if (g.B === 0) mathErr(); return Math.exp((y - g.A) / g.B);
        case 'e^X': if (g.B === 0 || y / g.A <= 0) mathErr(); return Math.log(y / g.A) / g.B;
        case 'A·B^X': { const lb = Math.log(g.B); if (lb === 0 || y / g.A <= 0) mathErr(); return Math.log(y / g.A) / lb; }
        case 'A·X^B': if (g.B === 0 || y / g.A <= 0) mathErr(); return Math.pow(y / g.A, 1 / g.B);
        case '1/X': if (y === g.A) mathErr(); return g.B / (y - g.A);
        default: mathErr(); // quadratic uses x̂1/x̂2
    }
}

/** x̂1/x̂2: the two quadratic roots of A + Bx + Cx² = y. */
export function estimateXQuad(store, y, which) {
    if (!store.isQuad()) mathErr();
    const g = regression(store);
    if (g.C === 0) mathErr();
    const disc = g.B * g.B - 4 * g.C * (g.A - y);
    if (disc < 0) mathErr();
    const sq = Math.sqrt(disc);
    return which === 1 ? (-g.B + sq) / (2 * g.C) : (-g.B - sq) / (2 * g.C);
}

// ---- named summary values (the SHIFT 1 menu tokens) ---------------------
export function statValue(store, name) {
    if (!store) mathErr();
    const rows = store.rows.filter((r) => r.f > 0);
    const s = computeSums(rows);
    const need = (cond) => { if (!cond) mathErr(); };

    switch (name) {
        case 'n': return s.n;
        case 'sumX': return s.sumX;
        case 'sumX2': return s.sumX2;
        case 'sumX3': return s.sumX3;
        case 'sumX4': return s.sumX4;
        case 'sumY': return s.sumY;
        case 'sumY2': return s.sumY2;
        case 'sumXY': return s.sumXY;
        case 'sumX2Y': return s.sumX2Y;
        case 'meanX': need(s.n > 0); return s.sumX / s.n;
        case 'popSDX': need(s.n > 0); return sdFromRows(rows, (r) => r.x, s.sumX, s.n).pop;
        case 'smpSDX': { need(s.n > 1); return sdFromRows(rows, (r) => r.x, s.sumX, s.n).smp; }
        case 'meanY': need(s.n > 0); return s.sumY / s.n;
        case 'popSDY': need(s.n > 0); return sdFromRows(rows, (r) => r.y, s.sumY, s.n).pop;
        case 'smpSDY': { need(s.n > 1); return sdFromRows(rows, (r) => r.y, s.sumY, s.n).smp; }
        case 'minX': need(rows.length > 0); return s.minX;
        case 'maxX': need(rows.length > 0); return s.maxX;
        case 'minY': need(rows.length > 0); return s.minY;
        case 'maxY': need(rows.length > 0); return s.maxY;
        case 'q1': return quartiles(rows).q1;
        case 'med': return quartiles(rows).med;
        case 'q3': return quartiles(rows).q3;
        case 'regA': return regression(store).A;
        case 'regB': return regression(store).B;
        case 'regC': { const g = regression(store); need('C' in g); return g.C; }
        case 'regR': { const g = regression(store); need(g.r != null); return g.r; }
        default: mathErr();
    }
}
