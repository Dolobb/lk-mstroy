import axios from 'axios';
import type { WeeklyVehicle, VehicleDetailRow, VehicleRequest, FilterOptions, FilterState } from '../types/vehicle';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

export async function fetchWeeklyVehicles(filters: FilterState): Promise<WeeklyVehicle[]> {
  const params = new URLSearchParams();
  params.append('from', filters.from);
  params.append('to', filters.to);
  if (filters.shift) params.append('shift', filters.shift);
  for (const b of filters.branches) params.append('branch', b);
  for (const t of filters.types) params.append('type', t);
  for (const d of filters.departments) params.append('department', d);
  for (const r of filters.kpiRanges) params.append('kpiRange', r);

  const res = await axios.get<WeeklyVehicle[]>(`${API_BASE}/api/vehicles/weekly`, { params });
  return res.data;
}

export async function fetchVehicleDetails(vehicleId: string, from: string, to: string): Promise<VehicleDetailRow[]> {
  const res = await axios.get<VehicleDetailRow[]>(
    `${API_BASE}/api/vehicles/${encodeURIComponent(vehicleId)}/details`,
    { params: { from, to } },
  );
  return res.data;
}

export async function fetchVehicleRequests(vehicleId: string, from: string, to: string): Promise<VehicleRequest[]> {
  const res = await axios.get<VehicleRequest[]>(
    `${API_BASE}/api/vehicles/${encodeURIComponent(vehicleId)}/requests`,
    { params: { from, to } },
  );
  return res.data;
}

export async function fetchFilterOptions(
  from: string,
  to: string,
  branches?: string[],
  types?: string[],
): Promise<FilterOptions> {
  const params = new URLSearchParams();
  params.append('from', from);
  params.append('to', to);
  if (branches) {
    for (const b of branches) params.append('branch', b);
  }
  if (types) {
    for (const t of types) params.append('type', t);
  }

  const res = await axios.get<FilterOptions>(`${API_BASE}/api/filters`, { params });
  return res.data;
}
