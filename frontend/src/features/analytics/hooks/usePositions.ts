import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { fetchPositions } from '../api';

const STALE_MS = 30_000;

export function usePositions(from: Date | null | undefined, at: Date | null | undefined, shouldPoll = false) {
  return useQuery({
    queryKey: ['analytics', 'positions', from?.toISOString(), at?.toISOString()],
    queryFn: () => fetchPositions(from!, at!),
    staleTime: STALE_MS,
    placeholderData: keepPreviousData,
    enabled: !!from && !!at && from.getTime() <= at.getTime(),
    refetchInterval: shouldPoll ? STALE_MS : false,
  });
}
