import React from 'react';

interface VehicleIconProps {
  kind: string;
  color?: string;
  size?: number;
}

export function VehicleIcon({ kind, color, size = 28 }: VehicleIconProps) {
  const stroke = color || 'currentColor';
  const h = (size * 18) / 28;
  const vb = '0 0 64 40';

  if (kind === 'samosvaly') return (
    <svg width={size} height={h} viewBox={vb} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 26 L8 8 L36 8 L36 26 Z"/><line x1="20" y1="26" x2="22" y2="12" strokeWidth="1.4"/>
      <rect x="37" y="14" width="20" height="12" rx="2"/><path d="M37 18 L43 18 L43 14"/>
      <line x1="4" y1="26" x2="57" y2="26"/><circle cx="14" cy="31" r="5"/><circle cx="44" cy="31" r="5"/><circle cx="55" cy="31" r="4"/>
    </svg>
  );
  if (kind === 'ekskav') return (
    <svg width={size} height={h} viewBox={vb} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="26" width="40" height="6" rx="2"/><circle cx="10" cy="33" r="3"/><circle cx="20" cy="33" r="3"/><circle cx="30" cy="33" r="3"/><circle cx="40" cy="33" r="3"/>
      <rect x="16" y="14" width="20" height="12" rx="2"/><path d="M36 16 L48 6 L54 12 L60 22 L56 24 L52 18 Z"/>
    </svg>
  );
  if (kind === 'kip') return (
    <svg width={size} height={h} viewBox={vb} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="14" cy="28" r="9"/><circle cx="14" cy="28" r="5" strokeWidth="1.1"/>
      <rect x="24" y="16" width="26" height="14" rx="2"/><rect x="30" y="8" width="14" height="10" rx="2"/>
      <circle cx="54" cy="30" r="7"/>
    </svg>
  );
  return (
    <svg width={size} height={h} viewBox={vb} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="14" y="24" width="34" height="8" rx="1"/><circle cx="22" cy="34" r="3"/><circle cx="38" cy="34" r="3"/>
      <line x1="32" y1="24" x2="32" y2="6"/><line x1="32" y1="6" x2="58" y2="14"/><line x1="50" y1="11" x2="50" y2="22"/>
    </svg>
  );
}
