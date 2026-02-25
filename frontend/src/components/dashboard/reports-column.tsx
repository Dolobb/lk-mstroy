import React, { useState, useEffect, useCallback, useRef } from "react"
import { Calendar, ExternalLink, RefreshCw, ChevronDown, MapPin, Navigation } from "lucide-react"
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

function AddressMultiSelect({
  label,
  icon: Icon,
  options,
  selected,
  onChange,
}: {
  label: string
  icon: React.ComponentType<{ className?: string }>
  options: string[]
  selected: string[]
  onChange: (v: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  const toggle = (opt: string) =>
    onChange(selected.includes(opt) ? selected.filter(s => s !== opt) : [...selected, opt])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full px-3 py-2 rounded-xl bg-card-inner border border-border flex items-center justify-between gap-2 text-left"
        style={{ fontSize: 12, color: selected.length > 0 ? "var(--text-primary)" : "var(--text-muted)" }}
      >
        <span className="flex items-center gap-1.5 min-w-0">
          <Icon className="w-3 h-3 shrink-0 text-text-muted" />
          <span className="truncate">
            {selected.length > 0 ? `${selected.length} выбрано` : label}
          </span>
        </span>
        <ChevronDown className={cn("w-3 h-3 shrink-0 text-text-muted transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 right-0 z-50 bg-card border border-border rounded-xl shadow-xl overflow-hidden">
          {options.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-text-muted">Нет данных (запустите синхронизацию)</div>
          ) : (
            <div className="max-h-44 overflow-y-auto custom-scrollbar">
              {selected.length > 0 && (
                <button
                  type="button"
                  onClick={() => onChange([])}
                  className="w-full px-3 py-1.5 text-left text-[10px] text-text-muted hover:text-text-primary border-b border-border/40"
                >
                  Снять все
                </button>
              )}
              {options.map(opt => (
                <label
                  key={opt}
                  className="flex items-start gap-2 px-3 py-1.5 hover:bg-card-inner cursor-pointer"
                >
                  <div
                    onClick={() => toggle(opt)}
                    className={cn(
                      "w-3.5 h-3.5 mt-0.5 rounded border-2 flex items-center justify-center shrink-0 cursor-pointer transition-colors",
                      selected.includes(opt) ? "bg-secondary border-secondary" : "border-text-muted"
                    )}
                  >
                    {selected.includes(opt) && (
                      <svg width="8" height="6" viewBox="0 0 10 8" fill="none">
                        <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                  <span className="text-[11px] text-text-secondary leading-snug" onClick={() => toggle(opt)}>{opt}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function MultiSelectStub({ label }: { label: string }) {
  return (
    <div
      className="w-full px-3 py-2 rounded-xl bg-card-inner border border-border cursor-pointer flex items-center justify-between"
      style={{ color: "var(--text-muted)", fontSize: 12 }}
    >
      <span>{label}</span>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </div>
  )
}

function CheckboxField({ label }: { label: string }) {
  const [checked, setChecked] = useState(false)
  return (
    <label className="flex items-center gap-2 cursor-pointer" onClick={() => setChecked(!checked)}>
      <div
        className={cn(
          "w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors",
          checked ? "bg-secondary border-secondary" : "border-text-muted"
        )}
      >
        {checked && (
          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
            <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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
  hideTypeSlider?: boolean
}

export function ReportsColumn({ vehicleType, onTypeChange, onCreateReport, hideTypeSlider }: ReportsColumnProps) {
  const [orderStart, setOrderStart] = useState("01.12.2025")
  const [orderEnd, setOrderEnd] = useState(() => {
    const d = new Date()
    return `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")}.${d.getFullYear()}`
  })
  const [showSkeleton, setShowSkeleton] = useState(true)
  const [summary, setSummary] = useState<TyagachiSummary | null>(null)
  const [reports, setReports] = useState<LegacyReport[]>([])

  // Route address filters
  const [routeStartOptions, setRouteStartOptions] = useState<string[]>([])
  const [routeEndOptions, setRouteEndOptions] = useState<string[]>([])
  const [selectedStarts, setSelectedStarts] = useState<string[]>([])
  const [selectedEnds, setSelectedEnds] = useState<string[]>([])

  // Create report state
  const [creating, setCreating] = useState(false)
  const [createProgress, setCreateProgress] = useState("")
  const [createError, setCreateError] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setShowSkeleton(false), 300)
    return () => clearTimeout(t)
  }, [])

  const loadReports = useCallback(() => {
    Promise.all([
      fetch('/api/tyagachi/dashboard/summary').then((r) => r.ok ? r.json() : null),
      fetch('/api/tyagachi/reports').then((r) => r.ok ? r.json() : { reports: [] }),
      fetch('/api/tyagachi/route-addresses').then((r) => r.ok ? r.json() : null),
    ]).then(([s, r, addr]) => {
      setSummary(s)
      setReports(r?.reports ?? [])
      if (addr) {
        setRouteStartOptions(addr.route_start ?? [])
        setRouteEndOptions(addr.route_end ?? [])
      }
    }).catch(() => {})
  }, [])

  useEffect(() => {
    loadReports()
  }, [loadReports])

  // Poll for create status
  useEffect(() => {
    if (!creating) return
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/tyagachi/status')
        const status = res.ok ? await res.json() : null
        if (status) {
          setCreateProgress(status.progress || 'Генерация...')
          if (!status.running) {
            setCreating(false)
            clearInterval(interval)
            if (status.error) {
              setCreateError(status.error)
            } else {
              setCreateProgress("")
              loadReports()
            }
          }
        }
      } catch { /* ignore */ }
    }, 3000)
    return () => clearInterval(interval)
  }, [creating, loadReports])

  const handleCreate = async () => {
    if (vehicleType !== 'tyagachi') {
      onCreateReport()
      return
    }
    if (!orderStart || !orderEnd) return
    setCreating(true)
    setCreateError(null)
    setCreateProgress('Запуск генерации отчёта...')
    try {
      const res = await fetch('/api/tyagachi/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_pl: orderStart,
          to_pl: orderEnd,
          from_requests: orderStart,
          to_requests: orderEnd,
        }),
      })
      if (!res.ok) throw new Error(`Ошибка ${res.status}`)
    } catch (e) {
      setCreateError(String(e))
      setCreating(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Vehicle Type Slider */}
      {!hideTypeSlider && <VehicleTypeSlider value={vehicleType} onChange={onTypeChange} />}

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
              transform: vehicleType === "samosvaly" ? "translateY(0)" : "translateY(-6px)",
              overflow: "hidden",
              transition: "max-height 200ms ease, opacity 200ms ease, transform 200ms ease",
              pointerEvents: vehicleType === "samosvaly" ? "auto" : "none",
            }}
          >
            <MultiSelectStub label="Объект" />
          </div>

          {/* Conditional: tyagachi */}
          <div
            style={{
              maxHeight: vehicleType === "tyagachi" ? "200px" : "0",
              opacity: vehicleType === "tyagachi" ? 1 : 0,
              transform: vehicleType === "tyagachi" ? "translateY(0)" : "translateY(-6px)",
              overflow: "visible",
              transition: "max-height 200ms ease, opacity 200ms ease, transform 200ms ease",
              pointerEvents: vehicleType === "tyagachi" ? "auto" : "none",
            }}
          >
            <div className="flex flex-col gap-2">
              <AddressMultiSelect
                label="Начало маршрута"
                icon={MapPin}
                options={routeStartOptions}
                selected={selectedStarts}
                onChange={setSelectedStarts}
              />
              <AddressMultiSelect
                label="Конец маршрута"
                icon={Navigation}
                options={routeEndOptions}
                selected={selectedEnds}
                onChange={setSelectedEnds}
              />
              <CheckboxField label="Длинные маршруты" />
            </div>
          </div>

          {/* Conditional: dst */}
          <div
            style={{
              maxHeight: vehicleType === "dst" ? "120px" : "0",
              opacity: vehicleType === "dst" ? 1 : 0,
              transform: vehicleType === "dst" ? "translateY(0)" : "translateY(-6px)",
              overflow: "hidden",
              transition: "max-height 200ms ease, opacity 200ms ease, transform 200ms ease",
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
            onClick={handleCreate}
            disabled={creating}
            className="flex items-center gap-2 px-5 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors self-start disabled:opacity-60"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", creating && "animate-spin")} />
            {creating ? "Генерация..." : "Создать отчёт"}
          </button>

          {creating && createProgress && (
            <div className="text-[11px] text-text-muted">{createProgress}</div>
          )}
          {createError && (
            <div className="text-[11px] text-red-400">{createError}</div>
          )}
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
          {" · "}
          <span className="text-orange-400">{summary.requests_in_progress} в работе</span>
          {")"}
        </div>
      )}

      {/* Report History */}
      <h3 className="text-base font-bold text-text-primary mb-3">История отчётов</h3>
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar space-y-3">
        {showSkeleton ? (
          Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="skeleton-shimmer h-24 rounded-xl" />
          ))
        ) : reports.length === 0 ? (
          <div className="text-[12px] text-text-muted px-1">
            Нет отчётов. Задайте период и нажмите «Создать отчёт».
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
