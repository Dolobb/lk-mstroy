import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { WeeklyVehicle, VehicleDetailRow, VehicleRequest, FilterOptions, FilterState } from './types/vehicle';
import { fetchWeeklyVehicles, fetchVehicleDetails, fetchVehicleRequests, fetchFilterOptions } from './services/api';
import TopNavBar from './components/TopNavBar';
import FilterPanel from './components/FilterPanel';
import VehicleMap from './components/VehicleMap';
import DetailPanel from './components/DetailPanel';
import VehicleDetailTable from './components/VehicleDetailTable';
import { Dashboard } from './components/dashboard/dashboard';

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultFilters(): FilterState {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 7);
  return {
    from: formatDate(from),
    to: formatDate(to),
    shift: null,
    branches: [],
    types: [],
    departments: [],
    kpiRanges: [],
  };
}

const App: React.FC = () => {
  const isEmbedded = window !== window.parent;
  const [activeNav, setActiveNav] = useState(isEmbedded ? 'dst' : 'home');
  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [vehicles, setVehicles] = useState<WeeklyVehicle[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({ branches: [], types: [], departments: [] });

  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [vehicleDetails, setVehicleDetails] = useState<VehicleDetailRow[]>([]);
  const [vehicleRequests, setVehicleRequests] = useState<VehicleRequest[]>([]);

  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const avgKip = useMemo(() => {
    if (vehicles.length === 0) return 0;
    const sum = vehicles.reduce((acc, v) => acc + (v.avg_utilization_ratio ?? 0), 0);
    return sum / vehicles.length;
  }, [vehicles]);

  useEffect(() => {
    if (activeNav !== 'dst') return;
    let cancelled = false;
    setLoading(true);

    Promise.all([
      fetchWeeklyVehicles(filters),
      fetchFilterOptions(
        filters.from,
        filters.to,
        filters.branches.length > 0 ? filters.branches : undefined,
        filters.types.length > 0 ? filters.types : undefined,
      ),
    ])
      .then(([v, opts]) => {
        if (cancelled) return;
        setVehicles(v);
        setFilterOptions(opts);
      })
      .catch(() => {
        if (cancelled) return;
        setVehicles([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [filters, activeNav]);

  useEffect(() => {
    if (!selectedVehicleId) {
      setVehicleDetails([]);
      setVehicleRequests([]);
      return;
    }

    let cancelled = false;
    const f = filtersRef.current;

    Promise.all([
      fetchVehicleDetails(selectedVehicleId, f.from, f.to),
      fetchVehicleRequests(selectedVehicleId, f.from, f.to),
    ])
      .then(([details, requests]) => {
        if (cancelled) return;
        setVehicleDetails(details);
        setVehicleRequests(requests);
      })
      .catch(() => {
        if (cancelled) return;
        setVehicleDetails([]);
        setVehicleRequests([]);
      });

    return () => { cancelled = true; };
  }, [selectedVehicleId, filters.from, filters.to]);

  const handleFilterChange = useCallback((patch: Partial<FilterState>) => {
    setFilters(prev => {
      const next = { ...prev, ...patch };
      if ('branches' in patch) {
        next.departments = [];
      }
      return next;
    });
  }, []);

  const handleSelectVehicle = useCallback((id: string | null) => {
    setSelectedVehicleId(id);
  }, []);

  const selectedVehicle = selectedVehicleId
    ? vehicles.find(v => v.vehicle_id === selectedVehicleId) ?? null
    : null;

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-gradient-to-b from-background via-[var(--background-gradient-mid)] to-[var(--background-gradient-end)]">
      {/* Top navigation — скрываем в iframe */}
      {!isEmbedded && (
        <div className="px-3 pt-3 shrink-0">
          <TopNavBar activeNav={activeNav} onNavChange={setActiveNav} />
        </div>
      )}

      {/* Dashboard page */}
      {activeNav === 'home' && <Dashboard />}

      {/* Placeholder pages */}
      {(activeNav === 'dump' || activeNav === 'tractors') && (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Раздел в разработке
        </div>
      )}

      {/* KIP / ДСТ page */}
      {activeNav === 'dst' && (
        <>
          {/* Filter bar */}
          <div className="px-3 pt-2">
            <FilterPanel
              filters={filters}
              options={filterOptions}
              loading={loading}
              onChange={handleFilterChange}
              avgKip={avgKip}
              vehicles={vehicles}
              onSelectVehicle={handleSelectVehicle}
            />
          </div>

          {/* Main content: Map (65%) + Right panel (35%) */}
          <div
            className="flex-1 grid gap-3 p-3 min-h-0"
            style={{
              gridTemplateColumns: selectedVehicle ? '65fr 35fr' : '1fr',
            }}
          >
            {/* Map area */}
            <div className="min-h-0 rounded-2xl overflow-hidden">
              <VehicleMap
                vehicles={vehicles}
                selectedVehicleId={selectedVehicleId}
                selectedDetails={vehicleDetails}
                onSelectVehicle={handleSelectVehicle}
              />
            </div>

            {/* Right panel: Info (60%) + Table (40%) */}
            {selectedVehicle && (
              <div className="flex flex-col gap-3 min-h-0">
                <div className="min-h-0" style={{ flex: '60 1 0%' }}>
                  <DetailPanel
                    vehicle={selectedVehicle}
                    requests={vehicleRequests}
                    onClose={() => setSelectedVehicleId(null)}
                  />
                </div>
                <div className="min-h-0" style={{ flex: '40 1 0%' }}>
                  <VehicleDetailTable details={vehicleDetails} />
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default App;
