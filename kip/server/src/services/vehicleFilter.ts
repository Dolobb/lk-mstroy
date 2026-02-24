import type { TisRouteListVehicle } from '../types/tis-api';
import { isRegistered, getVehicleInfo } from './vehicleRegistry';

export function matchesVehicleType(regNumber: string): boolean {
  return isRegistered(regNumber);
}

export function filterVehicles(vehicles: TisRouteListVehicle[]): TisRouteListVehicle[] {
  return vehicles.filter(v => isRegistered(v.regNumber));
}

/**
 * Match fuel rate norm from vehicle registry by reg number.
 * Falls back to 0 if not found.
 */
export function matchFuelNorm(regNumber: string): number {
  const info = getVehicleInfo(regNumber);
  return info ? info.fuelNorm : 0;
}
