import { useState } from "react"
import { ReportsColumn } from "./reports-column"
import { DstMonitoring } from "./dst-monitoring"
import { type VehicleType } from "./vehicle-type-slider"
import { Toast, type ToastData } from "./toast"
import { TyagachiVehicleBlock } from "../../features/tyagachi/TyagachiVehicleBlock"

export function Dashboard() {
  const [reportType, setReportType] = useState<VehicleType>("tyagachi")
  const [toasts, setToasts] = useState<ToastData[]>([])

  const addToast = (message: string, color = "#22C55E") => {
    const id = Date.now()
    setToasts((prev) => [...prev, { id, message, color }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000)
  }

  return (
    <>
      <div className="flex-1 min-h-0 grid grid-cols-3 gap-4 p-4">
        {/* Column 1 - Tyagachi Vehicle Block (SyncPanel + VehicleOverview) */}
        <div className="glass-card bg-card rounded-[18px] border border-border p-5 overflow-hidden flex flex-col transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl">
          <TyagachiVehicleBlock />
        </div>

        {/* Column 2 - Reports */}
        <div className="glass-card bg-card rounded-[18px] border border-border p-5 overflow-hidden flex flex-col transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl">
          <ReportsColumn
            vehicleType={reportType}
            onTypeChange={setReportType}
            onCreateReport={() => addToast("Отчёт создан ✓")}
          />
        </div>

        {/* Column 3 - DST Monitoring (always WIP) */}
        <div className="glass-card bg-card rounded-[18px] border border-border p-5 overflow-hidden flex flex-col transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl group relative">
          <DstMonitoring />
          <div className="absolute inset-0 rounded-[18px] bg-black/0 group-hover:bg-black/40 transition-all duration-200 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 pointer-events-none">
            <span className="text-white font-semibold text-lg">В разработке</span>
            <span className="text-5xl mt-2">🤖</span>
          </div>
        </div>
      </div>

      {/* Toast container */}
      <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50">
        {toasts.map((t) => (
          <Toast key={t.id} {...t} />
        ))}
      </div>
    </>
  )
}
