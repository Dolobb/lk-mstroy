import React from 'react';
import { Loader2, CheckCircle2, XCircle, Download } from 'lucide-react';

const TOOL_LABELS: Record<string, string> = {
  queryKipData: 'Запрашиваю данные КИП',
  queryDumpTruckData: 'Запрашиваю данные самосвалов',
  queryDumpTruckTrips: 'Запрашиваю рейсы',
  queryTyagachiData: 'Запрашиваю данные тягачей',
  queryGeoData: 'Проверяю геоданные',
  queryRepairs: 'Запрашиваю ремонты',
  queryVehicleRegistry: 'Ищу в реестре ТС',
  generateXlsx: 'Генерирую Excel',
  generateKipReport: 'Генерирую отчёт КИП',
  generateDumpTruckSummary: 'Генерирую сводку самосвалов',
  generateTripDetail: 'Генерирую детальный отчёт по рейсам',
};

interface ToolStatusProps {
  toolName: string;
  state: string;
  output?: Record<string, unknown>;
}

function getSuffix(state: string, output?: Record<string, unknown>): string {
  if (state === 'input-streaming' || state === 'input-available') return '';
  if (state === 'output-error') {
    const err = output?.error ?? output?.message;
    return err ? ` — ${String(err).slice(0, 80)}` : ' — ошибка';
  }
  if (state === 'output-available' && output) {
    if (output.downloadUrl) return '';
    if (typeof output.count === 'number') return ` — ${output.count} записей`;
    if (typeof output.message === 'string') return ` — ${output.message}`;
    if (output.success === true) return ' — готово';
  }
  return '';
}

export const ToolStatus: React.FC<ToolStatusProps> = ({ toolName, state, output }) => {
  const label = TOOL_LABELS[toolName] || toolName;
  const isLoading = state === 'input-streaming' || state === 'input-available';
  const isError = state === 'output-error' || (state === 'output-available' && output?.success === false);
  const isDone = state === 'output-available' && !isError;
  const hasDownload = isDone && output?.downloadUrl;
  const suffix = getSuffix(isError ? 'output-error' : state, output);

  return (
    <div className="flex flex-col gap-1">
      <div
        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] leading-tight ${
          isError
            ? 'bg-destructive/10 text-destructive'
            : 'bg-muted/50 text-muted-foreground'
        }`}
      >
        {isLoading && <Loader2 className="w-3 h-3 animate-spin shrink-0" />}
        {isDone && <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />}
        {isError && <XCircle className="w-3 h-3 shrink-0" />}
        <span>
          {label}
          {suffix}
        </span>
      </div>

      {hasDownload ? (
        <a
          href={String(output!.downloadUrl)}
          download
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg
            bg-accent/15 hover:bg-accent/25 text-accent
            border border-accent/20 hover:border-accent/40
            transition-all no-underline text-xs font-medium w-fit"
        >
          <Download className="w-3.5 h-3.5" />
          Скачать отчёт
        </a>
      ) : null}
    </div>
  );
};
