import type { TisRouteList } from '../types/tis-api';
import type { VehicleTask } from '../types/domain';
import { splitIntoShifts } from './shiftSplitter';
import { filterVehicles } from './vehicleFilter';
import { parseDdMmYyyyHhmm } from '../utils/dateFormat';

/**
 * Extract request number from orderDescr field.
 * Tries patterns like "заявка №123", "заявке 456", "#789", then fallback to any 3+ digit number.
 */
const REQUEST_NUMBER_REGEX = /(?:заявк[аеиу]\s*(?:№|#|N)?\s*(\d+))|(?:(?:№|#)\s*(\d+))/i;

export function extractRequestNumber(orderDescr: string | null | undefined): number | null {
  if (!orderDescr) return null;
  const match = orderDescr.match(REQUEST_NUMBER_REGEX);
  if (match) {
    const num = match[1] || match[2];
    return num ? parseInt(num, 10) : null;
  }
  // Fallback: find any standalone 3+ digit number
  const numMatch = orderDescr.match(/(\d{3,})/);
  return numMatch ? parseInt(numMatch[1], 10) : null;
}

/**
 * Build VehicleTask[] from route lists:
 *   - Filter vehicles by keywords
 *   - Split PL period into shifts
 *   - Create task per vehicle × shift
 */
export function buildVehicleTasks(routeLists: TisRouteList[]): VehicleTask[] {
  const tasks: VehicleTask[] = [];

  for (const pl of routeLists) {
    const dateOutPlan = parseDdMmYyyyHhmm(pl.dateOutPlan);
    const dateInPlan = parseDdMmYyyyHhmm(pl.dateInPlan);

    if (!dateOutPlan || !dateInPlan) continue;

    const shifts = splitIntoShifts(dateOutPlan, dateInPlan);
    if (shifts.length === 0) continue;

    const vehicles = filterVehicles(pl.ts);
    if (vehicles.length === 0) continue;

    // Extract request numbers from calcs
    const requestNumbers: number[] = [];
    for (const calc of pl.calcs) {
      const num = extractRequestNumber(calc.orderDescr);
      if (num !== null) requestNumbers.push(num);
    }

    // Create a task for each vehicle × shift
    for (const vehicle of vehicles) {
      for (const shift of shifts) {
        tasks.push({
          idMO: vehicle.idMO,
          regNumber: vehicle.regNumber,
          nameMO: vehicle.nameMO,
          category: vehicle.category,
          garageNumber: vehicle.garageNumber,
          plId: pl.id,
          companyName: pl.tsType || '',
          shift,
          requestNumbers,
        });
      }
    }
  }

  return tasks;
}

/**
 * Interleave tasks by idMO in round-robin fashion.
 * Ensures consecutive API calls target different vehicles,
 * maximizing the benefit of per-vehicle rate limiting.
 *
 * Example: tasks for idMO [A, A, B, B, C] → [A, B, C, A, B]
 */
export function interleaveTasks(tasks: VehicleTask[]): VehicleTask[] {
  const groups = new Map<number, VehicleTask[]>();
  for (const task of tasks) {
    const arr = groups.get(task.idMO) || [];
    arr.push(task);
    groups.set(task.idMO, arr);
  }

  const queues = Array.from(groups.values());
  const result: VehicleTask[] = [];

  let hasMore = true;
  while (hasMore) {
    hasMore = false;
    for (const queue of queues) {
      if (queue.length > 0) {
        result.push(queue.shift()!);
        if (queue.length > 0) hasMore = true;
      }
    }
  }

  return result;
}
