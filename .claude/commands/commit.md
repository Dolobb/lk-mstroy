---
description: Create a conventional commit with smart message from staged diff
---

Analyze the staged changes (`git diff --staged`) and create a conventional commit.

**Format:** `<type>(<scope>): <summary>`

Types:
- `feat` — new feature or capability
- `fix` — bug fix
- `refactor` — code change with no behavior change
- `chore` — tooling, deps, config
- `docs` — documentation only
- `perf` — performance improvement
- `test` — tests

Scope examples for this project: `kip`, `samosvaly`, `tyagachi`, `analytics`, `admin`, `frontend`, `vehicle-status`, `geo-admin`, `ai-reports`

**Rules:**
- Summary in Russian (this is the team's language)
- Max 72 chars on subject line
- If changes span multiple concerns, list them in bullet body
- Never use `--no-verify`
- No trailing period on subject

Steps:
1. Run `git diff --staged` to see what's staged
2. If nothing staged, run `git status` and ask which files to stage
3. Draft the commit message
4. Show the message and ask for confirmation before running `git commit`
