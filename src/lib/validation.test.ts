import { describe, it, expect } from 'vitest';
import { isJiraTicket, normalizeJiraTicket, findDuplicateCustomer } from './validation';
import type { Contract, TariffChange } from '../types';

describe('isJiraTicket', () => {
  it('akzeptiert leere Eingabe (Feld ist optional)', () => {
    expect(isJiraTicket('')).toBe(true);
    expect(isJiraTicket('   ')).toBe(true);
  });
  it('akzeptiert gültige Schlüssel', () => {
    expect(isJiraTicket('TNG-1234')).toBe(true);
    expect(isJiraTicket('AB-1')).toBe(true);
  });
  it('lehnt ungültige Formate ab', () => {
    expect(isJiraTicket('tng-1234')).toBe(false); // Kleinbuchstaben
    expect(isJiraTicket('A-1')).toBe(false); // nur ein Buchstabe
    expect(isJiraTicket('TNG-')).toBe(false);
    expect(isJiraTicket('1234')).toBe(false);
  });
});

describe('normalizeJiraTicket', () => {
  it('trimmt und schreibt groß', () => {
    expect(normalizeJiraTicket('  tng-1234 ')).toBe('TNG-1234');
  });
});

describe('findDuplicateCustomer', () => {
  const contracts = [
    { customerNumber: '1000', customerName: 'Alice' } as Contract,
  ];
  const tariffs: TariffChange[] = [];

  it('findet abweichenden Namen zur gleichen Kundennummer', () => {
    expect(findDuplicateCustomer('1000', 'Bob', contracts, tariffs)).toBe('Alice');
  });
  it('liefert null bei gleichem Namen', () => {
    expect(findDuplicateCustomer('1000', 'Alice', contracts, tariffs)).toBeNull();
  });
  it('liefert null bei unbekannter Kundennummer', () => {
    expect(findDuplicateCustomer('9999', 'Bob', contracts, tariffs)).toBeNull();
  });
});
