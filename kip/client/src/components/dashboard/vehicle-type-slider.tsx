export type VehicleType = 'samosvaly' | 'tyagachi' | 'dst'

export const TYPE_COLORS: Record<VehicleType, string> = {
  samosvaly: '#A78BFA',
  tyagachi: '#2DD4BF',
  dst: '#E11D48',
}

const TABS: { key: VehicleType; label: string }[] = [
  { key: 'samosvaly', label: 'Самосвалы' },
  { key: 'tyagachi', label: 'Тягачи' },
  { key: 'dst', label: 'ДСТ' },
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
              className="flex-1 py-1.5 text-center text-xs font-medium border-none bg-transparent cursor-pointer transition-none"
              style={{
                color: isActive ? '#F97316' : 'var(--text-muted)',
                fontWeight: isActive ? 600 : 400,
                transition: 'color 300ms ease',
                position: 'relative',
                zIndex: 2,
              }}
            >
              {tab.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
