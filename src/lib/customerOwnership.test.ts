import { describe, it, expect } from 'vitest';
import { getEffectiveOwnership, canEditCustomer } from './customerOwnership';
import { makeContract, makeTariff } from '../test/fixtures';
import type { Note, CustomerOwnership } from '../types';

const makeNote = (over: Partial<Note> = {}): Note => ({
  id: `n-${Math.random().toString(36).slice(2, 8)}`,
  title: 'Notiz',
  content: 'Inhalt',
  createdAt: '2024-06-15T10:00:00.000Z',
  updatedAt: '2024-06-15T10:00:00.000Z',
  createdBy: 'agent-1',
  ...over,
});

describe('getEffectiveOwnership', () => {
  it('bevorzugt den explizit gesetzten Owner', () => {
    const ownerships: Record<string, CustomerOwnership> = {
      '1000': { owner: 'chef', sharedWith: ['agent-2'] },
    };
    const contracts = [makeContract({ customerNumber: '1000', createdBy: 'agent-1' })];
    const eff = getEffectiveOwnership('1000', ownerships, contracts, [], []);
    expect(eff).toEqual({ owner: 'chef', sharedWith: ['agent-2'], isImplicit: false });
  });

  it('leitet den Owner aus dem ältesten Vorgang ab', () => {
    const contracts = [
      makeContract({ customerNumber: '1000', createdBy: 'later', createdAt: '2024-06-02T00:00:00Z' }),
    ];
    const tariffs = [
      makeTariff({ customerNumber: '1000', createdBy: 'earlier', createdAt: '2024-06-01T00:00:00Z' }),
    ];
    const eff = getEffectiveOwnership('1000', {}, contracts, tariffs, []);
    expect(eff.owner).toBe('earlier');
    expect(eff.isImplicit).toBe(true);
  });

  it('zählt auch Notiz-Ersteller als implizite Owner', () => {
    const notes = [makeNote({ customerNumber: '1000', createdBy: 'note-author' })];
    const eff = getEffectiveOwnership('1000', {}, [], [], notes);
    expect(eff.owner).toBe('note-author');
    expect(eff.isImplicit).toBe(true);
  });

  it('liefert null für Kunden ohne zuordenbaren Vorgang', () => {
    const contracts = [makeContract({ customerNumber: '1000', createdBy: undefined })];
    const eff = getEffectiveOwnership('1000', {}, contracts, [], []);
    expect(eff.owner).toBeNull();
  });
});

describe('canEditCustomer', () => {
  const ownerships: Record<string, CustomerOwnership> = {
    '1000': { owner: 'agent-1', sharedWith: ['agent-2'] },
  };

  it('erlaubt Owner, geteilte Nutzer und Manager', () => {
    expect(canEditCustomer('1000', 'agent-1', false, ownerships, [], [], [])).toBe(true);
    expect(canEditCustomer('1000', 'agent-2', false, ownerships, [], [], [])).toBe(true);
    expect(canEditCustomer('1000', 'agent-3', true, ownerships, [], [], [])).toBe(true);
  });

  it('verbietet fremde Nutzer ohne Freigabe', () => {
    expect(canEditCustomer('1000', 'agent-3', false, ownerships, [], [], [])).toBe(false);
  });

  it('verwaiste Kunden sind für alle bearbeitbar', () => {
    expect(canEditCustomer('9999', 'agent-3', false, {}, [], [], [])).toBe(true);
  });

  it('Kunden mit nur einer Notiz gehören dem Notiz-Ersteller', () => {
    const notes = [makeNote({ customerNumber: '2000', createdBy: 'agent-1' })];
    expect(canEditCustomer('2000', 'agent-1', false, {}, [], [], notes)).toBe(true);
    expect(canEditCustomer('2000', 'agent-3', false, {}, [], [], notes)).toBe(false);
  });
});
