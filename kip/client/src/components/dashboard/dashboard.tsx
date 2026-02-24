import { useState } from "react"
import { VehicleOverview } from "./vehicle-overview"
import { ReportsColumn } from "./reports-column"
import { DstMonitoring } from "./dst-monitoring"
import { type VehicleType } from "./vehicle-type-slider"
import { Toast, type ToastData } from "./toast"

export function Dashboard() {
  const [vehicleType, setVehicleType] = useState<VehicleType>("tyagachi")
  const [toasts, setToasts] = useState<ToastData[]>([])

  const addToast = (message: string, color = "#22C55E") => {
    const id = Date.now()
    setToasts((prev) => [...prev, { id, message, color }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000)
  }

  return (
    <>
      <div className="flex-1 min-h-0 grid grid-cols-3 gap-4 p-4">
        {/* Column 1 - Vehicle Overview */}
        <div className="glass-card bg-card rounded-[18px] border border-border p-5 overflow-hidden flex flex-col transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl">
          <VehicleOverview vehicleType={vehicleType} onTypeChange={setVehicleType} />
        </div>

        {/* Column 2 - Reports */}
        <div className="glass-card bg-card rounded-[18px] border border-border p-5 overflow-hidden flex flex-col transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl">
          <ReportsColumn
            vehicleType={vehicleType}
            onTypeChange={setVehicleType}
            onCreateReport={() => addToast("Отчёт создан ✓")}
          />
        </div>

        {/* Column 3 - DST Monitoring */}
        <div className="glass-card bg-card rounded-[18px] border border-border p-5 overflow-hidden flex flex-col transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl">
          <DstMonitoring />
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
