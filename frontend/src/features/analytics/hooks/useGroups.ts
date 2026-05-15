import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { fetchGroups, fetchBigObjects } from '../api';

const STALE_MS = 60_000;

export function useGroups(from: string, to: string) {
  return useQuery({
    queryKey: ['analytics', 'groups', from, to],
    queryFn: () => fetchGroups(from, to),
    staleTime: STALE_MS,
    placeholderData: keepPreviousData,
    enabled: !!from && !!to,
  });
}

export function useBigObjects() {
  return useQuery({
    queryKey: ['analytics', 'big-objects'],
    queryFn: () => fetchBigObjects(),
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
}
