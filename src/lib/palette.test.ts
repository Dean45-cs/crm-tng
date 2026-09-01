import { describe, it, expect } from 'vitest';
import {
  normalizePalette,
  resolvePaletteColors,
  getStoredPalette,
  DEFAULT_PALETTE,
  type PaletteState,
} from './palette';

describe('normalizePalette', () => {
  it('liefert den Standard (CRM, keine Overrides) für Müll-Eingaben', () => {
    for (const bad of [null, undefined, 42, 'x', []]) {
      expect(normalizePalette(bad)).toEqual({ presetId: 'crm', overrides: {} });
    }
  });

  it('behält gültige Preset-Ids und fällt sonst auf CRM zurück', () => {
    expect(normalizePalette({ presetId: 'jira', overrides: {} }).presetId).toBe('jira');
    expect(normalizePalette({ presetId: 'custom', overrides: {} }).presetId).toBe('custom');
    expect(normalizePalette({ presetId: 'unsinn', overrides: {} }).presetId).toBe('crm');
  });

  it('verwirft unbekannte oder nicht-string Override-Rollen', () => {
    const out = normalizePalette({
      presetId: 'crm',
      overrides: { accent: '#ff0000', unsinn: '#000', border: 123, surface: '' },
    });
    expect(out.overrides).toEqual({ accent: '#ff0000' });
  });

  it('ist idempotent (Normalisieren eines normalisierten Werts ändert nichts)', () => {
    const once = normalizePalette({ presetId: 'jira', overrides: { accent: '#123456' } });
    expect(normalizePalette(once)).toEqual(once);
  });
});

describe('resolvePaletteColors', () => {
  it('gibt für den Standard alle Rollen als Hex zurück', () => {
    const colors = resolvePaletteColors(DEFAULT_PALETTE);
    expect(colors.accent).toMatch(/^#[0-9a-f]{6}$/i);
    expect(colors.textPrimary).toBeTruthy();
    expect(colors.danger).toBeTruthy();
  });

  it('CRM- und Jira-Preset unterscheiden sich in der Akzentfarbe', () => {
    const crm = resolvePaletteColors({ presetId: 'crm', overrides: {} });
    const jira = resolvePaletteColors({ presetId: 'jira', overrides: {} });
    expect(crm.accent).not.toBe(jira.accent);
  });

  it('Overrides schlagen das Preset', () => {
    const state: PaletteState = { presetId: 'crm', overrides: { accent: '#abcdef' } };
    expect(resolvePaletteColors(state).accent).toBe('#abcdef');
  });

  it('unbekannte Preset-Id fällt auf CRM zurück', () => {
    const weird = { presetId: 'custom', overrides: {} } as PaletteState;
    expect(resolvePaletteColors(weird)).toEqual(resolvePaletteColors({ presetId: 'crm', overrides: {} }));
  });
});

describe('getStoredPalette', () => {
  it('gibt ohne localStorage den Standard zurück (Node-Umgebung)', () => {
    expect(getStoredPalette()).toEqual({ presetId: 'crm', overrides: {} });
  });
});
