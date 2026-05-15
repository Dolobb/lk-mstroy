import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { fetchPositions } from '../api';

const STALE_MS = 30_000;

export function usePositions(at: Date | null | undefined, shouldPoll = false) {
  return useQuery({
    queryKey: ['analytics', 'positions', at?.toISOString()],
    queryFn: () => fetchPositions(at!),
    staleTime: STALE_MS,
    placeholderData: keepPreviousData,
    enabled: !!at,
    refetchInterval: shouldPoll ? STALE_MS : false,
  });
}
