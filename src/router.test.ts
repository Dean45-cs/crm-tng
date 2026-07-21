import { describe, it, expect } from 'vitest';
import { routeFromSearch } from './router';

describe('routeFromSearch', () => {
  it('ohne Parameter: Dashboard wie bisher', () => {
    expect(routeFromSearch('')).toEqual({ name: 'dashboard' });
  });

  it('mit ?kdnr=... springt direkt zur Kundenakte', () => {
    expect(routeFromSearch('?kdnr=12345')).toEqual({ name: 'customer', kdnr: '12345' });
  });

  it('URL-kodierte Kundennummern werden korrekt dekodiert', () => {
    expect(routeFromSearch('?kdnr=12%2F345')).toEqual({ name: 'customer', kdnr: '12/345' });
  });

  it('andere Query-Parameter ohne kdnr ändern nichts', () => {
    expect(routeFromSearch('?utm_source=extension')).toEqual({ name: 'dashboard' });
  });
});
