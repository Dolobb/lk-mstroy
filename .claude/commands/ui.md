---
description: Build a UI component or page with Linear design system reference
---

Before writing any UI, read `frontend/DESIGN.md` — it defines the exact design tokens for colors, typography, spacing, border radius, and components.

Stack: React 18 + Vite + **Tailwind v4** (CSS variables via `@theme` in `src/index.css`, no `tailwind.config.js`) + shadcn/ui.

**Design rules (from DESIGN.md):**
- Canvas: `#010102` near-pure black, surfaces ladder: surface-1 `#0f1011` → surface-2 `#141516` → surface-3 `#18191a`
- Accent: Linear lavender `#5e6ad2` — CTAs, focus rings, active states only. Never decorative.
- Text: ink `#f7f8f8`, ink-muted `#d0d6e0`, ink-subtle `#8a8f98`
- Borders: hairline `#23252a` (1px), hairline-strong `#34343a`
- Cards: `surface-1` bg + hairline border + `rounded-lg` (12px) — never pill, no shadows
- Buttons: `rounded-md` (8px), padding 8px 14px, never pill
- Tailwind v4: use `var(--color-...)` CSS variables, NOT `bg-zinc-900` etc.

**Component output format:**
1. Write the component in `frontend/src/` at the correct location
2. Use existing shadcn/ui primitives if available (`Card`, `Button`, `Badge`, `Table`)
3. Map shadcn tokens to Linear palette via CSS vars in `src/index.css` if not already done
4. No inline styles — Tailwind utility classes only

Task: $ARGUMENTS
