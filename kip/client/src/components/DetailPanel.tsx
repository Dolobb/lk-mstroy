import React, { useState, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import type { VehicleRequest, WeeklyVehicle } from '../types/vehicle';

interface Props {
  vehicle: WeeklyVehicle | null;
  requests: VehicleRequest[];
  onClose: () => void;
}

function InfoRow({
  label,
  value,
  children,
  isLast = false,
}: {
  label: string;
  value?: string;
  children?: React.ReactNode;
  isLast?: boolean;
}) {
  return (
    <div className={`flex ${!isLast ? 'border-b border-border' : ''}`}>
      <div className="px-3 py-2 text-muted-foreground font-medium w-28 shrink-0" style={{ fontSize: '11px' }}>
        {label}
      </div>
      <div className="px-3 py-2 text-foreground flex-1 leading-snug" style={{ fontSize: '12px' }}>
        {children ?? (value || '—')}
      </div>
    </div>
  );
}

const DetailPanel: React.FC<Props> = ({ vehicle, requests, onClose }) => {
  const [requestIdx, setRequestIdx] = useState(0);

  useEffect(() => {
    setRequestIdx(0);
  }, [requests]);

  if (!vehicle) {
    return (
      <div className="glass-card flex items-center justify-center h-full text-muted-foreground p-4 text-center text-sm">
        Выберите ТС на карте
      </div>
    );
  }

  const totalRequests = requests.length;
  const currentRequest: VehicleRequest | null = totalRequests > 0 ? (requests[requestIdx] ?? null) : null;

  return (
    <div className="glass-card flex flex-col overflow-hidden h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2 shrink-0">
        <h2 className="text-sm font-bold text-foreground">Информация о ТС</h2>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground size-7 flex items-center justify-center rounded-md transition-colors cursor-pointer bg-transparent border-none"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* Info rows — scrollable */}
      <div className="flex-1 overflow-y-auto min-h-0 px-4 pb-3">
        <div className="border border-border rounded-lg overflow-hidden" style={{ fontSize: '12px' }}>
          <InfoRow label="Тип ТС" value={vehicle.vehicle_type} />
          <InfoRow label="Марка" value={vehicle.vehicle_model} />
          <InfoRow label="Гос. №">
            <span className="text-accent font-bold">{vehicle.vehicle_id}</span>
          </InfoRow>

          {/* Request navigator */}
          <InfoRow label={`№ Заявки (${totalRequests})`}>
            {totalRequests === 0 ? (
              <span className="text-muted-foreground">Без заявки</span>
            ) : (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setRequestIdx(prev => Math.max(0, prev - 1))}
                  disabled={requestIdx === 0}
                  className="size-6 flex items-center justify-center border border-border bg-secondary text-foreground hover:bg-muted rounded-md disabled:opacity-30 cursor-pointer"
                >
                  <ChevronLeft className="size-3" />
                </button>
                <span className="text-foreground font-bold text-sm min-w-[50px] text-center">
                  {currentRequest?.number ?? '—'}
                </span>
                <button
                  onClick={() => setRequestIdx(prev => Math.min(totalRequests - 1, prev + 1))}
                  disabled={requestIdx >= totalRequests - 1}
                  className="size-6 flex items-center justify-center border border-border bg-secondary text-foreground hover:bg-muted rounded-md disabled:opacity-30 cursor-pointer"
                >
                  <ChevronRight className="size-3" />
                </button>
              </div>
            )}
          </InfoRow>

          {currentRequest ? (
            <>
              <InfoRow
                label="Заявитель"
                value={currentRequest.customer_name || (currentRequest.id_own_customer != null ? String(currentRequest.id_own_customer) : '—')}
              />
              <InfoRow label="Объект затрат" value={currentRequest.object_expend_name} />
              <InfoRow label="Вид работ" value={currentRequest.type_of_work} isLast />
            </>
          ) : (
            <InfoRow label="Заявитель" value="—" isLast />
          )}
        </div>
      </div>
    </div>
  );
};

export default DetailPanel;
