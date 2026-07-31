import type { Automobile } from '../models/automobile.model';

export function buildAutomobile(overrides: Partial<Automobile> = {}): Automobile {
  return {
    name: 'chevrolet chevelle malibu',
    mpg: 18,
    cylinders: 8,
    displacement: 307,
    horsepower: 130,
    weight: 3504,
    acceleration: 12,
    modelYear: 1970,
    origin: 'usa',
    ...overrides,
  };
}
