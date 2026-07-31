import type { Automobile } from '../models/automobile.model';

export function buildAutomobile(overrides: Partial<Automobile> = {}): Automobile {
  return {
    symboling: 0,
    normalizedLosses: 100,
    make: 'toyota',
    fuelType: 'gas',
    aspiration: 'std',
    numOfDoors: 4,
    bodyStyle: 'sedan',
    driveWheels: 'fwd',
    engineLocation: 'front',
    wheelBase: 95,
    length: 170,
    width: 65,
    height: 55,
    curbWeight: 2200,
    engineType: 'ohc',
    numOfCylinders: 4,
    engineSize: 120,
    fuelSystem: 'mpfi',
    bore: 3.2,
    stroke: 3.1,
    compressionRatio: 9.5,
    horsepower: 100,
    peakRpm: 5000,
    cityMpg: 25,
    highwayMpg: 30,
    price: 15000,
    ...overrides,
  };
}
