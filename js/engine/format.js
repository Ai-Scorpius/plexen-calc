// ===========================================
// PLEXEN Calculator — result formatting
// formatReal() renders a Real value: the exact fraction/surd form when the
// result is exact and decimal display isn't forced, else a decimal string
// via formatResult(). (Norm1/Norm2/Fix/Sci/ENG fidelity is Phase 5.)
// ===========================================
import { toNumber, isExact, toExactString } from './real.js';

/**
 * Render a Real for the display.
 * @param {object} real
 * @param {object} opts
 * @param {boolean} opts.showDecimal  force the decimal form (S⇔D / decimal input)
 * @param {string}  opts.displayFormat  NORM1|NORM2|FIX|SCI
 * @param {number|null} opts.fixDigits
 * @param {string}  opts.fracForm  'dc' improper | 'abc' mixed-number fractions
 */
export function formatReal(real, { showDecimal = false, displayFormat = 'NORM1', fixDigits = null, fracForm = 'dc' } = {}) {
    const decimal = () => formatResult(toNumber(real), { displayFormat, fixDigits });
    // FIX/SCI always show a decimal; otherwise prefer the exact form.
    if (displayFormat === 'FIX' || displayFormat === 'SCI') return decimal();
    if (!showDecimal && isExact(real)) {
        const s = toExactString(real);
        if (s !== null) {
            // ab/c: show an improper rational as a mixed number ("3/2" → "1 1/2")
            if (fracForm === 'abc' && real.k === 'rat' && real.q > 1n) {
                const neg = real.p < 0n;
                const P = neg ? -real.p : real.p;
                const whole = P / real.q;
                if (whole > 0n) return `${neg ? '-' : ''}${whole} ${P % real.q}/${real.q}`;
            }
            return s;
        }
    }
    return decimal();
}

/** True when the value has an exact form S⇔D can toggle to. */
export function hasExactForm(real) {
    return isExact(real) && toExactString(real) !== null;
}

// ---- ENG / ←ENG (engineering notation) -------------------------------
// The normalized engineering exponent: largest multiple of 3 ≤ log10|v|.
export function engBase(v) {
    if (v === 0) return 0;
    return 3 * Math.floor(Math.log10(Math.abs(v)) / 3);
}

// Up to 10 sig figs, positional (mantissa can be <1 when stepped past base).
function mantissaStr(m) {
    if (m === 0) return '0';
    const exp = Math.floor(Math.log10(Math.abs(m)));
    const decimals = Math.min(Math.max(9 - exp, 0), 99);
    return stripZeros(Number(m.toPrecision(10)).toFixed(decimals));
}

/** Render a number in engineering form m×10ⁿ with the given exponent. */
export function formatEng(value, engExp) {
    return sciForm(mantissaStr(value / Math.pow(10, engExp)), engExp);
}

// ---- FACT (prime factorisation) --------------------------------------
function primeFactors(n) {
    const f = [];
    let d = 2n;
    while (d * d <= n) {
        if (n % d === 0n) { let e = 0n; while (n % d === 0n) { n /= d; e++; } f.push([d, e]); }
        d += d === 2n ? 1n : 2n;
    }
    if (n > 1n) f.push([n, 1n]);
    return f;
}

/** Prime factorisation string, e.g. 1014 → "2×3×13²". Null if not a
 *  positive integer ≤ 10 digits (the reference device’s FACT limit). */
export function formatFactorization(real) {
    if (real.k !== 'rat' || real.q !== 1n || real.p <= 0n) return null;
    const n = real.p;
    if (n.toString().length > 10) return null;
    if (n === 1n) return '1';
    return primeFactors(n)
        .map(([p, e]) => (e === 1n ? p.toString() : p.toString() + superscript(e.toString())))
        .join('×');
}

// ---- DMS (degrees / minutes / seconds) -------------------------------
/** Render a decimal-degrees value as D°M'S". */
export function formatDMS(value) {
    const neg = value < 0;
    let a = Math.abs(value);
    let d = Math.floor(a);
    let mf = (a - d) * 60;
    let m = Math.floor(mf + 1e-9);
    let s = (mf - m) * 60;
    s = Math.round(s * 1e6) / 1e6;   // tame float noise
    if (s >= 60) { s -= 60; m += 1; }
    if (m >= 60) { m -= 60; d += 1; }
    const sStr = stripZeros(s.toFixed(6));
    return `${neg ? '-' : ''}${d}°${m}'${sStr}"`;
}

// ---- ×10ⁿ display form ----------------------------------------------
const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
function superscript(n) {
    return String(n).split('').map((c) => SUP[c] || c).join('');
}
// mantissa string + raised exponent → "1.23×10³" (never JS "1.23e+3")
export function sciForm(mantissa, exp) {
    return `${mantissa}×10${superscript(exp)}`;
}
function stripZeros(s) {
    return s.indexOf('.') >= 0 ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

//  10-significant-digit decimal, in ×10ⁿ form, trailing zeros stripped.
function normSci(num) {
    const [m, e] = num.toExponential(9).split('e');
    return sciForm(stripZeros(m), parseInt(e, 10));
}
function normFixed(num) {
    if (num === 0) return '0';
    const rounded = Number(num.toPrecision(10)); // 10 significant figures
    const a = Math.abs(rounded);
    if (a >= 1e10) return normSci(num);           // rounding pushed it over the boundary
    // Positional notation with up to 10 sig figs (toFixed avoids the
    // e-notation toPrecision emits for small magnitudes).
    const exp = Math.floor(Math.log10(a));
    const decimals = Math.min(Math.max(9 - exp, 0), 99);
    return stripZeros(rounded.toFixed(decimals));
}

/**
 * Format a JS number per the active display mode.
 * NORM1: exponential when |x| < 10⁻² or ≥ 10¹⁰.  NORM2: < 10⁻⁹ or ≥ 10¹⁰.
 * FIX n: n decimal places.  SCI n: n significant digits (1–10; 0 ⇒ 10).
 */
export function formatResult(num, { displayFormat = 'NORM1', fixDigits = null } = {}) {
    if (!isFinite(num)) return String(num);

    if (displayFormat === 'SCI' && fixDigits !== null) {
        const sig = fixDigits === 0 ? 10 : fixDigits;      // Sci keeps trailing zeros
        const [m, e] = num.toExponential(sig - 1).split('e');
        return sciForm(m, parseInt(e, 10));
    }

    if (displayFormat === 'FIX' && fixDigits !== null) {
        if (Math.abs(num) >= 1e10) return normSci(num);    // too big for fixed → sci
        return num.toFixed(fixDigits);
    }

    // NORM1 / NORM2
    const lo = displayFormat === 'NORM2' ? 1e-9 : 1e-2;
    const a = Math.abs(num);
    if (a !== 0 && (a < lo || a >= 1e10)) return normSci(num);
    return normFixed(num);
}
