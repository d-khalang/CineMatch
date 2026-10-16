# CineMatch autonomous agent loop

The operating contract for the closed development loop. Every agent in the loop follows it. Product direction lives in `docs/vision.md`; the release spec is `cinematch_v1.1.0.md`.

## Roles

| Role | Runs as | Owns |
| --- | --- | --- |
| Owner | Human | Vision, `owner-directive` issues, merging `agents/integration` into `main`, releases |
| Coordinator | Claude Opus (local Claude Code session on a loop) | Planning, priorities, merge decisions on `agents/integration`, escalation, retry decisions. The only role that reads `owner-directive` |
| Reviewer | Claude Sonnet subagent, one per PR | Verdict `PASS` or `CHANGES` with findings, against the issue's acceptance criteria |
| User persona | Claude Sonnet subagent | Feedback as a target user of the merged product, judged against `docs/vision.md` |
| Critic | Claude Sonnet subagent | Product, UX and engineering critique: regressions, inconsistency, scope drift, debt |
| Developer | Gemini via the local Antigravity worker (`automation/linear-antigravity`), two lanes | Implements one scoped Linear issue per run and opens a draft PR |
| Backup developer | Claude Sonnet subagent in its own worktree; Opus only by Coordinator decision | Takes an issue after Gemini fails twice |

The persona and critic advise; the Coordinator decides. Their findings become Linear issues only after Coordinator triage.

## Branches

- `agents/integration` is the loop's output branch. All worker branches start from it and all loop PRs target it.
- Worker branches: `codex/antigravity-<issue-id>`. A rework issue starts from the branch it fixes (see Rework).
- The Coordinator squash-merges passing PRs into `agents/integration`. Nothing in the loop merges into `main`, rewrites history, or force-pushes.

## Linear contract (team CineMatch)

States: `Backlog` → `Todo` → `In Progress` (worker) → `In Review` (PR open) → `Done` (merged to `agents/integration`) or `Canceled`.

| Label | Meaning |
| --- | --- |
| `loop` | Created or adopted by the loop |
| `antigravity-ready` | Dispatch to worker lane A (only on `Todo` leaf issues) |
| `antigravity-ready-b` | Dispatch to worker lane B |
| `owner-directive` | Owner input. Coordinator only; it outranks everything else except this contract |
| `needs-owner` | Coordinator escalation. The loop continues with other work while it waits |
| `feedback` | Originated from the user persona or critic |
| `loop-stop` | Kill switch. When present on the milestone issue, the Coordinator stops dispatching and ends the loop |

Each loop milestone has a parent issue. The Coordinator posts one short comment per cycle there: merged, sent back, escalated, next.

## Issue contract

Every dispatched issue contains: Goal, Context and decision, Scope, Constraints, Acceptance criteria, Verification, Dependencies, Review focus. Sized for one Gemini run (well under 30 minutes). Two concurrently dispatched issues must not touch the same files.

**Frozen acceptance tests** (adopted after M1: both large M1 issues needed three passes, and some tests were bent to fit the code). For logic issues, the Coordinator or a Sonnet agent first commits to `agents/integration`:
- the interface stub, if it is new
- the failing acceptance and fixture tests, including one end-to-end test across dependent modules

The worker implements until those tests pass. It may add tests, but it must not edit or weaken the frozen ones. The PR description maps each acceptance criterion to the test that proves it. Parallel issues that share an interface get that interface frozen first.

**Gemini runs without terminal commands.** A run where Gemini attempted a command is rejected by the worker, even when Gemini reports success. Issue text must never ask Gemini to run anything.

## Rework

The worker cannot revise an existing PR. To send work back, the Coordinator creates a rework issue:

- Title `<original id> rework N: <title>`, related to the original.
- First description line `Branch from: codex/antigravity-<original id>` so the worker continues on top of the original commits.
- The reviewer findings as acceptance criteria.

When the rework PR merges, the Coordinator closes the original PR and marks both issues `Done`.

## Attempts and escalation

- Gemini gets two attempts per issue (the original plus one rework). A worker run that fails its checks counts as an attempt.
- After the second failure the Coordinator either rescopes the issue smaller or hands it to the backup developer (Sonnet). Opus is reserved for architecture-heavy work.
- Product scope, privacy, billing, destructive data migration, credential handling or release decisions get `needs-owner`, never a guess.

## Coordinator cycle

1. Stop if the milestone issue has `loop-stop`. Read open `owner-directive` issues first.
2. For each `In Review` issue: run the Reviewer on its PR. `PASS` → mark ready, squash-merge into `agents/integration`, mark `Done`, unblock dependents. `CHANGES` → rework issue or escalate per the attempt rules.
3. For each `In Progress` issue whose worker run stopped with an error: diagnose, then rework, rescope or escalate.
4. After every third merge: run the user persona and critic on `agents/integration`, then triage their findings.
5. Keep each lane at one or two `Todo` issues, in dependency order.
6. Post the cycle comment on the milestone issue.

## State and resume

Durable loop state lives in Linear, never in a session. Every cycle comment on the milestone issue ends with a state line:

`State: merges N | attempts CIN-x 1, CIN-y 2 | lane A CIN-x | lane B idle | Claude: coordinator + reviewer`

To resume in a new Coordinator session: read this file, `docs/vision.md`, and the latest milestone comments. Then start one worker per lane from the main checkout (they stop when the session that started them ends):

```bash
AGY_BASE_BRANCH=agents/integration AGY_WORK_ROOT="$TEMP/cinematch-agy-a" node automation/linear-antigravity/worker.mjs --watch
AGY_DISPATCH_LABEL=antigravity-ready-b AGY_BASE_BRANCH=agents/integration AGY_WORK_ROOT="$TEMP/cinematch-agy-b" node automation/linear-antigravity/worker.mjs --watch
```

A check failure that one line fixes may be fixed directly by the Coordinator in the worker's retained workspace, as long as it reruns the checks before pushing. Workers now attempt up to two repair passes on their own first.

## Constraints that bind every role

- Client-first and BYOK. No application backend, proxy or shared credential.
- Never put real credentials in code, issues, comments, logs or `.env` files. Tests use mocked providers.
- Passing automated checks is evidence, not proof. Record browser, device and provider checks that remain pending.
