import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Wifi, WifiOff, Clock } from 'lucide-react';

interface DataFreshnessBadgeProps {
  className?: string;
}

export const DataFreshnessBadge: React.FC<DataFreshnessBadgeProps> = ({ className = '' }) => {
  const queryClient = useQueryClient();
  const [lastFetchAt, setLastFetchAt] = useState<number | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [ageSeconds, setAgeSeconds] = useState(0);

  useEffect(() => {
    const onSuccess = () => {
      const now = Date.now();
      setLastFetchAt(now);
      setIsOffline(false);
      setAgeSeconds(0);
    };

    const onError = (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes('fetch') ||
        msg.includes('network') ||
        msg.includes('ECONNREFUSED') ||
        msg.includes('Failed to fetch') ||
        msg.includes('NetworkError')
      ) {
        setIsOffline(true);
      }
    };

    const unsub = queryClient.getQueryCache().subscribe((event) => {
      if (event?.type === 'updated' && event.action?.type === 'success') {
        onSuccess();
      }
      if (event?.type === 'updated' && event.action?.type === 'error') {
        onError(event.action.error);
      }
    });

    return () => unsub();
  }, [queryClient]);

  useEffect(() => {
    if (lastFetchAt === null) return;
    const interval = setInterval(() => {
      setAgeSeconds(Math.floor((Date.now() - lastFetchAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [lastFetchAt]);

  const formatAge = (sec: number): string => {
    if (sec < 60) return `${sec} сек назад`;
    if (sec < 3600) return `${Math.floor(sec / 60)} мин назад`;
    return `${Math.floor(sec / 3600)} ч назад`;
  };

  if (isOffline) {
    return (
      <div
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 ${className}`}
        title={lastFetchAt ? `Последние данные: ${new Date(lastFetchAt).toLocaleString('ru-RU')}` : 'Нет связи с сервером'}
      >
        <WifiOff className="size-3" />
        <span>
          {lastFetchAt
            ? `Нет связи · последние данные ${new Date(lastFetchAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
            : 'Нет связи'}
        </span>
      </div>
    );
  }

  if (lastFetchAt === null) return null;

  return (
    <div
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20 ${className}`}
      title={`Обновлено: ${new Date(lastFetchAt).toLocaleString('ru-RU')}`}
    >
      <Wifi className="size-3" />
      <span>Обновлено {formatAge(ageSeconds)}</span>
      <Clock className="size-3 opacity-60" />
    </div>
  );
};

export default DataFreshnessBadge;
