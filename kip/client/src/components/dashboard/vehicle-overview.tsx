import { useState, useEffect } from "react"
import { Search, ChevronDown, ChevronUp, Printer, CheckCircle2, Ban } from "lucide-react"
import { cn } from "@/lib/utils"
import { VehicleTypeSlider, TYPE_COLORS, type VehicleType } from "./vehicle-type-slider"

const periods = ["1 нед", "2 нед", "1 мес", "Всё"]

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

const ORDERS = [
  {
    id: "#121973",
    route: "Ялуторовский тракт 11-й км → Красная Горка, Омская обл.",
    status: "стабильная",
    statusColor: "bg-[#22C55E]",
    plCounts: { printed: 2, closed: 3, notUsed: 0 },
  },
  {
    id: "#122409",
    route: "База МО36, Тюмень → пр. Братьев Коростелёвых, 181, Оренбург",
    status: "в работе",
    statusColor: "bg-primary",
    plCounts: { printed: 1, closed: 0, notUsed: 1 },
  },
  {
    id: "#122496",
    route: "Ялуторовский тракт → Горячий Ключ, Омская обл.",
    status: "в работе",
    statusColor: "bg-primary",
    plCounts: { printed: 0, closed: 1, notUsed: 2 },
  },
]

const timelineOrders = [
  { id: "#121973", start: 0, end: 15, color: "bg-[#22C55E]" },
  { id: "#122496", start: 18, end: 33, color: "bg-primary" },
  { id: "#122409", start: 36, end: 52, color: "bg-primary" },
  { id: "#122409", start: 55, end: 72, color: "bg-secondary" },
  { id: "#122409", start: 75, end: 100, color: "bg-secondary" },
]

interface VehicleOverviewProps {
  vehicleType: VehicleType
  onTypeChange: (t: VehicleType) => void
}

export function VehicleOverview({ vehicleType, onTypeChange }: VehicleOverviewProps) {
  const [activePeriod, setActivePeriod] = useState("2 нед")
  const [activeFilter, setActiveFilter] = useState("Все")
  const [selectedVehicles, setSelectedVehicles] = useState<string[]>(["С769РН72"])
  const [search, setSearch] = useState("")
  const [detailOpen, setDetailOpen] = useState(true)
  const [hoveredSegment, setHoveredSegment] = useState<number | null>(null)
  const [showSkeleton, setShowSkeleton] = useState(true)

  useEffect(() => {
    const t = setTimeout(() => setShowSkeleton(false), 300)
    return () => clearTimeout(t)
  }, [])

  const currentData = DATA[vehicleType]
  const vehicles = currentData.vehicles
  const modelFilters = currentData.models

  const toggleVehicle = (plate: string) => {
    setSelectedVehicles((prev) =>
      prev.includes(plate) ? prev.filter((p) => p !== plate) : [...prev, plate]
    )
  }

  const selectAll = () => setSelectedVehicles(vehicles.map((v) => v.plate))
  const deselectAll = () => setSelectedVehicles([])

  const filteredVehicles = vehicles.filter((v) =>
    v.plate.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="flex flex-col h-full">
      {/* Vehicle Type Slider */}
      <VehicleTypeSlider value={vehicleType} onChange={onTypeChange} />

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-text-primary">Обзор машин</h2>
        <div className="flex items-center gap-1 text-xs">
          <span className="text-text-secondary mr-1">Период:</span>
          {periods.map((p) => (
            <button
              key={p}
              onClick={() => setActivePeriod(p)}
              className={cn(
                "px-2.5 py-1 rounded-md font-medium transition-colors",
                activePeriod === p
                  ? "bg-secondary text-secondary-foreground"
                  : "text-text-secondary hover:text-text-primary"
              )}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Model Filters */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {modelFilters.map((f) => (
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
      <div className="relative mb-2">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
        <input
          type="text"
          placeholder="Поиск по номеру..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2 rounded-xl bg-card-inner border border-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-secondary"
        />
      </div>

      {/* Select All / Deselect All */}
      <div className="flex items-center gap-3 mb-2 text-xs">
        <button onClick={selectAll} className="text-secondary hover:underline font-medium">
          Выбрать все
        </button>
        <button onClick={deselectAll} className="text-text-secondary hover:underline font-medium">
          Снять все
        </button>
      </div>

      {/* Vehicle List */}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar space-y-0.5 mb-3">
        {showSkeleton ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2">
              <div className="skeleton-shimmer w-4 h-4 rounded" />
              <div className="skeleton-shimmer h-4 flex-1 rounded" />
            </div>
          ))
        ) : (
          filteredVehicles.map((v) => {
            const isSelected = selectedVehicles.includes(v.plate)
            return (
              <label
                key={v.plate}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors",
                  isSelected ? "bg-secondary/15" : "hover:bg-card-inner"
                )}
              >
                <div
                  onClick={() => toggleVehicle(v.plate)}
                  className={cn(
                    "w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors cursor-pointer",
                    isSelected ? "bg-secondary border-secondary" : "border-text-muted"
                  )}
                >
                  {isSelected && (
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
                <span className="text-sm">
                  <span
                    className={cn(
                      "font-semibold",
                      isSelected ? "text-secondary" : "text-text-primary"
                    )}
                  >
                    {v.plate}
                  </span>
                  <span className="text-text-secondary"> — {v.model}</span>
                </span>
              </label>
            )
          })
        )}
      </div>

      {/* Selected Vehicle Detail */}
      {selectedVehicles.length > 0 && (
        <div className="bg-card-inner rounded-xl border border-border p-3 flex-shrink-0">
          <button
            onClick={() => setDetailOpen(!detailOpen)}
            className="flex items-center justify-between w-full"
          >
            <div className="text-left">
              <div className="text-sm">
                <span className="font-bold text-text-primary">С769РН72</span>{" "}
                <span className="text-text-secondary">С/тягач Volvo FM Truck 6x4 12.8</span>
              </div>
              <div className="text-xs text-text-secondary mt-0.5">
                Заявок: 5 (<span className="text-[#22C55E]">3 стаб.</span>,{" "}
                <span className="text-primary">2 в работе</span>)
              </div>
            </div>
            {detailOpen ? (
              <ChevronUp className="w-4 h-4 text-text-muted flex-shrink-0" />
            ) : (
              <ChevronDown className="w-4 h-4 text-text-muted flex-shrink-0" />
            )}
          </button>

          {detailOpen && (
            <div className="mt-3 space-y-3">
              {/* Timeline */}
              <div>
                <div className="flex items-center justify-between text-[10px] text-text-muted mb-1.5">
                  <span>04:02</span>
                  <span className="uppercase tracking-wider">Таймлайн</span>
                  <span>16:02</span>
                </div>
                <div className="flex gap-0.5 h-6 rounded-lg overflow-hidden">
                  {timelineOrders.map((o, i) => (
                    <div
                      key={i}
                      className={cn(
                        "rounded-md flex items-center justify-center text-[8px] font-bold text-white",
                        o.color
                      )}
                      style={{
                        width: `${o.end - o.start}%`,
                        position: "relative",
                      }}
                      onMouseEnter={() => setHoveredSegment(i)}
                      onMouseLeave={() => setHoveredSegment(null)}
                    >
                      {o.id}
                      {hoveredSegment === i && (
                        <div
                          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 z-50 pointer-events-none"
                          style={{
                            background: "var(--card)",
                            border: "1px solid var(--border)",
                            backdropFilter: "blur(16px)",
                            borderRadius: 8,
                            padding: "6px 10px",
                            minWidth: 160,
                            whiteSpace: "nowrap",
                          }}
                        >
                          <div
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              color: "var(--text-primary)",
                            }}
                          >
                            {o.id}
                          </div>
                          <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                            {(() => {
                              const found = ORDERS.find((ord) => ord.id === o.id)
                              const route = found?.route ?? ""
                              return route.length > 40
                                ? route.slice(0, 40) + "…"
                                : route
                            })()}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-3 mt-1.5 text-[10px] text-text-muted">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-[#22C55E]" /> Стабильная
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-primary" /> В работе
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-text-muted" /> Пробел
                  </span>
                </div>
              </div>

              {/* Order Details */}
              <div className="space-y-2 max-h-[180px] overflow-y-auto custom-scrollbar">
                {ORDERS.map((order, i) => (
                  <div
                    key={i}
                    className="border-l-[3px] rounded-lg bg-card p-2.5"
                    style={{ borderLeftColor: TYPE_COLORS[vehicleType] }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-text-primary">
                          {order.id}{" "}
                          <span className="font-normal text-text-secondary">
                            — {order.route}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <div className="flex items-center gap-0.5">
                          <Printer
                            className="w-3 h-3"
                            style={{ color: "var(--text-muted)" }}
                          />
                          <span className="text-[10px] text-text-muted">
                            {order.plCounts.printed}
                          </span>
                        </div>
                        <div className="flex items-center gap-0.5">
                          <CheckCircle2
                            className="w-3 h-3"
                            style={{ color: "#22C55E" }}
                          />
                          <span className="text-[10px] text-text-muted">
                            {order.plCounts.closed}
                          </span>
                        </div>
                        <div className="flex items-center gap-0.5">
                          <Ban
                            className="w-3 h-3"
                            style={{ color: "var(--text-muted)" }}
                          />
                          <span className="text-[10px] text-text-muted">
                            {order.plCounts.notUsed}
                          </span>
                        </div>
                        <span
                          className={cn(
                            "text-[10px] px-2 py-0.5 rounded-full text-white font-medium",
                            order.statusColor
                          )}
                        >
                          {order.status}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
