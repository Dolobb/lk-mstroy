import { useState, useEffect } from "react"
import { Calendar, ExternalLink } from "lucide-react"
import { cn } from "@/lib/utils"
import { VehicleTypeSlider, TYPE_COLORS, type VehicleType } from "./vehicle-type-slider"

interface LegacyReport {
  id: number;
  title: string | null;
  created_at: string;
  requests_count: number | null;
  matched_count: number | null;
  from_pl: string | null;
  to_pl: string | null;
}

interface TyagachiSummary {
  vehicles_count: number;
  requests_total: number;
  requests_stable: number;
  requests_in_progress: number;
}

function MultiSelectStub({ label }: { label: string }) {
  const [selected] = useState<string[]>([])
  return (
    <div
      className="w-full px-3 py-2 rounded-xl bg-card-inner border border-border cursor-pointer flex items-center justify-between"
      style={{ color: "var(--text-muted)", fontSize: 12 }}
    >
      <span>{selected.length > 0 ? `Выбрано: ${selected.length}` : label}</span>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path
          d="M2 4l4 4 4-4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    </div>
  )
}

function CheckboxField({ label }: { label: string }) {
  const [checked, setChecked] = useState(false)
  return (
    <label
      className="flex items-center gap-2 cursor-pointer"
      onClick={() => setChecked(!checked)}
    >
      <div
        className={cn(
          "w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors",
          checked ? "bg-secondary border-secondary" : "border-text-muted"
        )}
      >
        {checked && (
          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
            <path
              d="M1 4L3.5 6.5L9 1"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>
      <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{label}</span>
    </label>
  )
}

interface ReportsColumnProps {
  vehicleType: VehicleType
  onTypeChange: (t: VehicleType) => void
  onCreateReport: () => void
}

export function ReportsColumn({ vehicleType, onTypeChange, onCreateReport }: ReportsColumnProps) {
  const [orderStart, setOrderStart] = useState("01.12.2025")
  const [orderEnd, setOrderEnd] = useState("16.02.2026")
  const [showSkeleton, setShowSkeleton] = useState(true)
  const [summary, setSummary] = useState<TyagachiSummary | null>(null)
  const [reports, setReports] = useState<LegacyReport[]>([])

  useEffect(() => {
    const t = setTimeout(() => setShowSkeleton(false), 300)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    Promise.all([
      fetch('/api/tyagachi/dashboard/summary').then((r) => r.ok ? r.json() : null),
      fetch('/api/tyagachi/reports').then((r) => r.ok ? r.json() : { reports: [] }),
    ]).then(([s, r]) => {
      setSummary(s)
      setReports(r?.reports ?? [])
    }).catch(() => {})
  }, [])

  return (
    <div className="flex flex-col h-full">
      {/* Vehicle Type Slider */}
      <VehicleTypeSlider value={vehicleType} onChange={onTypeChange} />

      {/* Header */}
      <h2 className="text-lg font-bold text-text-primary mb-4">Создать новый отчёт</h2>

      {/* Form with left accent line */}
      <div className="flex gap-3 mb-6">
        <div
          className="w-[3px] rounded-full flex-shrink-0 transition-colors duration-300"
          style={{ background: TYPE_COLORS[vehicleType] }}
        />
        <div className="flex-1 flex flex-col gap-3">
          {/* Period */}
          <div>
            <label className="text-[11px] uppercase tracking-wider text-text-muted font-medium mb-2 block">
              Период
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div className="relative">
                <input
                  type="text"
                  value={orderStart}
                  onChange={(e) => setOrderStart(e.target.value)}
                  placeholder="ДД.ММ.ГГГГ"
                  className="w-full px-3 py-2 pr-9 rounded-xl bg-card-inner border border-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-secondary"
                />
                <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              </div>
              <div className="relative">
                <input
                  type="text"
                  value={orderEnd}
                  onChange={(e) => setOrderEnd(e.target.value)}
                  placeholder="ДД.ММ.ГГГГ"
                  className="w-full px-3 py-2 pr-9 rounded-xl bg-card-inner border border-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-secondary"
                />
                <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              </div>
            </div>
          </div>

          {/* Conditional: samosvaly */}
          <div
            style={{
              maxHeight: vehicleType === "samosvaly" ? "80px" : "0",
              opacity: vehicleType === "samosvaly" ? 1 : 0,
              transform:
                vehicleType === "samosvaly" ? "translateY(0)" : "translateY(-6px)",
              overflow: "hidden",
              transition:
                "max-height 200ms ease, opacity 200ms ease, transform 200ms ease",
              pointerEvents: vehicleType === "samosvaly" ? "auto" : "none",
            }}
          >
            <MultiSelectStub label="Объект" />
          </div>

          {/* Conditional: tyagachi */}
          <div
            style={{
              maxHeight: vehicleType === "tyagachi" ? "160px" : "0",
              opacity: vehicleType === "tyagachi" ? 1 : 0,
              transform:
                vehicleType === "tyagachi" ? "translateY(0)" : "translateY(-6px)",
              overflow: "hidden",
              transition:
                "max-height 200ms ease, opacity 200ms ease, transform 200ms ease",
              pointerEvents: vehicleType === "tyagachi" ? "auto" : "none",
            }}
          >
            <div className="flex flex-col gap-2">
              <MultiSelectStub label="Город выезда" />
              <MultiSelectStub label="Город назначения" />
              <CheckboxField label="Длинные маршруты" />
            </div>
          </div>

          {/* Conditional: dst */}
          <div
            style={{
              maxHeight: vehicleType === "dst" ? "120px" : "0",
              opacity: vehicleType === "dst" ? 1 : 0,
              transform:
                vehicleType === "dst" ? "translateY(0)" : "translateY(-6px)",
              overflow: "hidden",
              transition:
                "max-height 200ms ease, opacity 200ms ease, transform 200ms ease",
              pointerEvents: vehicleType === "dst" ? "auto" : "none",
            }}
          >
            <div className="flex flex-col gap-2">
              <MultiSelectStub label="Объект" />
              <MultiSelectStub label="Тип техники" />
            </div>
          </div>

          {/* Button */}
          <button
            onClick={onCreateReport}
            className="px-5 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors self-start"
          >
            Создать отчёт
          </button>
        </div>
      </div>

      {/* Tyagachi summary */}
      {summary && (
        <div className="text-[11px] text-text-muted mb-3 px-1">
          Тягачи:{" "}
          <span className="text-text-primary font-semibold">{summary.vehicles_count}</span> машин
          {" · "}
          <span className="text-text-primary font-semibold">{summary.requests_total}</span> заявок
          {" ("}
          <span className="text-green-400">{summary.requests_stable} стаб.</span>
          {")"}
        </div>
      )}

      {/* Report History */}
      <h3 className="text-base font-bold text-text-primary mb-3">История отчётов (Тягачи)</h3>
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar space-y-3">
        {showSkeleton ? (
          Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="skeleton-shimmer h-24 rounded-xl" />
          ))
        ) : reports.length === 0 ? (
          <div className="text-[12px] text-text-muted px-1">
            Нет отчётов. Запустите тягачи-сервер и создайте отчёт.
          </div>
        ) : (
          reports.map((report) => (
            <div
              key={report.id}
              className="bg-card-inner rounded-xl border border-border p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
            >
              <h4 className="text-sm font-bold text-text-primary mb-1">
                {report.title ?? (report.from_pl && report.to_pl
                  ? `ПЛ ${report.from_pl} — ${report.to_pl}`
                  : `Отчёт #${report.id}`)}
              </h4>
              <div className="text-[11px] text-text-muted mb-3">
                Создан: {report.created_at ? new Date(report.created_at).toLocaleString('ru') : '—'}
                {report.requests_count != null && ` · ${report.requests_count} заявок`}
                {report.matched_count != null && ` · ${report.matched_count} совп.`}
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={`/api/tyagachi/reports/${report.id}/v2`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 px-3 py-1 rounded-lg bg-[#22C55E] text-white text-xs font-semibold hover:bg-[#22C55E]/90 transition-colors"
                  style={{ textDecoration: 'none' }}
                >
                  <ExternalLink className="w-3 h-3" />
                  Открыть
                </a>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
