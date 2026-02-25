import { useState, useEffect, useRef, useMemo } from "react"
import { createPortal } from "react-dom"
import { Link } from "react-router-dom"
import { Search, ChevronDown, ChevronUp, CheckCircle2, Clock, Printer, Lock, Send, Circle, type LucideIcon } from "lucide-react"
import React from "react"
import { cn } from "@/lib/utils"
import { VehicleTypeSlider, TYPE_COLORS, type VehicleType } from "./vehicle-type-slider"
import type { TyagachiRequest } from "../../features/tyagachi/types"
import { buildStackedSegments, fmtRuDT, type StackedTimelineSegment } from "../../features/tyagachi/utils"

// ── static demo data ──────────────────────────────────────────────────────────

type TypeData = {
  models: { label: string; count: number }[]
  vehicles: { plate: string; model: string }[]
}

const DATA: Record<VehicleType, TypeData> = {
  tyagachi: {
    models: [
      { label: "Все", count: 23 },
      { label: "Volvo FM Truck 6x4", count: 11 },
      { label: "MAN 6*4", count: 5 },
      { label: "MAN 6*6", count: 4 },
      { label: "KamAZ 44108-24", count: 4 },
      { label: "MAN TGS 33.480", count: 2 },
    ],
    vehicles: [
      { plate: "С716РН72", model: "С/тягач Volvo FM Truck 6x4 12.8" },
      { plate: "С725РН72", model: "С/тягач Volvo FM Truck 6x4 12.8" },
      { plate: "С727РО72", model: "С/тягач Volvo FM Truck 6x4" },
      { plate: "С744РН72", model: "С/тягач Volvo FM Truck 6x4 12.8" },
      { plate: "С751РН72", model: "С/тягач Volvo FM Truck 6x4 12.8" },
      { plate: "С769РН72", model: "С/тягач Volvo FM Truck 6x4 12.8" },
      { plate: "А123ВС72", model: "С/тягач MAN 6*4 TGS 33.480" },
      { plate: "В456АС72", model: "С/тягач KamAZ 44108-24" },
    ],
  },
  samosvaly: {
    models: [
      { label: "Все", count: 18 },
      { label: "КамАЗ 6520", count: 7 },
      { label: "КамАЗ 65201", count: 4 },
      { label: "HOWO ZZ3257", count: 3 },
      { label: "МАЗ 6501", count: 2 },
      { label: "Shacman SX3256", count: 2 },
    ],
    vehicles: [
      { plate: "С716РН72", model: "Самосвал КамАЗ 6520" },
      { plate: "С725РН72", model: "Самосвал КамАЗ 6520" },
      { plate: "С727РО72", model: "Самосвал КамАЗ 65201" },
      { plate: "С744РН72", model: "Самосвал КамАЗ 6520" },
      { plate: "С751РН72", model: "Самосвал HOWO ZZ3257" },
      { plate: "С769РН72", model: "Самосвал МАЗ 6501" },
      { plate: "А123ВС72", model: "Самосвал Shacman SX3256" },
      { plate: "В456АС72", model: "Самосвал КамАЗ 65201" },
    ],
  },
  dst: {
    models: [
      { label: "Все", count: 15 },
      { label: "Кран КС-55713", count: 5 },
      { label: "Экскаватор PC200", count: 3 },
      { label: "Бульдозер Б10М", count: 3 },
      { label: "Автогрейдер ДЗ-98", count: 2 },
      { label: "Компрессор ДК-9", count: 2 },
    ],
    vehicles: [
      { plate: "Х702МУ72", model: "Кран КС-55713-1В-4 на КамАЗ" },
      { plate: "С725РН72", model: "Экскаватор PC200-8M0" },
      { plate: "С727РО72", model: "Бульдозер Б10М.0111ЕН" },
      { plate: "С744РН72", model: "Автогрейдер ДЗ-98В" },
      { plate: "С751РН72", model: "Кран КС-55713-5В-4" },
      { plate: "С769РН72", model: "Бульдозер Б10М" },
      { plate: "А123ВС72", model: "Компрессор ДК-9.252" },
      { plate: "В456АС72", model: "Экскаватор PC360" },
    ],
  },
}

const STATIC_ORDERS = [
  { id: "#121973", route: "Ялуторовский тракт 11-й км → Красная Горка, Омская обл.", status: "стабильная", statusColor: "bg-[#22C55E]" },
  { id: "#122409", route: "База МО36, Тюмень → пр. Братьев Коростелёвых, 181, Оренбург", status: "в работе", statusColor: "bg-primary" },
  { id: "#122496", route: "Ялуторовский тракт → Горячий Ключ, Омская обл.", status: "в работе", statusColor: "bg-primary" },
]
const STATIC_TIMELINE = [
  { id: "#121973", start: 0, end: 15, color: "bg-[#22C55E]" },
  { id: "#122496", start: 18, end: 33, color: "bg-primary" },
  { id: "#122409", start: 36, end: 52, color: "bg-primary" },
  { id: "#122409", start: 55, end: 72, color: "bg-secondary" },
  { id: "#122409", start: 75, end: 100, color: "bg-secondary" },
]

// ── types ─────────────────────────────────────────────────────────────────────

export interface RealVehicleItem {
  plate: string
  model: string
  stable: number
  inProgress: number
}

const WEEK_PRESETS = [
  { label: '1н', weeks: 1 },
  { label: '2н', weeks: 2 },
  { label: '4н', weeks: 4 },
]

const fmtDay = (d: Date) =>
  `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`

/** Clamps tooltip horizontal center within viewport (margin 10px) */
function clampLeft(cursorX: number, width: number): number {
  const margin = 10
  return Math.max(margin + width / 2, Math.min(cursorX, window.innerWidth - margin - width / 2))
}

function plColor(status: string | null): string {
  const map: Record<string, string> = {
    COMPLETED:   '#22C55E',
    IN_PROGRESS: '#fb923c',
    PRINTING:    '#60a5fa',
    CLOSED:      '#94a3b8',
    GIVED:       '#a78bfa',
  }
  return map[status ?? ''] ?? '#94a3b8'
}

interface FanState {
  segments: StackedTimelineSegment[]
  x: number
  y: number
  hoveredIdx: number | null
}

// ── component ─────────────────────────────────────────────────────────────────

interface VehicleOverviewProps {
  vehicleType: VehicleType
  onTypeChange: (t: VehicleType) => void
  realVehicles?: RealVehicleItem[]
  loadingVehicles?: boolean
  fetchRequests?: (plate: string, days: number) => Promise<TyagachiRequest[]>
  hideTypeSlider?: boolean
  lastSyncAt?: string | null
}

export function VehicleOverview({
  vehicleType,
  onTypeChange,
  realVehicles,
  loadingVehicles,
  fetchRequests,
  hideTypeSlider,
  lastSyncAt,
}: VehicleOverviewProps) {
  const isRealMode = !!realVehicles

  const [activeWeeks, setActiveWeeks] = useState(2)
  const [viewOffsetDays, setViewOffset] = useState(0)
  const [activeFilter, setActiveFilter] = useState("Все")
  const [selectedVehicles, setSelectedVehicles] = useState<string[]>([])
  const [search, setSearch] = useState("")
  const [showSkeleton, setShowSkeleton] = useState(true)
  const [hoveredSegment, setHoveredSegment] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(true) // static mode

  // Real-mode: requests per plate
  const [requestsCache, setRequestsCache] = useState<Record<string, TyagachiRequest[]>>({})
  const [loadingPlates, setLoadingPlates] = useState<Set<string>>(new Set())

  const cacheRef = useRef<Record<string, TyagachiRequest[]>>({})
  const pendingRef = useRef<Set<string>>(new Set())
  const fetchRef = useRef(fetchRequests)
  const totalDaysRef = useRef(activeWeeks * 7)
  useEffect(() => { fetchRef.current = fetchRequests }, [fetchRequests])
  useEffect(() => { totalDaysRef.current = activeWeeks * 7 }, [activeWeeks])

  const [cacheKey, setCacheKey] = useState(0)

  useEffect(() => {
    const t = setTimeout(() => setShowSkeleton(false), 300)
    return () => clearTimeout(t)
  }, [])

  // Select all by default
  const prevLenRef = useRef(0)
  useEffect(() => {
    if (!realVehicles || realVehicles.length === 0) return
    if (realVehicles.length !== prevLenRef.current) {
      prevLenRef.current = realVehicles.length
      setSelectedVehicles(realVehicles.map(v => v.plate))
    }
  }, [realVehicles])

  // Load requests when vehicle is selected
  useEffect(() => {
    if (!isRealMode) return
    for (const plate of selectedVehicles) {
      if (cacheRef.current[plate] !== undefined || pendingRef.current.has(plate)) continue
      const fn = fetchRef.current
      if (!fn) continue
      pendingRef.current.add(plate)
      setLoadingPlates(prev => new Set([...prev, plate]))
      fn(plate, totalDaysRef.current)
        .then(reqs => {
          cacheRef.current[plate] = reqs
          setRequestsCache(r => ({ ...r, [plate]: reqs }))
        })
        .catch(() => {
          cacheRef.current[plate] = []
          setRequestsCache(r => ({ ...r, [plate]: [] }))
        })
        .finally(() => {
          pendingRef.current.delete(plate)
          setLoadingPlates(prev => { const s = new Set(prev); s.delete(plate); return s })
        })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVehicles, cacheKey, isRealMode])

  const handlePeriodChange = (weeks: number) => {
    setActiveWeeks(weeks)
    setViewOffset(0)
    cacheRef.current = {}
    pendingRef.current.clear()
    setRequestsCache({})
    setLoadingPlates(new Set())
    setCacheKey(k => k + 1)
  }

  // ── Window computation ────────────────────────────────────────────────────

  const totalDays = activeWeeks * 7

  const viewEnd = useMemo(() => {
    if (lastSyncAt) {
      try { return new Date(lastSyncAt) } catch { /* fall through */ }
    }
    return new Date()
  }, [lastSyncAt])

  const clampedOffset = Math.max(0, Math.min(viewOffsetDays, totalDays - 7))
  const windowEnd = new Date(viewEnd.getTime() - clampedOffset * 86_400_000)
  const windowStart = new Date(windowEnd.getTime() - 7 * 86_400_000)

  const canGoBack = clampedOffset < totalDays - 7
  const canGoForward = clampedOffset > 0

  const navigateWindow = (dir: 'back' | 'forward') =>
    setViewOffset(prev => Math.max(0, Math.min(prev + (dir === 'back' ? 7 : -7), totalDays - 7)))

  // ── Model filters ─────────────────────────────────────────────────────────

  const realModelFilters = useMemo(() => {
    if (!realVehicles) return []
    const counts: Record<string, number> = {}
    for (const v of realVehicles) {
      const cleaned = v.model?.replace(/^[сС][\/\\]тягач\s*/i, "").trim() ?? ""
      const brand = cleaned.split(/\s+/)[0] || "Неизвестно"
      counts[brand] = (counts[brand] || 0) + 1
    }
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([l, c]) => ({ label: l, count: c }))
    return [{ label: "Все", count: realVehicles.length }, ...top]
  }, [realVehicles])

  const vehicles = isRealMode ? realVehicles! : DATA[vehicleType].vehicles
  const modelFilters = isRealMode ? realModelFilters : DATA[vehicleType].models

  const filteredByModel = useMemo(() => {
    if (activeFilter === "Все") return vehicles
    if (isRealMode) {
      return (vehicles as RealVehicleItem[]).filter(v => {
        const c = v.model?.replace(/^[сС][\/\\]тягач\s*/i, "").trim() ?? ""
        return (c.split(/\s+/)[0] || "Неизвестно") === activeFilter
      })
    }
    return vehicles
  }, [vehicles, activeFilter, isRealMode])

  const filteredVehicles = useMemo(
    () => filteredByModel.filter(v => v.plate.toLowerCase().includes(search.toLowerCase())),
    [filteredByModel, search]
  )

  // Vehicles to show in the detail strip: selected + requests loaded
  const detailVehicles = useMemo(
    () => selectedVehicles.filter(p => realVehicles?.some(v => v.plate === p)),
    [selectedVehicles, realVehicles]
  )

  return (
    <div className="flex flex-col h-full">
      {!hideTypeSlider && <VehicleTypeSlider value={vehicleType} onChange={onTypeChange} />}

      {/* Header + Period */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <h2 className="text-lg font-bold text-text-primary">Обзор машин</h2>
        <div className="flex items-center gap-1 text-xs">
          <span className="text-text-secondary mr-1">Период:</span>
          {WEEK_PRESETS.map(p => (
            <button
              key={p.weeks}
              onClick={() => handlePeriodChange(p.weeks)}
              className={cn(
                "px-2.5 py-1 rounded-md font-medium transition-colors",
                activeWeeks === p.weeks
                  ? "bg-secondary text-secondary-foreground"
                  : "text-text-secondary hover:text-text-primary"
              )}
            >
              {p.label}
            </button>
          ))}
          <div className="flex items-center gap-0.5 ml-1">
            <button
              onClick={() => handlePeriodChange(Math.max(1, activeWeeks - 1))}
              className="w-5 h-5 rounded flex items-center justify-center text-text-secondary hover:text-text-primary"
            >−</button>
            <span className="text-text-primary font-semibold min-w-[3ch] text-center">{activeWeeks}н</span>
            <button
              onClick={() => handlePeriodChange(Math.min(52, activeWeeks + 1))}
              className="w-5 h-5 rounded flex items-center justify-center text-text-secondary hover:text-text-primary"
            >+</button>
          </div>
        </div>
      </div>

      {/* Model Filters */}
      <div className="flex flex-wrap gap-1.5 mb-3 flex-shrink-0">
        {modelFilters.map(f => (
          <button
            key={f.label}
            onClick={() => setActiveFilter(f.label)}
            className={cn(
              "px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors",
              activeFilter === f.label
                ? "bg-secondary/20 text-secondary border-secondary/40"
                : "text-text-secondary border-border hover:border-text-muted"
            )}
          >
            {f.label} ({f.count})
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-2 flex-shrink-0">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
        <input
          type="text"
          placeholder="Поиск по номеру..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2 rounded-xl bg-card-inner border border-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-secondary"
        />
      </div>

      {/* Select All / Deselect All */}
      <div className="flex items-center gap-3 mb-2 text-xs flex-shrink-0">
        <button onClick={() => setSelectedVehicles(filteredVehicles.map(v => v.plate))} className="text-secondary hover:underline font-medium">Выбрать все</button>
        <button onClick={() => setSelectedVehicles([])} className="text-text-secondary hover:underline font-medium">Снять все</button>
      </div>

      {/* Vehicle list — FIXED MAX HEIGHT */}
      <div className="max-h-[200px] overflow-y-auto custom-scrollbar space-y-0.5 mb-3 flex-shrink-0">
        {showSkeleton || loadingVehicles ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2">
              <div className="skeleton-shimmer w-4 h-4 rounded" />
              <div className="skeleton-shimmer h-4 flex-1 rounded" />
            </div>
          ))
        ) : filteredVehicles.length === 0 ? (
          <div className="px-3 py-4 text-xs text-text-muted text-center">
            {isRealMode ? "Нет данных. Запустите синхронизацию." : "Нет совпадений"}
          </div>
        ) : (
          filteredVehicles.map(v => {
            const isSelected = selectedVehicles.includes(v.plate)
            const rv = v as RealVehicleItem
            return (
              <label
                key={v.plate}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors",
                  isSelected ? "bg-secondary/15" : "hover:bg-card-inner"
                )}
              >
                <div
                  onClick={() => setSelectedVehicles(prev =>
                    prev.includes(v.plate) ? prev.filter(p => p !== v.plate) : [...prev, v.plate]
                  )}
                  className={cn(
                    "w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 cursor-pointer transition-colors",
                    isSelected ? "bg-secondary border-secondary" : "border-text-muted"
                  )}
                >
                  {isSelected && (
                    <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                      <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                <span className="text-sm flex-1 min-w-0">
                  <span className={cn("font-semibold", isSelected ? "text-secondary" : "text-text-primary")}>{v.plate}</span>
                  <span className="text-text-secondary"> — {v.model}</span>
                </span>
                {isRealMode && (
                  <span className="text-[10px] shrink-0 flex gap-1.5">
                    {loadingPlates.has(v.plate) ? (
                      <span className="text-text-muted animate-pulse">…</span>
                    ) : (() => {
                      const cached = requestsCache[v.plate]
                      const st = cached ? cached.filter(r => r.stability_status === 'stable').length : rv.stable
                      const ip = cached ? cached.filter(r => r.stability_status === 'in_progress').length : rv.inProgress
                      return <>
                        {st > 0 && <span className="text-[#22C55E]">{st}ст.</span>}
                        {ip > 0 && <span className="text-orange-400">{ip}акт.</span>}
                      </>
                    })()}
                  </span>
                )}
              </label>
            )
          })
        )}
      </div>

      {/* ── REAL MODE: detail strip with ALL selected vehicles ── */}
      {isRealMode && (
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar space-y-2">
          {detailVehicles.length === 0 ? (
            <div className="text-xs text-text-muted text-center py-6">Выберите машины для просмотра заявок</div>
          ) : (
            detailVehicles.map(plate => {
              const vehicle = realVehicles!.find(v => v.plate === plate)!
              const reqs = requestsCache[plate]
              const isLoading = loadingPlates.has(plate)
              const stacked = reqs?.length ? buildStackedSegments(reqs, windowStart, windowEnd) : null

              return (
                <VehicleDetailRow
                  key={plate}
                  plate={plate}
                  model={vehicle.model}
                  stable={vehicle.stable}
                  inProgress={vehicle.inProgress}
                  requests={reqs ?? null}
                  stacked={stacked}
                  isLoading={isLoading}
                  windowStart={windowStart}
                  windowEnd={windowEnd}
                  totalDays={totalDays}
                  clampedOffset={clampedOffset}
                  canGoBack={canGoBack}
                  canGoForward={canGoForward}
                  onNavigate={navigateWindow}
                  onDragOffset={setViewOffset}
                  hoveredSegment={hoveredSegment}
                  onHoverSegment={setHoveredSegment}
                  accentColor={TYPE_COLORS[vehicleType]}
                />
              )
            })
          )}
        </div>
      )}

      {/* ── STATIC MODE: single detail pane ── */}
      {!isRealMode && selectedVehicles.length > 0 && (
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
          <div className="bg-card-inner rounded-xl border border-border p-3">
            <button onClick={() => setDetailOpen(!detailOpen)} className="flex items-center justify-between w-full">
              <div className="text-left">
                <div className="text-sm">
                  <span className="font-bold text-text-primary">С769РН72</span>{" "}
                  <span className="text-text-secondary">С/тягач Volvo FM Truck 6x4 12.8</span>
                </div>
                <div className="text-xs text-text-secondary mt-0.5">
                  Заявок: 5 (<span className="text-[#22C55E]">3 стаб.</span>, <span className="text-primary">2 в работе</span>)
                </div>
              </div>
              {detailOpen ? <ChevronUp className="w-4 h-4 text-text-muted" /> : <ChevronDown className="w-4 h-4 text-text-muted" />}
            </button>
            {detailOpen && (
              <div className="mt-3 space-y-3">
                <div>
                  <div className="flex items-center justify-between text-[10px] text-text-muted mb-1.5">
                    <span>04:02</span><span className="uppercase tracking-wider">Таймлайн</span><span>16:02</span>
                  </div>
                  <div className="flex gap-0.5 h-6 rounded-lg overflow-hidden">
                    {STATIC_TIMELINE.map((o, i) => (
                      <div
                        key={i}
                        className={cn("rounded-md flex items-center justify-center text-[8px] font-bold text-white", o.color)}
                        style={{ width: `${o.end - o.start}%`, position: "relative" }}
                        onMouseEnter={() => setHoveredSegment(`s${i}`)}
                        onMouseLeave={() => setHoveredSegment(null)}
                      >
                        {o.id}
                        {hoveredSegment === `s${i}` && (
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 z-50 pointer-events-none"
                            style={{ background: "var(--card)", border: "1px solid var(--border)", backdropFilter: "blur(16px)", borderRadius: 8, padding: "6px 10px", minWidth: 160, whiteSpace: "nowrap" }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary)" }}>{o.id}</div>
                            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{STATIC_ORDERS.find(ord => ord.id === o.id)?.route?.slice(0, 40) ?? ""}</div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-3 mt-1.5 text-[10px] text-text-muted">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#22C55E]" /> Стабильная</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-primary" /> В работе</span>
                  </div>
                </div>
                <div className="space-y-2 max-h-[180px] overflow-y-auto custom-scrollbar">
                  {STATIC_ORDERS.map((order, i) => (
                    <div key={i} className="border-l-[3px] rounded-lg bg-card p-2.5" style={{ borderLeftColor: TYPE_COLORS[vehicleType] }}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold text-text-primary">
                            {order.id} <span className="font-normal text-text-secondary">— {order.route}</span>
                          </div>
                        </div>
                        <span className={cn("text-[10px] px-2 py-0.5 rounded-full text-white font-medium", order.statusColor)}>{order.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── PL status badge ───────────────────────────────────────────────────────────

const PL_STATUS_MAP: Record<string, { Icon: LucideIcon; color: string; label: string }> = {
  COMPLETED:   { Icon: CheckCircle2, color: '#22C55E', label: 'Закрыт' },
  IN_PROGRESS: { Icon: Clock,        color: '#fb923c', label: 'В работе' },
  PRINTING:    { Icon: Printer,      color: '#60a5fa', label: 'Печать' },
  CLOSED:      { Icon: Lock,         color: '#94a3b8', label: 'Закрыт' },
  GIVED:       { Icon: Send,         color: '#a78bfa', label: 'Выдан' },
}

function PLStatusBadge({ status }: { status: string | null }) {
  const cfg: { Icon: LucideIcon; color: string; label: string } =
    (status && PL_STATUS_MAP[status]) || { Icon: Circle, color: '#94a3b8', label: status ?? '?' }
  return (
    <span className="inline-flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded-full border"
      style={{ color: cfg.color, borderColor: `${cfg.color}40`, background: `${cfg.color}14` }}>
      <cfg.Icon size={8} />
      {cfg.label}
    </span>
  )
}

// ── TimelineRuler ─────────────────────────────────────────────────────────────

function TimelineRuler({
  windowStart,
  totalDays,
  canGoBack,
  canGoForward,
  onNavigate,
  currentOffset,
  onDragOffset,
}: {
  windowStart: Date
  totalDays: number
  canGoBack: boolean
  canGoForward: boolean
  onNavigate: (dir: 'back' | 'forward') => void
  currentOffset: number
  onDragOffset: (offset: number) => void
}) {
  const rulerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startX: number; startOffset: number } | null>(null)

  const ticks = Array.from({ length: 8 }, (_, i) => ({
    pct: i / 7 * 100,
    label: fmtDay(new Date(windowStart.getTime() + i * 86_400_000)),
  }))

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startOffset: currentOffset }

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current || !rulerRef.current) return
      const rulerWidth = rulerRef.current.getBoundingClientRect().width
      const deltaX = ev.clientX - dragRef.current.startX
      const deltaDays = -deltaX / (rulerWidth / 7)
      const newOffset = Math.max(0, Math.min(dragRef.current.startOffset + deltaDays, totalDays - 7))
      onDragOffset(newOffset)
    }

    const onUp = (ev: MouseEvent) => {
      if (!dragRef.current || !rulerRef.current) return
      const rulerWidth = rulerRef.current.getBoundingClientRect().width
      const deltaX = ev.clientX - dragRef.current.startX
      const deltaDays = -deltaX / (rulerWidth / 7)
      const newOffset = Math.max(0, Math.min(dragRef.current.startOffset + deltaDays, totalDays - 7))
      onDragOffset(Math.round(newOffset))
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div className="flex items-center gap-1">
      {totalDays > 7 && (
        <button
          onClick={() => onNavigate('back')}
          disabled={!canGoBack}
          className="w-5 h-5 rounded flex items-center justify-center text-text-secondary hover:text-text-primary disabled:opacity-30 text-sm leading-none"
        >‹</button>
      )}
      <div
        ref={rulerRef}
        className="flex-1 relative h-5 cursor-grab select-none active:cursor-grabbing"
        onMouseDown={onMouseDown}
      >
        <div className="absolute top-2 left-0 right-0 h-px bg-border/50" />
        {ticks.map((t, i) => (
          <div
            key={i}
            className="absolute top-0 flex flex-col items-center -translate-x-1/2"
            style={{ left: `${t.pct}%` }}
          >
            <div className="h-2 w-px bg-border/70 mt-0.5" />
            {(i === 0 || i === 7 || i % 2 === 0) && (
              <span className="text-[9px] text-muted-foreground mt-0.5 whitespace-nowrap">{t.label}</span>
            )}
          </div>
        ))}
      </div>
      {totalDays > 7 && (
        <button
          onClick={() => onNavigate('forward')}
          disabled={!canGoForward}
          className="w-5 h-5 rounded flex items-center justify-center text-text-secondary hover:text-text-primary disabled:opacity-30 text-sm leading-none"
        >›</button>
      )}
    </div>
  )
}

// ── VehicleDetailRow ──────────────────────────────────────────────────────────

interface VehicleDetailRowProps {
  plate: string
  model: string
  stable: number
  inProgress: number
  requests: TyagachiRequest[] | null
  stacked: StackedTimelineSegment[] | null
  isLoading: boolean
  windowStart: Date
  windowEnd: Date
  totalDays: number
  clampedOffset: number
  canGoBack: boolean
  canGoForward: boolean
  onNavigate: (dir: 'back' | 'forward') => void
  onDragOffset: (offset: number) => void
  hoveredSegment: string | null
  onHoverSegment: (key: string | null) => void
  accentColor: string
}

function VehicleDetailRow({
  plate, model, stable, inProgress,
  requests, stacked, isLoading,
  windowStart, windowEnd, totalDays, clampedOffset,
  canGoBack, canGoForward, onNavigate, onDragOffset,
  accentColor,
}: VehicleDetailRowProps) {
  const [expanded, setExpanded] = useState(false)
  // hover previews — non-interactive (pointerEvents:none), no timers needed
  const [tooltipInfo, setTooltipInfo] = useState<{ seg: StackedTimelineSegment, x: number, y: number } | null>(null)
  const [fanState, setFanState] = useState<FanState | null>(null)
  // pinned popups — interactive, opened by click, closed by ✕ or outside click
  const [pinnedInfo, setPinnedInfo] = useState<{ seg: StackedTimelineSegment, x: number, y: number } | null>(null)
  const [pinnedFanState, setPinnedFanState] = useState<FanState | null>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const pinnedFanRef = useRef<HTMLDivElement>(null)
  const pinnedInfoRef = useRef<HTMLDivElement>(null)

  const handleBarMouseMove = (e: React.MouseEvent) => {
    if (!barRef.current || !stacked?.length) return
    const rect = barRef.current.getBoundingClientRect()
    const pct = (e.clientX - rect.left) / rect.width * 100
    const hits = stacked.filter(s => pct >= s.startPct && pct <= s.startPct + s.widthPct)
    if (!hits.length) { setFanState(null); setTooltipInfo(null); return }
    if (hits.length === 1) {
      setFanState(null)
      setTooltipInfo({ seg: hits[0], x: e.clientX, y: e.clientY })
    } else {
      setTooltipInfo(null)
      setFanState({ segments: hits, x: e.clientX, y: e.clientY, hoveredIdx: null })
    }
  }

  const handleBarClick = (e: React.MouseEvent) => {
    if (!barRef.current || !stacked?.length) return
    const rect = barRef.current.getBoundingClientRect()
    const pct = (e.clientX - rect.left) / rect.width * 100
    const hits = stacked.filter(s => pct >= s.startPct && pct <= s.startPct + s.widthPct)
    if (!hits.length) return
    e.stopPropagation()
    if (hits.length === 1) {
      setPinnedInfo(prev => (prev?.seg.request.id === hits[0].request.id) ? null : { seg: hits[0], x: e.clientX, y: e.clientY })
      setPinnedFanState(null)
    } else {
      setPinnedFanState(prev => prev ? null : { segments: hits, x: e.clientX, y: e.clientY, hoveredIdx: null })
      setPinnedInfo(null)
    }
    setFanState(null)
  }

  // Close pinned popups on outside click
  useEffect(() => {
    if (!pinnedFanState) return
    const handler = (e: MouseEvent) => {
      if (pinnedFanRef.current && !pinnedFanRef.current.contains(e.target as Node)) {
        setPinnedFanState(null)
      }
    }
    const id = setTimeout(() => document.addEventListener('click', handler), 0)
    return () => { clearTimeout(id); document.removeEventListener('click', handler) }
  }, [pinnedFanState])

  useEffect(() => {
    if (!pinnedInfo) return
    const handler = (e: MouseEvent) => {
      if (pinnedInfoRef.current && !pinnedInfoRef.current.contains(e.target as Node)) {
        setPinnedInfo(null)
      }
    }
    const id = setTimeout(() => document.addEventListener('click', handler), 0)
    return () => { clearTimeout(id); document.removeEventListener('click', handler) }
  }, [pinnedInfo])

  return (
    <>
    <div className="bg-card-inner rounded-xl border border-border overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-card transition-colors"
      >
        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-text-primary shrink-0">{plate}</span>
            <span className="text-xs text-text-secondary truncate">{model}</span>
          </div>
          <div className="text-[10px] mt-0.5 flex gap-2 text-text-muted">
            {isLoading
              ? <span className="animate-pulse">загрузка…</span>
              : (() => {
                  const st = requests ? requests.filter(r => r.stability_status === 'stable').length : stable
                  const ip = requests ? requests.filter(r => r.stability_status === 'in_progress').length : inProgress
                  return <>
                    <span className="text-[#22C55E]">{st} стаб.</span>
                    <span className="text-orange-400">{ip} в работе</span>
                    {requests && <span>{requests.length} заявок</span>}
                  </>
                })()
            }
          </div>
        </div>

        {/* Mini timeline — те же ПЛ-сегменты что и большой таймлайн */}
        <div className="w-32 shrink-0">
          {isLoading ? (
            <div className="skeleton-shimmer h-4 rounded" />
          ) : stacked && stacked.length > 0 ? (
            <div className="relative h-4 rounded overflow-hidden">
              <div className="absolute inset-0 rounded border border-dashed border-zinc-500/30" />
              {stacked.map((seg, i) => (
                <div
                  key={i}
                  className="absolute top-0 h-full rounded-[2px]"
                  style={{
                    left: `${seg.startPct}%`,
                    width: `${seg.widthPct}%`,
                    background: seg.request.stability_status === 'stable' ? '#22C55E' : '#fb923c',
                    opacity: 0.85,
                    zIndex: seg.zIndex,
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="h-4 rounded border border-dashed border-zinc-500/30" />
          )}
        </div>

        {expanded ? <ChevronUp className="w-3.5 h-3.5 text-text-muted shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-text-muted shrink-0" />}
      </button>

      {/* Expanded: ruler + full stacked timeline + requests */}
      {expanded && !isLoading && (
        <div className="border-t border-border/40 px-3 pb-3 pt-2 space-y-3">
          {/* Ruler */}
          <TimelineRuler
            windowStart={windowStart}
            totalDays={totalDays}
            canGoBack={canGoBack}
            canGoForward={canGoForward}
            onNavigate={onNavigate}
            currentOffset={clampedOffset}
            onDragOffset={onDragOffset}
          />

          {/* Stacked timeline bar — hover: tooltip/fan preview, click: pin fan */}
          <div
            ref={barRef}
            className="relative h-6 rounded-lg cursor-pointer"
            onMouseMove={handleBarMouseMove}
            onClick={handleBarClick}
            onMouseLeave={() => {
              setTooltipInfo(null)
              setFanState(null)
            }}
          >
            <div className="absolute inset-0 rounded-lg border border-dashed border-zinc-500/30" />
            {(stacked ?? []).map((seg, i) => (
              <div
                key={i}
                className="absolute top-0 h-full rounded-sm overflow-hidden flex items-center justify-center text-[7px] font-bold text-white"
                style={{
                  left: `${seg.startPct}%`,
                  width: `${seg.widthPct}%`,
                  background: seg.request.stability_status === 'stable' ? '#22C55E' : '#fb923c',
                  opacity: 0.85,
                  zIndex: seg.zIndex,
                }}
              >
                {seg.widthPct > 6 && `#${seg.request.request_number}`}
              </div>
            ))}
          </div>

          {/* Request list */}
          <div className="space-y-1.5">
            {(requests ?? []).length === 0 ? (
              <div className="text-xs text-text-muted">Нет заявок за период</div>
            ) : (
              (requests ?? []).map(req => (
                <a
                  key={req.id}
                  href={`/api/tyagachi/request/${req.request_number}/report`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ textDecoration: "none", borderLeftColor: accentColor } as React.CSSProperties}
                  className="border-l-[3px] rounded-lg bg-card p-2.5 flex flex-col gap-1.5 hover:bg-muted/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-semibold text-text-primary">#{req.request_number}</span>
                    <span className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded-full text-white font-medium shrink-0",
                      req.stability_status === "stable" ? "bg-[#22C55E]" : "bg-orange-400"
                    )}>
                      {req.stability_status === "stable" ? "стаб." : "в работе"}
                    </span>
                  </div>
                  {req.route_start_address && (
                    <div className="text-[10px] text-text-secondary leading-snug">
                      <span className="text-text-muted">Начало: </span>{req.route_start_address}
                    </div>
                  )}
                  {req.route_end_address && (
                    <div className="text-[10px] text-text-secondary leading-snug">
                      <span className="text-text-muted">Конец: </span>{req.route_end_address}
                    </div>
                  )}
                  {!req.route_start_address && !req.route_end_address && req.object_expend_name && (
                    <div className="text-[10px] text-text-secondary">{req.object_expend_name}</div>
                  )}
                  {req.pl_records && req.pl_records.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {req.pl_records.map((pl, i) => (
                        <PLStatusBadge key={i} status={pl.pl_status} />
                      ))}
                    </div>
                  )}
                </a>
              ))
            )}
          </div>
        </div>
      )}
    </div>

    {/* Hover tooltip — одиночный сегмент, non-interactive (pointerEvents:none) */}
    {tooltipInfo && createPortal(
      <div
        style={{
          position: "fixed",
          left: clampLeft(tooltipInfo.x, 300),
          top: tooltipInfo.y - 8,
          transform: "translate(-50%, -100%)",
          zIndex: 9999,
          pointerEvents: "none",
          background: "rgba(12, 13, 20, 0.93)",
          border: "1px solid rgba(255,255,255,0.12)",
          backdropFilter: "blur(14px)",
          borderRadius: 9,
          padding: "8px 12px",
          minWidth: 200,
          maxWidth: 280,
          boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color: "#fff", marginBottom: 4 }}>
          Заявка #{tooltipInfo.seg.request.request_number}
        </div>
        {(tooltipInfo.seg.request.route_start_address || tooltipInfo.seg.request.route_end_address) && (
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.7)", lineHeight: 1.4, marginBottom: 3 }}>
            {tooltipInfo.seg.request.route_start_address && tooltipInfo.seg.request.route_end_address
              ? `${tooltipInfo.seg.request.route_start_address} → ${tooltipInfo.seg.request.route_end_address}`
              : tooltipInfo.seg.request.route_start_address ?? tooltipInfo.seg.request.route_end_address}
          </div>
        )}
        {(tooltipInfo.seg.plDateOut || tooltipInfo.seg.plDateIn) && (
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 2 }}>
            ПЛ: {fmtRuDT(tooltipInfo.seg.plDateOut)} — {fmtRuDT(tooltipInfo.seg.plDateIn)}
          </div>
        )}
        {(() => {
          const cfg = (tooltipInfo.seg.plStatus && PL_STATUS_MAP[tooltipInfo.seg.plStatus]) || { color: '#94a3b8', label: tooltipInfo.seg.plStatus ?? '—' }
          return (
            <div style={{ fontSize: 10, color: cfg.color, marginBottom: 4 }}>
              {tooltipInfo.seg.plId ?? '—'} · {cfg.label}
            </div>
          )
        })()}
        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', marginTop: 2 }}>нажмите для закрепления</div>
      </div>,
      document.body
    )}

    {/* Hover fan — перекрытые сегменты, non-interactive (pointerEvents:none) */}
    {fanState && !pinnedFanState && createPortal(
      <div
        style={{
          position: 'fixed',
          left: clampLeft(fanState.x, 240),
          top: fanState.y - 8,
          transform: 'translate(-50%, -100%)',
          zIndex: 10001,
          pointerEvents: 'none',
          background: 'rgba(12,13,20,0.93)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 8,
          padding: '7px 9px',
          backdropFilter: 'blur(14px)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          minWidth: 160,
        }}
      >
        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', marginBottom: 5 }}>
          {fanState.segments.length} заявки · нажмите для подробностей
        </div>
        {fanState.segments.map((seg, i) => (
          <div
            key={i}
            style={{
              height: 22, borderRadius: 5,
              background: plColor(seg.plStatus),
              padding: '0 8px', marginBottom: 2,
              display: 'flex', alignItems: 'center',
              opacity: 0.9,
            }}
          >
            <span style={{ fontSize: 10, color: '#fff', fontWeight: 600 }}>
              #{seg.request.request_number}
            </span>
            {seg.plId && (
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.6)', marginLeft: 6 }}>
                {seg.plId}
              </span>
            )}
          </div>
        ))}
      </div>,
      document.body
    )}

    {/* Pinned single popup — закрепляется по клику, интерактивный */}
    {pinnedInfo && createPortal(
      <div
        ref={pinnedInfoRef}
        onClick={e => e.stopPropagation()}
        style={{
          position: 'fixed',
          left: clampLeft(pinnedInfo.x, 300),
          top: pinnedInfo.y,
          transform: 'translate(-50%, -100%)',
          zIndex: 10003,
          pointerEvents: 'auto',
          background: 'rgba(12,13,20,0.97)',
          border: '1px solid rgba(255,255,255,0.22)',
          borderRadius: 10,
          padding: '9px 13px',
          backdropFilter: 'blur(20px)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
          minWidth: 240,
          maxWidth: 320,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>
            Заявка #{pinnedInfo.seg.request.request_number}
          </span>
          <button
            onClick={() => setPinnedInfo(null)}
            style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', background: 'none', border: 'none',
                     cursor: 'pointer', padding: '0 0 0 8px', lineHeight: 1, flexShrink: 0 }}
          >✕</button>
        </div>
        {(pinnedInfo.seg.request.route_start_address || pinnedInfo.seg.request.route_end_address) && (
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.72)', lineHeight: 1.45, marginBottom: 5 }}>
            {pinnedInfo.seg.request.route_start_address && pinnedInfo.seg.request.route_end_address
              ? `${pinnedInfo.seg.request.route_start_address} → ${pinnedInfo.seg.request.route_end_address}`
              : pinnedInfo.seg.request.route_start_address ?? pinnedInfo.seg.request.route_end_address}
          </div>
        )}
        {(pinnedInfo.seg.plDateOut || pinnedInfo.seg.plDateIn) && (
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginBottom: 3 }}>
            ПЛ: {fmtRuDT(pinnedInfo.seg.plDateOut)} — {fmtRuDT(pinnedInfo.seg.plDateIn)}
          </div>
        )}
        {(() => {
          const cfg = (pinnedInfo.seg.plStatus && PL_STATUS_MAP[pinnedInfo.seg.plStatus]) || { color: '#94a3b8', label: pinnedInfo.seg.plStatus ?? '—' }
          return (
            <div style={{ fontSize: 10, color: cfg.color, marginBottom: 8 }}>
              {pinnedInfo.seg.plId ?? '—'} · {cfg.label}
            </div>
          )
        })()}
        <a
          href={`/api/tyagachi/request/${pinnedInfo.seg.request.request_number}/report`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '4px 11px', borderRadius: 6,
            background: plColor(pinnedInfo.seg.plStatus), color: '#fff',
            fontSize: 10, fontWeight: 700, textDecoration: 'none', cursor: 'pointer',
          }}
        >
          ↗ Открыть отчёт #{pinnedInfo.seg.request.request_number}
        </a>
      </div>,
      document.body
    )}

    {/* Pinned fan portal — перекрытия, закрепляется по клику */}
    {pinnedFanState && createPortal(
      <div
        ref={pinnedFanRef}
        onClick={e => e.stopPropagation()}
        style={{
          position: 'fixed',
          left: clampLeft(pinnedFanState.x, 280),
          top: pinnedFanState.y,
          transform: 'translate(-50%, -100%)',
          zIndex: 10002,
          pointerEvents: 'auto',
          background: 'rgba(12,13,20,0.97)',
          border: '1px solid rgba(255,255,255,0.22)',
          borderRadius: 10,
          padding: '8px 10px',
          backdropFilter: 'blur(20px)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
          minWidth: 240,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)' }}>
            {pinnedFanState.segments.length} заявки в перекрытии
          </span>
          <button
            onClick={() => setPinnedFanState(null)}
            style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', background: 'none', border: 'none',
                     cursor: 'pointer', padding: '0 0 0 8px', lineHeight: 1 }}
          >✕</button>
        </div>
        {pinnedFanState.segments.map((seg, i) => (
          <div
            key={i}
            style={{
              height: 28, borderRadius: 6,
              background: plColor(seg.plStatus),
              padding: '0 10px', marginBottom: 3,
              display: 'flex', alignItems: 'center', cursor: 'default',
              opacity: pinnedFanState.hoveredIdx === i ? 1 : 0.82,
              transition: 'opacity 120ms',
            }}
            onMouseEnter={() => setPinnedFanState(p => p ? { ...p, hoveredIdx: i } : null)}
            onMouseLeave={() => setPinnedFanState(p => p ? { ...p, hoveredIdx: null } : null)}
          >
            <span style={{ fontSize: 11, color: '#fff', fontWeight: 600 }}>
              #{seg.request.request_number}
            </span>
            {seg.plId && (
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)', marginLeft: 6 }}>{seg.plId}</span>
            )}
          </div>
        ))}
        {pinnedFanState.hoveredIdx !== null && (() => {
          const seg = pinnedFanState.segments[pinnedFanState.hoveredIdx!]
          if (!seg) return null
          const cfg = (seg.plStatus && PL_STATUS_MAP[seg.plStatus]) || { color: '#94a3b8', label: seg.plStatus ?? '—' }
          return (
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 7, marginTop: 4,
                          fontSize: 10, color: 'rgba(255,255,255,0.65)' }}>
              {(seg.request.route_start_address || seg.request.route_end_address) && (
                <div style={{ marginBottom: 3, lineHeight: 1.4 }}>
                  {seg.request.route_start_address} → {seg.request.route_end_address}
                </div>
              )}
              <div style={{ color: 'rgba(255,255,255,0.4)', marginBottom: 3 }}>
                ПЛ: {fmtRuDT(seg.plDateOut)} — {fmtRuDT(seg.plDateIn)}
              </div>
              <div style={{ color: cfg.color, marginBottom: 8 }}>
                {seg.plId ?? '—'} · {cfg.label}
              </div>
              <a
                href={`/api/tyagachi/request/${seg.request.request_number}/report`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '4px 11px', borderRadius: 6,
                  background: plColor(seg.plStatus), color: '#fff',
                  fontSize: 10, fontWeight: 700, textDecoration: 'none', cursor: 'pointer',
                }}
              >
                ↗ Открыть отчёт #{seg.request.request_number}
              </a>
            </div>
          )
        })()}
      </div>,
      document.body
    )}
    </>
  )
}
