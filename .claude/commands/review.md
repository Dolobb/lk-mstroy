---
description: Review staged/branch changes for bugs, security, and simplification opportunities
---

Review the changes on the current branch vs main.

Run: `git diff main...HEAD`

Check for:

**Correctness**
- Logic bugs, off-by-one errors, incorrect async/await
- Missing error handling at system boundaries (TIS API calls, DB queries, external fetches)
- Type safety gaps in TypeScript

**Security** (OWASP top 10 focus)
- SQL injection (check raw query interpolation in Express repos)
- XSS (check dangerouslySetInnerHTML or unescaped user content in React)
- Secrets / credentials accidentally committed
- Unvalidated input from query params / request body

**Performance**
- N+1 query patterns (loops with DB calls inside)
- Missing indexes implied by new query patterns
- Unnecessary re-renders in React components

**Simplification**
- Duplicate code that could share an existing utility
- Abstractions added for hypothetical future use (YAGNI)
- Dead code paths

**Project-specific gotchas**
- TIS API: POST with empty body, params in query string — verify any new TIS calls match this pattern
- Rate limit: 1 req/30s per idMO — check for missing delay logic in new batch loops
- Tailwind v4: no `tailwind.config.js`, variables via `@theme` — flag any v3-style config additions
- Admin UI first: no direct DB mutations from curl scripts — flag any new shell-based data ops

Output: numbered list of findings, each with file:line reference and severity (🔴 bug / 🟡 warning / 🔵 suggestion).
