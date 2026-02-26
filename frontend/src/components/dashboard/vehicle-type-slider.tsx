import React from "react"
import { Settings } from "lucide-react"
import { DumpTruckIcon, SemiTruckIcon } from "./VehicleIcons"

export type VehicleType = 'samosvaly' | 'tyagachi' | 'dst'

export const TYPE_COLORS: Record<VehicleType, string> = {
  samosvaly: '#A78BFA',
  tyagachi: '#2DD4BF',
  dst: '#E11D48',
}

const TABS: { key: VehicleType; label: string; Icon: React.ComponentType<{ className?: string; strokeWidth?: string | number }> }[] = [
  { key: 'samosvaly', label: 'Самосвалы', Icon: DumpTruckIcon },
  { key: 'tyagachi', label: 'Тягачи', Icon: SemiTruckIcon },
  { key: 'dst', label: 'ДСТ', Icon: Settings },
]

interface VehicleTypeSliderProps {
  value: VehicleType
  onChange: (t: VehicleType) => void
}

export function VehicleTypeSlider({ value, onChange }: VehicleTypeSliderProps) {
  const activeIndex = TABS.findIndex((t) => t.key === value)
  const pct = (activeIndex / TABS.length) * 100

  return (
    <div className="mb-4 relative" style={{ paddingTop: 4, paddingBottom: 4 }}>
      {/* Sliding border frame */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: `calc(${pct}% + 0px)`,
          width: `${100 / TABS.length}%`,
          border: '2px solid #F97316',
          borderRadius: 12,
          transition: 'left 300ms ease',
          pointerEvents: 'none',
          zIndex: 1,
        }}
      />
      {/* Container */}
      <div
        className="flex rounded-xl overflow-visible"
        style={{ background: 'var(--card-inner)', position: 'relative' }}
      >
        {TABS.map((tab) => {
          const isActive = value === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => onChange(tab.key)}
              className="flex-1 py-1.5 flex flex-col items-center gap-0.5 border-none bg-transparent cursor-pointer transition-none"
              style={{
                color: isActive ? '#F97316' : 'var(--text-muted)',
                fontWeight: isActive ? 600 : 400,
                transition: 'color 300ms ease',
                position: 'relative',
                zIndex: 2,
              }}
            >
              <tab.Icon className="w-7 h-5" strokeWidth={isActive ? 1.8 : 1.4} />
              <span className="text-[10px]">{tab.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
