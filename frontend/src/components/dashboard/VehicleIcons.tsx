import React from "react"

interface IconProps {
  className?: string
  strokeWidth?: string | number
}

/** Самосвал (dump truck) */
export function DumpTruckIcon({ className, strokeWidth = 1.5 }: IconProps) {
  const sw = Number(strokeWidth)
  return (
    <svg viewBox="0 0 64 40" fill="none" stroke="currentColor" strokeWidth={sw}
         strokeLinecap="round" strokeLinejoin="round" className={className}>
      {/* Dump bed */}
      <path d="M4 26 L8 8 L36 8 L36 26 Z" />
      {/* Hydraulic */}
      <line x1="20" y1="26" x2="22" y2="12" strokeWidth={sw * 0.8} />
      {/* Cab */}
      <rect x="37" y="14" width="20" height="12" rx="2" />
      <path d="M37 18 L43 18 L43 14" />
      <rect x="50" y="16" width="5" height="5" rx="1" strokeWidth={sw * 0.7} />
      {/* Chassis */}
      <line x1="4" y1="26" x2="57" y2="26" />
      {/* Wheels */}
      <circle cx="14" cy="31" r="5" />
      <circle cx="44" cy="31" r="5" />
      <circle cx="55" cy="31" r="4" />
    </svg>
  )
}

/** Тягач (semi truck) */
export function SemiTruckIcon({ className, strokeWidth = 1.5 }: IconProps) {
  const sw = Number(strokeWidth)
  return (
    <svg viewBox="0 0 80 40" fill="none" stroke="currentColor" strokeWidth={sw}
         strokeLinecap="round" strokeLinejoin="round" className={className}>
      {/* Trailer */}
      <rect x="2" y="10" width="44" height="18" rx="2" />
      <line x1="14" y1="10" x2="14" y2="28" strokeWidth={sw * 0.6} />
      <line x1="26" y1="10" x2="26" y2="28" strokeWidth={sw * 0.6} />
      <line x1="38" y1="10" x2="38" y2="28" strokeWidth={sw * 0.6} />
      {/* Cab */}
      <path d="M46 16 L46 28 L74 28 L74 20 L66 12 L50 12 L46 16 Z" />
      <rect x="56" y="14" width="12" height="8" rx="1" />
      {/* Exhaust */}
      <line x1="68" y1="12" x2="68" y2="6" />
      <line x1="71" y1="12" x2="71" y2="7" />
      {/* Hitch */}
      <line x1="44" y1="22" x2="46" y2="22" strokeWidth={sw * 1.2} />
      {/* Wheels */}
      <circle cx="10" cy="33" r="5" />
      <circle cx="22" cy="33" r="5" />
      <circle cx="54" cy="33" r="5" />
      <circle cx="65" cy="33" r="5" />
    </svg>
  )
}

/** Тяжёлая техника — дорожный каток (heavy machinery / compactor) */
export function HeavyMachineryIcon({ className, strokeWidth = 1.5 }: IconProps) {
  const sw = Number(strokeWidth)
  return (
    <svg viewBox="0 0 64 40" fill="none" stroke="currentColor" strokeWidth={sw}
         strokeLinecap="round" strokeLinejoin="round" className={className}>
      {/* Front roller drum */}
      <circle cx="14" cy="28" r="9" />
      <circle cx="14" cy="28" r="5" strokeWidth={sw * 0.6} />
      {/* Engine / body */}
      <rect x="24" y="16" width="26" height="14" rx="2" />
      {/* Cab */}
      <rect x="30" y="8" width="14" height="10" rx="2" />
      <rect x="33" y="10" width="8" height="5" rx="1" strokeWidth={sw * 0.7} />
      {/* Exhaust pipe */}
      <line x1="36" y1="8" x2="36" y2="4" />
      {/* Rear wheel */}
      <circle cx="54" cy="30" r="7" />
      <circle cx="54" cy="30" r="3" strokeWidth={sw * 0.6} />
      {/* Frame connection */}
      <line x1="23" y1="28" x2="14" y2="28" strokeWidth={sw * 0.8} />
    </svg>
  )
}
