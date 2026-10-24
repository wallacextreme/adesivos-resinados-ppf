import { describe, expect, test } from 'bun:test';
import {
  convertPressureToKpa,
  isYearMatchingApplication,
  parseVehicleYearRange,
} from '../src/domain/units-and-years';

describe('Units and Years — Conversão de Pressão (Bar/PSI/kPa) e Intervalos de Anos', () => {
  test('convertPressureToKpa converte Bar, PSI e kPa de forma determinística', () => {
    expect(convertPressureToKpa('1.4 Bar')).toBe(140);
    expect(convertPressureToKpa('1,2 bar')).toBe(120);
    expect(convertPressureToKpa('140 kPa')).toBe(140);
    expect(convertPressureToKpa('20 PSI')).toBe(138);
    expect(convertPressureToKpa(1.5, 'BAR')).toBe(150);
  });

  test('parseVehicleYearRange interpreta intervalos fechados, abertos e anos únicos', () => {
    expect(parseVehicleYearRange('Gol 97/99')).toEqual({
      yearStart: 1997,
      yearEnd: 1999,
      isOngoing: false,
    });
    expect(parseVehicleYearRange('Corolla 08/...')).toEqual({
      yearStart: 2008,
      yearEnd: null,
      isOngoing: true,
    });
    expect(parseVehicleYearRange('Linha Citroen /12')).toEqual({
      yearStart: null,
      yearEnd: 2012,
      isOngoing: false,
    });
    expect(parseVehicleYearRange('Linha Citroen 13/')).toEqual({
      yearStart: 2013,
      yearEnd: null,
      isOngoing: true,
    });
    expect(parseVehicleYearRange('Onix >12')).toEqual({
      yearStart: 2012,
      yearEnd: null,
      isOngoing: true,
    });
    expect(parseVehicleYearRange('Opala .../92')).toEqual({
      yearStart: null,
      yearEnd: 1992,
      isOngoing: false,
    });
    expect(parseVehicleYearRange('BMW 320 2025')).toEqual({
      yearStart: 2025,
      yearEnd: 2025,
      isOngoing: false,
    });
  });

  test('isYearMatchingApplication valida compatibilidade exata do ano consultado', () => {
    const r97_99 = parseVehicleYearRange('97/99');
    expect(isYearMatchingApplication(1998, r97_99)).toBe(true);
    expect(isYearMatchingApplication(2001, r97_99)).toBe(false);

    const r13_on = parseVehicleYearRange('13/');
    expect(isYearMatchingApplication(2020, r13_on)).toBe(true);
    expect(isYearMatchingApplication(2010, r13_on)).toBe(false);

    const r_until_12 = parseVehicleYearRange('/12');
    expect(isYearMatchingApplication(2009, r_until_12)).toBe(true);
    expect(isYearMatchingApplication(2015, r_until_12)).toBe(false);
  });
});
