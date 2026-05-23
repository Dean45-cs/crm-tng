import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  formatCurrency,
  parseLocalDate,
  calcContractCommission,
  calcTariffCommission,
  contractEndDate,
  expiryBucket,
  monthKey,
  isSameMonth,
  isSameWeek,
  followUpBucket,
} from './utils';
import type { Contract, Settings } from '../types';

const settings: Settings = {
  products: [
    { name: 'Fibrefamily', category: 'Privat', commission: 10 },
    { name: 'Fibrepro', category: 'Privat', commission: 15 },
    { name: 'Waipu TV', category: 'Zusatz', commission: 10 },
  ],
  tariffCommission: {
    sidegrade: { mvlz_gt3: 0, mvlz_lt3: 5, outside_mvlz: 5 },
    upgrade: { mvlz_gt3: 5, mvlz_lt3: 7.5, outside_mvlz: 7.5 },
  },
  monthlyTarget: 500,
  spClientId: '',
  spTenantId: '',
  spFilePath: '',
  spSheetName: 'Tabelle1',
};

const contract = (over: Partial<Contract> = {}): Contract => ({
  id: 'c1',
  customerNumber: '1000',
  customerName: 'Test',
  products: ['Fibrefamily'],
  contractDate: '2025-06-10',
  status: 'aktiv',
  jiraTicket: '',
  createdAt: '2025-06-10T00:00:00.000Z',
  ...over,
});

afterEach(() => {
  vi.useRealTimers();
});

describe('formatCurrency', () => {
  it('zeigt Betrag mit Euro-Zeichen', () => {
    const s = formatCurrency(10);
    expect(s).toContain('10');
    expect(s).toMatch(/€|EUR/);
  });
});

describe('parseLocalDate', () => {
  it('liest reine Datumsstrings als lokale Mitternacht', () => {
    const d = parseLocalDate('2025-03-01');
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(2); // März (0-basiert)
    expect(d.getDate()).toBe(1);
  });
});

describe('calcContractCommission', () => {
  it('summiert die Provision aller Produkte', () => {
    expect(calcContractCommission(contract({ products: ['Fibrefamily', 'Waipu TV'] }), settings)).toBe(20);
  });
  it('liefert 0 für stornierte Verträge', () => {
    expect(calcContractCommission(contract({ status: 'storniert', products: ['Fibrepro'] }), settings)).toBe(0);
  });
  it('ignoriert unbekannte Produkte (Provision 0)', () => {
    expect(
      calcContractCommission(contract({ products: ['Surf100' as Contract['products'][number]] }), settings),
    ).toBe(0);
  });
});

describe('calcTariffCommission', () => {
  it('liest den Wert aus der Matrix nach Art und Kontext', () => {
    expect(calcTariffCommission({ changeType: 'upgrade', context: 'mvlz_lt3' } as never, settings)).toBe(7.5);
    expect(calcTariffCommission({ changeType: 'sidegrade', context: 'mvlz_gt3' } as never, settings)).toBe(0);
  });
});

describe('contractEndDate', () => {
  it('addiert die Laufzeit und begrenzt auf den letzten Tag des Monats', () => {
    // 29.02. (Schaltjahr) + 12 Monate -> 28.02. des Folgejahres
    const end = contractEndDate(contract({ contractDate: '2024-02-29', laufzeitMonate: 12 }));
    expect(end).not.toBeNull();
    expect(end!.getFullYear()).toBe(2025);
    expect(end!.getMonth()).toBe(1); // Februar
    expect(end!.getDate()).toBe(28);
  });
  it('liefert null für unbefristete Verträge', () => {
    expect(contractEndDate(contract({ laufzeitMonate: null }))).toBeNull();
  });
});

describe('expiryBucket', () => {
  it('kategorisiert nach verbleibenden Tagen', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 5, 11)); // 11.06.2025
    // Ende in ~10 Tagen -> "soon"
    expect(expiryBucket(contract({ contractDate: '2024-06-21', laufzeitMonate: 12 }))).toBe('soon');
    // Ende weit in der Zukunft -> null
    expect(expiryBucket(contract({ contractDate: '2025-06-01', laufzeitMonate: 24 }))).toBeNull();
    // Unbefristet -> null
    expect(expiryBucket(contract({ laufzeitMonate: null }))).toBeNull();
  });
});

describe('monthKey', () => {
  it('formatiert YYYY-MM', () => {
    expect(monthKey('2025-06-10')).toBe('2025-06');
  });
});

describe('isSameMonth / isSameWeek', () => {
  it('vergleicht Monate relativ zur Referenz', () => {
    const ref = new Date(2025, 5, 1); // Juni 2025
    expect(isSameMonth('2025-06-30', ref)).toBe(true);
    expect(isSameMonth('2025-07-01', ref)).toBe(false);
  });
  it('vergleicht Montags-Wochen relativ zur Referenz', () => {
    const ref = new Date(2025, 5, 11); // Mittwoch
    expect(isSameWeek('2025-06-09', ref)).toBe(true); // Montag derselben Woche
    expect(isSameWeek('2025-06-16', ref)).toBe(false); // nächster Montag
  });
});

describe('followUpBucket', () => {
  it('ordnet relativ zu heute ein', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 5, 11));
    expect(followUpBucket('2025-06-11')).toBe('today');
    expect(followUpBucket('2025-06-01')).toBe('overdue');
    expect(followUpBucket('2025-06-13')).toBe('thisWeek');
    expect(followUpBucket('2025-07-15')).toBe('later');
    expect(followUpBucket(undefined)).toBeNull();
  });
});
