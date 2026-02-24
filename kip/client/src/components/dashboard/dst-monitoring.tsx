import { useState, useEffect } from "react"
import { cn } from "@/lib/utils"

const kipSummary = [
  { label: "Ср. КИП", value: "45", unit: "%", color: "border-t-primary", textColor: "text-primary" },
  { label: "Под нагр.", value: "26", unit: "%", color: "border-t-[#22C55E]", textColor: "text-[#22C55E]" },
  { label: "Простой", value: "7", unit: "ТС", color: "border-t-destructive", textColor: "text-destructive" },
  { label: "Активных", value: "3", unit: "ТС", color: "border-t-[#22C55E]", textColor: "text-[#22C55E]" },
]

const kipData = [
  { date: "08.02", s1kip: 84, s1load: 92, s2kip: 0, s2load: 0 },
  { date: "09.02", s1kip: 87, s1load: 36, s2kip: 0, s2load: 0 },
  { date: "10.02", s1kip: 97, s1load: 40, s2kip: 0, s2load: 0 },
  { date: "11.02", s1kip: 90, s1load: 39, s2kip: 0, s2load: 0 },
  { date: "12.02", s1kip: 0, s1load: 0, s2kip: 0, s2load: 0 },
  { date: "13.02", s1kip: 0, s1load: 0, s2kip: 0, s2load: 0 },
  { date: "14.02", s1kip: 0, s1load: 0, s2kip: 0, s2load: 0 },
  { date: "15.02", s1kip: 0, s1load: 0, s2kip: 0, s2load: 0 },
]

const kipTotals = { s1kip: 45, s1load: 26, s2kip: 0, s2load: 0 }

function useCountUp(target: number, duration = 500): number {
  const [current, setCurrent] = useState(0)
  useEffect(() => {
    if (target === 0) {
      setCurrent(0)
      return
    }
    const start = Date.now()
    const animate = () => {
      const elapsed = Date.now() - start
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setCurrent(Math.round(target * eased))
      if (progress < 1) requestAnimationFrame(animate)
    }
    requestAnimationFrame(animate)
  }, [target, duration])
  return current
}

function KipCard({ item }: { item: typeof kipSummary[0] }) {
  const num = parseInt(item.value, 10)
  const animated = useCountUp(num)
  return (
    <div
      className={cn(
        "bg-card-inner rounded-xl border border-border p-2 text-center border-t-[3px]",
        item.color
      )}
    >
      <div className={cn("text-2xl font-bold", item.textColor)}>{animated}</div>
      <div className="text-[10px] text-text-muted mt-0.5">
        {item.label}
        <br />
        {item.unit}
      </div>
    </div>
  )
}

function MapPlaceholder() {
  return (
    <div className="relative w-full h-48 rounded-xl bg-card-inner border border-border overflow-hidden">
      <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path
              d="M 40 0 L 0 0 0 40"
              fill="none"
              stroke="rgba(100,116,139,0.12)"
              strokeWidth="0.5"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
        <path
          d="M 20 80 Q 80 60 140 100 Q 200 140 260 110 Q 320 80 380 120"
          fill="none"
          stroke="rgba(100,116,139,0.3)"
          strokeWidth="2"
        />
        <path
          d="M 60 20 Q 100 80 90 140 Q 80 180 120 190"
          fill="none"
          stroke="rgba(100,116,139,0.25)"
          strokeWidth="1.5"
        />
        <path
          d="M 200 10 Q 220 60 210 120 Q 200 160 240 190"
          fill="none"
          stroke="rgba(100,116,139,0.25)"
          strokeWidth="1.5"
        />
        <path
          d="M 310 30 Q 300 80 320 130 Q 340 170 330 192"
          fill="none"
          stroke="rgba(100,116,139,0.2)"
          strokeWidth="1.5"
        />
        <rect
          x="70"
          y="50"
          width="30"
          height="20"
          rx="3"
          fill="rgba(100,116,139,0.1)"
          stroke="rgba(100,116,139,0.15)"
          strokeWidth="0.5"
        />
        <rect
          x="150"
          y="70"
          width="40"
          height="25"
          rx="3"
          fill="rgba(100,116,139,0.1)"
          stroke="rgba(100,116,139,0.15)"
          strokeWidth="0.5"
        />
        <rect
          x="250"
          y="45"
          width="35"
          height="30"
          rx="3"
          fill="rgba(100,116,139,0.1)"
          stroke="rgba(100,116,139,0.15)"
          strokeWidth="0.5"
        />
      </svg>

      <div className="absolute top-[40%] left-[25%] w-3 h-3 rounded-full bg-secondary animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.6)]" />
      <div className="absolute top-[55%] left-[55%] w-3 h-3 rounded-full bg-primary animate-pulse shadow-[0_0_8px_rgba(249,115,22,0.6)]" />
      <div className="absolute top-[35%] left-[75%] w-3 h-3 rounded-full bg-[#22C55E] animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]" />

      <div className="absolute bottom-2 left-3 text-[10px] text-text-muted">
        г. Нижневартовск : Восточный объезд
      </div>
    </div>
  )
}

export function DstMonitoring() {
  const [showSkeleton, setShowSkeleton] = useState(true)

  useEffect(() => {
    const t = setTimeout(() => setShowSkeleton(false), 300)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-text-primary">Мониторинг ДСТ</h2>
          <div className="text-[11px] text-text-muted">
            КИП &middot; Выработка &middot; Геолокация
          </div>
        </div>
        <span className="px-3 py-1 rounded-full bg-primary text-primary-foreground text-xs font-bold">
          КИП 33.0%
        </span>
      </div>

      {/* Vehicle Info Card */}
      <div className="bg-card-inner rounded-xl border border-border p-3 mb-3">
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          <span className="text-text-muted">Тип ТС</span>
          <span className="text-text-primary font-medium">Краны автомобильные, г/п 25</span>
          <span className="text-text-muted">Марка</span>
          <span className="text-text-primary font-medium">
            Автокран КС-55713-1В-4 на КамАЗ 65115
          </span>
          <span className="text-text-muted">Гос. №</span>
          <span className="text-secondary font-bold">Х702МУ72</span>
          <span className="text-text-muted">Заявка</span>
          <span className="text-text-primary font-medium">#121596</span>
        </div>
      </div>

      {/* Map */}
      <MapPlaceholder />

      {/* KIP Summary Cards */}
      <div className="grid grid-cols-4 gap-2 my-3">
        {kipSummary.map((item) => (
          <KipCard key={item.label} item={item} />
        ))}
      </div>

      {/* KIP Table */}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card z-10">
            <tr>
              <th
                rowSpan={2}
                className="text-left text-text-muted font-medium py-1 px-2"
              >
                Дата
              </th>
              <th
                colSpan={2}
                className="text-center text-text-muted font-medium py-1 px-1"
              >
                1 смена, %
              </th>
              <th
                colSpan={2}
                className="text-center text-text-muted font-medium py-1 px-1"
              >
                2 смена, %
              </th>
            </tr>
            <tr className="border-b border-border">
              <th className="text-center text-text-muted font-medium py-1 px-1">КИП</th>
              <th className="text-center text-text-muted font-medium py-1 px-1">Нагр.</th>
              <th className="text-center text-text-muted font-medium py-1 px-1">КИП</th>
              <th className="text-center text-text-muted font-medium py-1 px-1">Нагр.</th>
            </tr>
          </thead>
          <tbody>
            {showSkeleton ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={5} className="py-1.5 px-2">
                    <div className="skeleton-shimmer h-4 rounded" />
                  </td>
                </tr>
              ))
            ) : (
              kipData.map((row) => (
                <tr
                  key={row.date}
                  className="border-b border-border/50 transition-colors hover:bg-secondary/10"
                >
                  <td className="py-1.5 px-2 text-text-primary font-medium">{row.date}</td>
                  <td
                    className={cn(
                      "py-1.5 px-1 text-center font-semibold",
                      row.s1kip > 0 ? "text-[#22C55E]" : "text-destructive"
                    )}
                  >
                    {row.s1kip}
                  </td>
                  <td
                    className={cn(
                      "py-1.5 px-1 text-center font-semibold",
                      row.s1load > 0 ? "text-primary" : "text-destructive"
                    )}
                  >
                    {row.s1load}
                  </td>
                  <td
                    className={cn(
                      "py-1.5 px-1 text-center font-semibold",
                      row.s2kip > 0 ? "text-[#22C55E]" : "text-destructive"
                    )}
                  >
                    {row.s2kip}
                  </td>
                  <td
                    className={cn(
                      "py-1.5 px-1 text-center font-semibold",
                      row.s2load > 0 ? "text-primary" : "text-destructive"
                    )}
                  >
                    {row.s2load}
                  </td>
                </tr>
              ))
            )}
            <tr className="border-t-2 border-border">
              <td className="py-1.5 px-2 text-text-primary font-bold">Итого</td>
              <td
                className={cn(
                  "py-1.5 px-1 text-center font-bold",
                  kipTotals.s1kip > 0 ? "text-[#22C55E]" : "text-destructive"
                )}
              >
                {kipTotals.s1kip}
              </td>
              <td
                className={cn(
                  "py-1.5 px-1 text-center font-bold",
                  kipTotals.s1load > 0 ? "text-primary" : "text-destructive"
                )}
              >
                {kipTotals.s1load}
              </td>
              <td
                className={cn(
                  "py-1.5 px-1 text-center font-bold",
                  kipTotals.s2kip > 0 ? "text-[#22C55E]" : "text-destructive"
                )}
              >
                {kipTotals.s2kip}
              </td>
              <td
                className={cn(
                  "py-1.5 px-1 text-center font-bold",
                  kipTotals.s2load > 0 ? "text-primary" : "text-destructive"
                )}
              >
                {kipTotals.s2load}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
