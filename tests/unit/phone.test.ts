import { describe, it, expect } from 'vitest';
import { normalizeGhanaPhone } from '../../lib/phone';

describe('normalizeGhanaPhone', () => {
  it('accepts local 0-prefixed numbers', () => {
    expect(normalizeGhanaPhone('0244123456')).toBe('+233244123456');
  });
  it('accepts 233-prefixed numbers', () => {
    expect(normalizeGhanaPhone('233244123456')).toBe('+233244123456');
    expect(normalizeGhanaPhone('+233244123456')).toBe('+233244123456');
    expect(normalizeGhanaPhone('00233244123456')).toBe('+233244123456');
  });
  it('accepts bare 9-digit subscriber numbers', () => {
    expect(normalizeGhanaPhone('244123456')).toBe('+233244123456');
  });
  it('tolerates spaces and dashes', () => {
    expect(normalizeGhanaPhone('0244 123 456')).toBe('+233244123456');
    expect(normalizeGhanaPhone('024-412-3456')).toBe('+233244123456');
  });
  it('rejects bad lengths and country codes', () => {
    expect(normalizeGhanaPhone('02441234')).toBeNull();
    expect(normalizeGhanaPhone('+14155551234')).toBeNull();
    expect(normalizeGhanaPhone('12345')).toBeNull();
    expect(normalizeGhanaPhone('')).toBeNull();
  });
});
