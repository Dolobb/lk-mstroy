import { useState, useEffect } from 'react'

export interface ToastData {
  id: number
  message: string
  color: string
}

export function Toast({ message, color }: ToastData) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 10)
    return () => clearTimeout(t)
  }, [])

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        minWidth: 240,
        overflow: 'hidden',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(16px)',
        transition: 'opacity 300ms ease, transform 300ms ease',
      }}
    >
      {/* Left accent stripe */}
      <div
        style={{
          width: 4,
          background: color,
          flexShrink: 0,
        }}
      />
      <div
        style={{
          padding: '12px 16px',
          fontSize: 13,
          color: 'var(--text-primary)',
        }}
      >
        {message}
      </div>
    </div>
  )
}
