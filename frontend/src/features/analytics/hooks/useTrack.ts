import { useQuery } from '@tanstack/react-query';
import { fetchTrack } from '../api';

export function useTrack(vehicleId: string | null, from: Date, to: Date) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const isRecent = to >= startOfToday;

  return useQuery({
    queryKey: ['analytics', 'track', vehicleId, from.toISOString(), to.toISOString()],
    queryFn: () => fetchTrack(vehicleId!, from, to),
    staleTime: isRecent ? 30_000 : 5 * 60_000,
    enabled: !!vehicleId,
  });
}
