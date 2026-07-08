import { describe, it, expect } from 'vitest';
import {
  calcContractCommission,
  calcTariffCommission,
  getProductCommission,
  isSameMonth,
  isSameWeek,
  monthKey,
  parseLocalDate,
  contractEndDate,
  daysUntil,
  buildContractJiraDoc,
  formatCurrency,
} from './utils';
import { testSettings, makeContract, makeTariff } from '../test/fixtures';

describe('calcContractCommission', () => {
  it('summiert die Provision aller Produkte', () => {
    const c = makeContract({ products: ['Fibrefamily', 'Waipu TV'] });
    expect(calcContractCommission(c, testSettings)).toBe(60);
  });

  it('zählt stornierte Verträge mit 0', () => {
    const c = makeContract({ products: ['Fibrepro'], status: 'storniert' });
    expect(calcContractCommission(c, testSettings)).toBe(0);
  });

  it('ignoriert unbekannte Produkte (Provision 0)', () => {
    const c = makeContract({ products: ['Fibrefamily', 'Surf100'] });
    expect(calcContractCommission(c, testSettings)).toBe(50);
  });
});

describe('calcTariffCommission', () => {
  it('liest den Satz aus der Matrix', () => {
    expect(
      calcTariffCommission(makeTariff({ changeType: 'upgrade', context: 'mvlz_gt3' }), testSettings),
    ).toBe(30);
    expect(
      calcTariffCommission(makeTariff({ changeType: 'sidegrade', context: 'outside_mvlz' }), testSettings),
    ).toBe(5);
  });
});

describe('getProductCommission', () => {
  it('liefert 0 für unbekannte Produkte', () => {
    expect(getProductCommission(testSettings, 'Smart300')).toBe(0);
    expect(getProductCommission(testSettings, 'Fibrepro')).toBe(80);
  });
});

describe('parseLocalDate', () => {
  it('interpretiert YYYY-MM-DD als lokale Mitternacht (kein UTC-Versatz)', () => {
    const d = parseLocalDate('2024-03-01');
    expect(d.getFullYear()).toBe(2024);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(1);
  });
});

describe('isSameMonth / isSameWeek', () => {
  const ref = new Date(2024, 5, 15); // Sa, 15. Juni 2024
  it('isSameMonth vergleicht Jahr + Monat', () => {
    expect(isSameMonth('2024-06-01', ref)).toBe(true);
    expect(isSameMonth('2024-07-01', ref)).toBe(false);
    expect(isSameMonth('2023-06-15', ref)).toBe(false);
  });

  it('isSameWeek nutzt die Montags-Woche', () => {
    // Woche um Sa 15.06.2024 → Mo 10.06. bis So 16.06.
    expect(isSameWeek('2024-06-10', ref)).toBe(true);
    expect(isSameWeek('2024-06-16', ref)).toBe(true);
    expect(isSameWeek('2024-06-09', ref)).toBe(false);
    expect(isSameWeek('2024-06-17', ref)).toBe(false);
  });
});

describe('monthKey', () => {
  it('formatiert als YYYY-MM', () => {
    expect(monthKey('2024-03-09')).toBe('2024-03');
    expect(monthKey('2024-12-31')).toBe('2024-12');
  });
});

describe('contractEndDate', () => {
  it('addiert die Laufzeit in Monaten', () => {
    const end = contractEndDate(makeContract({ contractDate: '2024-01-15', laufzeitMonate: 12 }));
    expect(end).not.toBeNull();
    expect(end!.getFullYear()).toBe(2025);
    expect(end!.getMonth()).toBe(0);
    expect(end!.getDate()).toBe(15);
  });

  it('begrenzt den Tag am Monatsende (29.02. + 12 → 28.02.)', () => {
    const end = contractEndDate(makeContract({ contractDate: '2024-02-29', laufzeitMonate: 12 }));
    expect(end!.getMonth()).toBe(1);
    expect(end!.getDate()).toBe(28);
  });

  it('liefert null für unbefristete Verträge', () => {
    expect(contractEndDate(makeContract({ laufzeitMonate: null }))).toBeNull();
  });
});

describe('buildContractJiraDoc', () => {
  it('baut die Kern-Dokumentation aus Kunde, Produkten und Provision', () => {
    const doc = buildContractJiraDoc(
      makeContract({ products: ['Fibrefamily', 'Waipu TV'], contractDate: '2024-06-15' }),
      testSettings,
    );
    expect(doc).toContain('Kunde: Test Kunde (KdNr. 1000)');
    expect(doc).toContain('Datum: 15.06.2024');
    expect(doc).toContain(`- Fibrefamily (${formatCurrency(50)})`);
    expect(doc).toContain(`- Waipu TV (${formatCurrency(10)})`);
    expect(doc).toContain(`Provision gesamt: ${formatCurrency(60)}`);
    expect(doc).toContain('Laufzeit: Unbefristet');
    expect(doc).toContain('Status: Aktiv');
  });

  it('ergänzt Laufzeitende, Wiedervorlage, Jira-Ticket und Notiz, wenn vorhanden', () => {
    const doc = buildContractJiraDoc(
      makeContract({
        contractDate: '2024-06-15',
        laufzeitMonate: 12,
        followUpDate: '2024-07-01',
        jiraTicket: 'TNG-1234',
        notes: 'Sonderkonditionen vereinbart',
      }),
      testSettings,
    );
    expect(doc).toContain('Laufzeit: 12 Monate (Ende: 15.06.2025)');
    expect(doc).toContain('Wiedervorlage: 01.07.2024');
    expect(doc).toContain('Jira: TNG-1234');
    expect(doc).toContain('Notiz: Sonderkonditionen vereinbart');
  });

  it('zeigt 0 € Gesamtprovision bei stornierten Verträgen', () => {
    const doc = buildContractJiraDoc(makeContract({ status: 'storniert' }), testSettings);
    expect(doc).toContain('Status: Storniert');
    expect(doc).toContain(`Provision gesamt: ${formatCurrency(0)}`);
  });
});

describe('daysUntil', () => {
  it('zählt Tage bis zu einem künftigen Datum', () => {
    const d = new Date();
    d.setDate(d.getDate() + 10);
    expect(daysUntil(d)).toBe(10);
  });

  it('liefert negative Werte für vergangene Daten', () => {
    const d = new Date();
    d.setDate(d.getDate() - 3);
    expect(daysUntil(d)).toBe(-3);
  });
});
