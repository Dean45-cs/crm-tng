import { describe, it, expect } from 'vitest';
import { isJiraTicket, normalizeJiraTicket, findDuplicateCustomer } from './validation';
import { makeContract, makeTariff } from '../test/fixtures';

describe('isJiraTicket', () => {
  it('akzeptiert gültige Schlüssel und leere Eingaben', () => {
    expect(isJiraTicket('TNG-1234')).toBe(true);
    expect(isJiraTicket('')).toBe(true);
    expect(isJiraTicket('  ')).toBe(true);
  });

  it('lehnt ungültige Formate ab', () => {
    expect(isJiraTicket('tng-1234')).toBe(false);
    expect(isJiraTicket('TNG1234')).toBe(false);
    expect(isJiraTicket('T-12')).toBe(false);
  });
});

describe('normalizeJiraTicket', () => {
  it('trimmt und schreibt groß', () => {
    expect(normalizeJiraTicket('  tng-7 ')).toBe('TNG-7');
  });
});

describe('findDuplicateCustomer', () => {
  it('findet abweichenden Namen zur gleichen Kundennummer', () => {
    const contracts = [makeContract({ customerNumber: '500', customerName: 'Max Mustermann' })];
    expect(findDuplicateCustomer('500', 'Erika Muster', contracts, [])).toBe('Max Mustermann');
  });

  it('meldet keinen Konflikt bei gleichem Namen', () => {
    const contracts = [makeContract({ customerNumber: '500', customerName: 'Max Mustermann' })];
    expect(findDuplicateCustomer('500', 'max mustermann', contracts, [])).toBeNull();
  });

  it('berücksichtigt auch Tarifwechsel', () => {
    const tariffs = [makeTariff({ customerNumber: '777', customerName: 'Alt Name' })];
    expect(findDuplicateCustomer('777', 'Neu Name', [], tariffs)).toBe('Alt Name');
  });

  it('liefert null ohne Eingabe', () => {
    expect(findDuplicateCustomer('', 'x', [], [])).toBeNull();
  });
});
