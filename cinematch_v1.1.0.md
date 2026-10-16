# CineMatch AI — Production Implementation and Release Plan

Version: 1.1.0 (standalone architecture revision) | Date: 2026-09-09 | Supersedes: cinematch_v1.0.0.md and the earlier backend-based draft of v1.1.0

## 1. Agent assignment and scope

Implement this plan in the existing CineMatch repository for the web and Capacitor Android app. Preserve the current product and visual identity while resolving security, data integrity, reliability, accessibility, testing, and release gaps. Work through the phases in order, pairing fixes with meaningful regression tests. This document is an implementation assignment, not evidence that the app is ready to ship.

Read repository instructions and inspect the current code first. The preceding review was a source spot-check, not a runtime audit; reproduce reported defects and record evidence before prescribing platform-specific fixes. Do not assume file line numbers, package versions, bundle sizes, or original audit grades remain current.

Do not publish, deploy, submit to a store, purchase services, rewrite Git history, or commit unrelated changes. Prepare reviewable deployment and signing configuration locally. Continue all independent work if credentials, devices, or external setup are unavailable; report the precise remaining release gate instead of claiming success.

**User-confirmed security status:** The old TMDB API key has been deactivated. Revocation is complete by user report; no shared replacement key is required. History rewriting is not required by this plan. Remove the revoked value from active source and generated release artifacts, prevent new credential exposure, and never print secrets in reports.

## 2. Architecture decisions and boundaries

### 2.1 Standalone, user-supplied credentials — user decision

- The app calls TMDB and the selected AI provider directly from the user's device. Users supply their own TMDB credential and their own AI credential for cloud AI. Do not implement an application backend, proxy, shared credential, app account system, or app-funded provider access for this release.
- Retain local heuristic scoring as an AI-key-free mode. TMDB access still requires the user's TMDB credential for online discovery/search/hydration; local scoring is not fully offline discovery.
- Never place credentials in `VITE_*`, source, configuration examples, or bundled assets. Ignore secret-bearing environment files; any configuration examples contain placeholders only. Add secret detection to CI covering source and distributable artifacts.
- Centralize credential access and direct provider requests. Bound request size, pagination, concurrency, retries, and deadlines. Use fixed trusted provider origins; do not send credentials to arbitrary user-supplied URLs or unrelated hosts. Client throttling controls consumption but cannot enforce server-side security or spending limits.
- Verify current TMDB credential formats and supported authentication for the required endpoints. Clearly distinguish a TMDB API key from an API Read Access Token in the UI and help text; do not send one as the other. Prefer supported header authentication. If supporting API keys requires query authentication, scope and document that exception, redact request URLs everywhere, and explain the tradeoff. Do not invent a header or add a proxy to avoid choosing a supported format.
- Verify direct calls work from the actual browser origin and packaged Android WebView, including preflight/CORS and any native HTTP transport used. A native transport must not be treated as a browser CORS workaround. Report incompatible provider/platform combinations; do not silently change the standalone architecture.

### 2.2 Credential storage and lifecycle — applies to TMDB and AI

- Default browser credentials to session-memory use, not localStorage, sessionStorage, IndexedDB, or service-worker caches. Remove legacy persisted key fields on migration while retaining other settings; tell affected users that they must re-enter their keys. Do not copy secrets into migration backups, telemetry, exports, or logs.
- Session-memory use is also the Android baseline. Offer a remember-on-device option only through a maintained, Keystore-backed implementation validated on a device, including deletion and backup behavior. If that cannot be verified, retain session-only behavior and document it. Browser-side encryption with a key stored alongside the ciphertext is not a solution.
- Provide masked credential fields, intentional reveal, separate test-connection status, replace, and forget actions for each provider. Deleting credentials must not delete ratings/watchlists. Define a separate clear-all-data action that also removes native stored credentials.
- Credential changes/removal invalidate pending connection tests and authenticated requests so outdated success/results cannot overwrite the new credential state. Forgetting a credential must stop automatic retries and background hydration using it. Never use raw credentials as cache keys or diagnostic identifiers.
- Send Gemini keys in `x-goog-api-key`, including connection testing, and OpenRouter keys in the authorization header. Treat these as transport hygiene, not protection from a compromised client.
- Clearly explain which data goes to TMDB and the selected AI provider, that requests use the user's account/quota, and the remaining client-side credential exposure. Validate current provider guidance before production release. If a combination is unsuitable, report the specific release gate rather than introducing server credential custody.

### 2.3 First-run setup and missing-credential behavior

- Add guided setup for the user's TMDB credential and selected AI provider's credential, with links to official credential setup instructions and clear input-format labels. Support local scoring without an AI key. Do not require credentials to view/export already saved ratings or watchlists.
- Disable only operations that require a missing credential and give an actionable Settings link. No startup request may use a placeholder, revoked key, empty credential, or hidden shared fallback.
- Test each connection with a minimal documented request. Explain any AI test that may consume quota. Distinguish invalid credentials from offline, throttled, timed-out, or unavailable-provider states. Do not repeatedly retry authentication failures.
- After a browser reload/session loss, clearly prompt for the needed credentials while preserving user data. Native remembered credentials should restore only through secure storage. Do not imply that a prior successful test guarantees ongoing validity.

**Acceptance:** A fresh install has no built-in credentials and contacts no app-owned backend. Mocked onboarding covers TMDB plus cloud AI and TMDB plus local scoring. Missing/invalid/replaced/forgotten credentials behave correctly; secrets never enter ordinary storage/logs/exports or generated artifacts. Any required TMDB query-auth exception is explicitly documented and redacted. Real direct-call compatibility is verified separately on each supported platform.

## 3. Phase A — Baseline and verification harness (P0)

1. Record repository status without changing unrelated work. Inspect scripts, dependency lockfile, TypeScript settings, native configuration, and existing tests. Reproduce the build and document failures separately from changes introduced by this work.
2. Install compatible versions of Vitest, React Testing Library, jest-dom, user-event, jsdom, MSW, and the matching coverage provider. Use a Vitest-compatible configuration import or a separate test configuration; do not blindly paste unsupported keys into Vite configuration.
3. Add typecheck, lint, test, test:watch, test:coverage, and browser end-to-end scripts. Configure MSW to fail tests on unexpected network requests. Tests must run without real keys or paid provider calls.
4. Add ESLint with TypeScript and React Hooks checks. Preserve existing TypeScript strict mode, remove unsafe boundary types, and enable unused-code checks after addressing findings.
5. Establish CI using the lockfile and pinned runtime/toolchain versions. Run typecheck, lint, unit/integration tests, browser smoke tests, and production build. Include dependency and secret scanning with documented triage of material findings.

**Acceptance:** A clean checkout has documented reproducible commands; required checks fail on real regressions; no live credential is needed for routine CI. Coverage reports identify important untested branches. Do not equate 100% test pass rate with complete product coverage.

## 4. Phase B — State integrity, persistence, and recovery (P0)

### 4.1 Ratings and request races

- Save rating changes immediately. Enrich metadata asynchronously only if the corresponding record/version still exists and remains current. Concurrent updates to different movies must not cancel one another.
- Deletion, clearing data, and import replacement invalidate pending operations that could resurrect old state.
- Add generation identity and cancellation through the complete ranking pipeline: candidate fetching, AI generation, and discovery hydration. Only the active generation may update recommendations, taste analysis, provider label, errors, or loading state.
- Define what happens when ratings/settings change during generation: cancel/invalidate the old generation and require or start a new one consistently. Do not present old-profile results as current.
- Distinguish cancellation from failure; cancellation must not trigger local fallback or show a provider error.

**Tests:** Delayed first rating versus newer rating; delayed enrichment after deletion/reset; simultaneous different-movie edits; old ranking success/error/finally after new generation; settings changes mid-flight; unmount and cancellation.

### 4.2 Persistent data contract

- Centralize storage access. Validate parsed data at runtime, version its schema, and migrate supported older versions. Valid JSON with the wrong structure is invalid input.
- Handle unavailable storage and read/write/remove failures. Keep current in-memory data usable after failed persistence and show a clear unsaved-state message with export/retry where possible.
- Migrations must not silently erase ratings. Validate the new representation before replacing valid prior data; handle interrupted or quota-limited migration safely. Sanitize credential fields separately from data backups.
- Define cross-tab behavior and prevent silent lost updates, using conflict detection or a documented single-writer approach.
- Add a top-level React error boundary with reload/retry recovery that preserves stored ratings. Handle asynchronous/event errors at their source; the boundary is not universal error handling.

**Tests:** Empty/valid/malformed storage, wrong-shape JSON, supported migration, unsupported schema, storage denied/quota exhausted, failed migration, reload persistence, cross-tab conflict, and render-error recovery.

### 4.3 Offline behavior

- Define the initial contract: saved ratings/watchlist remain usable; persist the last successful recommendations with freshness information if offline recommendation display is promised. Persist no credentials with them.
- Web reload offline requires cached app-shell assets; either implement and test their update/version behavior or clearly limit the promise to an already loaded web app. Android bundles its app shell.
- New recommendation generation may require TMDB even when local scoring is selected. Explain unavailable actions and preserve prior results when offline or when the user's TMDB credential is missing/invalid. Do not claim fully offline discovery.
- Prevent repeated hydration loops; bound retries and distinguish missing movies from transient failures.

**Acceptance:** Races cannot restore deleted data or publish outdated results; persistence failure is visible and recoverable; offline behavior matches the documented platform contract.

## 5. Phase C — Provider, import, and recommendation correctness (P1)

### 5.1 Provider/network boundaries

- Validate TMDB and AI responses before use. Enforce object/array shapes, finite scores, allowed recommendation categories, text/tag length limits, and bounded item counts. Deduplicate IDs and require pool-ranked IDs to belong to the candidate pool.
- Resolve unconstrained discoveries against TMDB with bounded concurrency and title/year checks. Reject uncertain matches rather than silently attaching the wrong film. Remove rated movies and duplicates across both streams.
- Prefer supported structured responses where available; robustly handle supported Markdown/reasoning wrappers, empty/truncated/invalid JSON, and invalid field types. Never render provider HTML as trusted markup.
- Apply deadlines to connection checks, search, candidate generation, AI requests, and hydration; enforce an overall generation budget as well as individual timeouts. Compose caller cancellation with deadlines.
- Classify authentication, quota, throttling, network, timeout, validation, and server failures. Use bounded retries only where appropriate, respect Retry-After, and avoid unbounded or surprise billable retries.
- Keep graceful local fallback for eligible failures with an accurate provider label. Handle failure of local fallback and failure before the provider stage. Do not hide persistent misconfiguration behind apparent AI success.

### 5.2 Recommendation logic

- Fix substring franchise collisions using escaped aliases and explicit token normalization. Test punctuation, apostrophes, accents, numerals, subtitles, and unrelated titles such as Author/United. JavaScript word boundaries alone are not a complete multilingual matching policy.
- Prefer reliable collection metadata where available; title stemming must not merge unrelated films merely because a subtitle was removed.
- Retain unit tests for documented heuristic math, edge cases, and score bounds, but also test outcome invariants: no duplicates/rated movies, stable ordering for ties, valid ranks, and sensible behavior for empty/sparse profiles.
- Create a small, fixed evaluation set of representative taste profiles and candidate pools. Document expected properties such as genre affinity, negative preferences, variety, and franchise diversity. Record a qualitative review; do not claim user-validated recommendation quality from formula tests alone.

### 5.3 CSV import/export

- Use a robust CSV parser with tests for actual supported IMDb and Letterboxd headers, BOM, CRLF, embedded commas/newlines, escaped quotes, empty rows, and rating conversions. Verify format fixtures rather than assuming one export header forever.
- Enforce the 2 MB file limit plus row/field limits. Validate finite rating ranges and match by stable IDs where available; surface ambiguous title/year matches.
- Define duplicate handling and merge versus replacement. Show an import preview and accepted/rejected/unmatched counts; avoid silent partial replacement or destructive import.
- Ensure exports round-trip supported data and protect spreadsheet consumers from formula injection in text fields. Exclude credentials. Provide web download and native sharing with temporary-file cleanup.

**Acceptance:** Adversarial and malformed fixtures fail safely; cancellation stops work; fallback remains accurately identified; imports preserve existing data; exports round-trip without secrets.

## 6. Phase D — Browser and Android usability (P1)

1. Reproduce splash behavior on cold/warm launch with logs and current Capacitor documentation. Inspect inherited BridgeActivity theme behavior before adding splash installation code; implement only the verified lifecycle fix.
2. Validate edge-to-edge/system insets, bottom navigation, cutouts, and keyboard behavior on actual target versions. Account for the current native inset configuration before adding CSS padding; avoid double insets. Scroll focused Settings fields and actions into view.
3. Define back navigation: dismiss the topmost modal, navigate within the app, then use platform-consistent root exit behavior. Double-tap exit is optional product behavior, not a production requirement. Clean up native listeners and test gestures/hardware back.
4. Support rotation, large text, narrow viewports, tablets/foldables, and resizable layouts. Do not impose portrait locking as a general fix.
5. Fix web sharing by preparing data before the gesture or sharing an immediately available URL. Handle unsupported file sharing, cancellation, and real failures separately. Use supported Capacitor APIs for Android share/export and test the packaged app.
6. Make rating controls comfortably touchable, aiming for 48 dp Android targets without overflow. Test keyboard selection/reset, labels, focus indicators, modal focus containment/return, screen-reader announcements, contrast, reduced motion, and text scaling.
7. Replace stock launcher/adaptive icons and splash assets while preserving the product identity. Verify mask cropping and light/dark rendering.

**Acceptance:** Critical journeys work in supported browsers and a signed Android release build; accessibility checks include keyboard and manual screen-reader review. Record exact device, OS, WebView/browser, build version, and evidence. Mark unavailable device checks as pending, never passed.

## 7. Phase E — Measured performance and bounded resources (P2)

- Measure initial transferred JS/CSS/fonts, startup, interaction latency, generation latency by stage, and memory on a documented baseline device/network. Record raw versus compressed sizes separately.
- Reduce unused font families/weights and load secondary fonts on demand; consider self-hosting with appropriate licensing. Lazy-load genuinely secondary UI and confetti with usable loading/error states.
- Add image dimensions/aspect ratios and one-shot error fallbacks. Lazy-load offscreen posters; do not blindly lazy-load the primary above-the-fold image.
- Bound TMDB/share caches with eviction and freshness policy. Start with a documented cap such as 200 entries only if measurements support it; test eviction and a long scrolling/searching session. Bound concurrency and pending requests too.
- Remove assets only after checking references. Avoid unrelated refactoring.
- Establish explicit performance budgets in the baseline report before optimization. Suggested initial web targets are LCP <= 2.5 s, INP <= 200 ms, and CLS <= 0.1; distinguish lab proxies from field measurements. Record an overall recommendation deadline and device-specific memory/startup budget. Explain any revised target instead of silently weakening it after failure.

**Acceptance:** Before/after results meet the recorded budgets or identify a release exception for review. Individual chunk size alone is not the performance gate.

## 8. Phase F — Release engineering and operations (P1, before release)

- Document standalone Android configuration and static web hosting configuration where the web build is distributed, including TLS/security headers and restricted content/connect policies compatible with direct provider calls and Capacitor. Verify built assets have no development hosts or credentials. No application API hosting or server secrets are required.
- For Android, build web assets, run Capacitor sync, then build the release bundle. Automate that order to prevent shipping stale bundled JS. Pin/document Node, Java, Android SDK, and Gradle requirements.
- Read release signing secrets from secure external configuration; keep keystores/passwords out of Git. Document upload-key custody, backup, and Play App Signing setup. Missing signing access is a release gate, not permission to invent a keystore password or claim a debug build is production-tested.
- Evaluate R8/minification separately; if enabled, test the minified release and retain mapping artifacts for crash diagnosis. Signing is mandatory for release; minification is not proof of readiness.
- Add sanitized on-device/browser diagnostics with release IDs and a user-initiated diagnostic export. Do not log credentials, authenticated request URLs, raw profiles, or full provider payloads. Record provider fallback, throttling, and failures in bounded diagnostics. External telemetry is optional and disabled by default; standalone release must not depend on a telemetry backend. If explicitly configured later, document consent/privacy behavior and alert routing.
- Document staged rollout and recovery: redeploy a known static web artifact if applicable, preserve storage compatibility, and issue an Android hotfix with a higher version code. Do not assume installed Android clients can be remotely downgraded.
- Verify current store target SDK, signing, data-safety, privacy policy, content-rating, and permission requirements at release time. Inventory actual data flows, including provider transmission and any telemetry. Verify required TMDB attribution/usage conditions and asset licenses. Do not fill declarations using guessed behavior.

**Acceptance:** A reproducible release candidate is identifiable by version and artifact checksum; signing/publishing secrets are external; standalone diagnostics and recovery are documented and tested where available. All external setup still needed is explicitly listed, without an app-backend dependency.

## 9. Required verification matrix

| Layer | Required evidence |
| --- | --- |
| Unit | Heuristics, franchise matching, CSV, schemas/migrations, cache eviction, response validation |
| State/integration | Adversarial request ordering, delete/reset invalidation, storage failures, hydration retry bounds, fallback/cancellation |
| Direct provider clients and credentials | Trusted destinations, credential formats, missing/invalid/replaced/forgotten keys, connection tests, deadlines/throttling, cancellation, secure native storage if enabled, redaction; real browser/WebView compatibility |
| Browser E2E | TMDB + AI setup and TMDB + local mode -> rating -> ranking -> watchlist -> reload/re-enter keys; edit/delete; import/export; provider failure; keyboard/modal flows; documented offline behavior |
| Android release | Cold/warm launch, process restart, keyboard/insets, gestures/back, share/export, offline, rotation/large text, upgrade preserving ratings |
| Security/release | Secret/dependency scan triage, bundle inspection, synchronized native assets, signed-build provenance, configuration and recovery checks |
| Performance/quality | Before/after baseline, budget results, long-session resource behavior, representative recommendation evaluation |

Use deterministic mocks for CI. Supplement them with opt-in provider contract smoke tests using authorized credentials and minimal requests; never run paid tests automatically. Browser automation does not replace native release testing. Empty/skipped suites do not count as evidence.

## 10. Handoff deliverables and definition of done

Deliver implementation plus:

1. `docs/production-readiness.md`: each requirement's status (done/pending/blocked), relevant files, acceptance evidence, and unresolved risks.
2. `docs/verification-report.md`: exact commands and outcomes, toolchain versions, test totals/skips, device/browser matrix, performance results, and recommendation evaluation. Link screenshots/logs/artifacts where practical; redact credentials.
3. `docs/release-runbook.md`: standalone configuration, user credential setup and storage behavior, optional static web hosting, build/sync/signing order, staging checks, distribution steps for later approval, diagnostics, rollback/hotfix, and external account/device requirements. No application backend is required.
4. An updated README, placeholder configuration examples, CI workflows, and tests sufficient for another agent to reproduce the checks.
5. A concise final report: changes, tests actually executed, failures/pending checks, and whether the code is implementation-complete versus release-ready.

**Release gate:** All P0/P1 acceptance criteria pass, critical journeys pass on the release candidate, material security findings are resolved or explicitly reviewed, and operational/store setup is verified. P2 exceptions need documented impact and review. Lack of credentials/devices must remain visible as a pending gate. Do not call the application production-ready solely because compilation and mocked tests pass.

The user will request an independent review after implementation. Leave the work and evidence ready for that review; do not self-approve publication.

## Reference notes

- Vite client environment exposure: https://vite.dev/guide/env-and-mode.html
- Gemini API key guidance: https://ai.google.dev/gemini-api/docs/api-key
- Android 16 adaptive behavior: https://developer.android.com/about/versions/16/behavior-changes-16

These references support architecture corrections from the preceding review. Recheck version-specific SDK/provider/store guidance during implementation and release preparation.
