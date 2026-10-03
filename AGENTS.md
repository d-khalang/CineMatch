# CineMatch agent instructions

## Roles

- The user is the product owner. Treat high level direction, priorities, and product constraints as authoritative.
- For roadmap, architecture, triage, Linear planning, delegation, or PR coordination, use the repo scoped `cinematch-tech-lead` skill in `.codex/skills/cinematch-tech-lead/SKILL.md`.
- Treat active Linear issues labeled `codex-cordinate` as the Codex coordination queue. Codex owns the planning and all Gemini communication for those issues through Linear and pull requests.
- When an issue is already scoped for implementation, act as the developer for that issue. Follow its acceptance criteria and avoid expanding its scope.

## Project constraints

- `cinematch_v1.1.0.md` is the current product and release specification unless the owner gives newer direction.
- CineMatch is client first and BYOK. Do not introduce an application backend, proxy, shared credential, or app funded provider access without an explicit product decision.
- Never commit, print, request in chat, or place real provider credentials in `.env` files. Routine tests use mocked providers.
- Preserve unrelated working tree changes.

## Verification

For implementation work, run the relevant focused tests and then, when the change warrants the full gate:

```text
npm run typecheck
npm run lint
npm run test
npm run build
```

Passing automated checks is evidence, not proof of production readiness. Record any browser, Android device, signing, provider, or release validation that remains pending.
