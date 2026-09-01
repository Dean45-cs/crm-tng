import { describe, it, expect } from 'vitest';
import { estimateNet, clampRate, DEFAULT_DEDUCTION_RATE } from './netto';

describe('estimateNet', () => {
  it('rechnet einen einfachen Abzugssatz korrekt', () => {
    expect(estimateNet(100, 30)).toEqual({ net: 70, deductions: 30 });
  });

  it('rundet kaufmännisch auf Cent', () => {
    const { net, deductions } = estimateNet(123.45, 30);
    expect(deductions).toBe(37.04);
    expect(net).toBe(86.41);
    // Netto + Abzüge ergeben wieder das Brutto
    expect(Math.round((net + deductions) * 100) / 100).toBe(123.45);
  });

  it('behandelt 0 % und 100 %-Kappung', () => {
    expect(estimateNet(500, 0)).toEqual({ net: 500, deductions: 0 });
    // Satz wird auf 70 % gekappt
    expect(estimateNet(100, 95)).toEqual({ net: 30, deductions: 70 });
  });

  it('fällt bei ungültigen Eingaben nicht um', () => {
    expect(estimateNet(NaN, 30)).toEqual({ net: 0, deductions: 0 });
    expect(estimateNet(-50, 30)).toEqual({ net: 0, deductions: 0 });
    expect(estimateNet(100, NaN)).toEqual({
      net: 100 - DEFAULT_DEDUCTION_RATE,
      deductions: DEFAULT_DEDUCTION_RATE,
    });
  });
});

describe('clampRate', () => {
  it('begrenzt auf 0–70 und ersetzt Unsinn durch den Default', () => {
    expect(clampRate(-5)).toBe(0);
    expect(clampRate(30)).toBe(30);
    expect(clampRate(99)).toBe(70);
    expect(clampRate(Infinity)).toBe(DEFAULT_DEDUCTION_RATE);
  });
});
