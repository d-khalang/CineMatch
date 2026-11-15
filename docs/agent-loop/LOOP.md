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

Every dispatched issue contains: Goal, Context and decision, Scope, Constraints, Acceptance criteria, Verification, Dependencies, Review focus. Sized as one slice a user can notice, not "part 1" plus follow-ups. (The old "well under 30 minutes" size was set for Gemini Flash; Hydrogen handles larger slices.) Two concurrently dispatched issues must not touch the same files.

**Frozen acceptance tests** (adopted after M1: both large M1 issues needed three passes, and some tests were bent to fit the code). For logic issues, the Coordinator or a Sonnet agent first commits to a frozen branch `codex/antigravity-<issue id>`, cut from `agents/integration`:
- the interface stub, if it is new
- the failing acceptance and fixture tests, including one end-to-end test across dependent modules

Failing tests never land on `agents/integration` itself, because they would fail every other lane's checks. The issue's first description line is `Branch from: codex/antigravity-<issue id>`. The worker may start from its own issue's branch (since 2026-11-15); a separate spec issue is still fine when the spec covers several dispatch issues. If `agents/integration` moves before dispatch, bring the frozen branch up to date: rebasing is fine while nobody has built on it, merge otherwise. The Coordinator checks that the reference shape passes the frozen tests before committing them, and runs `tsc` on them.

The worker implements until those tests pass. It may add tests, but it must not edit or weaken the frozen ones. The PR description maps each acceptance criterion to the test that proves it. Parallel issues that share an interface get that interface frozen first.

**Gemini runs without terminal commands.** A run where Gemini attempted a command is rejected by the worker, even when Gemini reports success. Issue text must never ask Gemini to run anything. When an issue needs computed values, such as contrast ratios, the Coordinator computes them and puts them in the issue. If a command is denied before Gemini has edited anything, which usually means a search, the worker retries once with a reminder.

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
2. For each `In Review` issue: mark its PR ready, which starts the `chatgpt-codex-connector` review (about 4 minutes), and run the Reviewer. Merge only when the Reviewer returns `PASS` and the Codex review has completed on the head commit with no unaddressed P1. A Codex P2 is either fixed, filed, or answered on the PR. Then squash-merge into `agents/integration`, mark `Done`, and unblock dependents. `CHANGES` → rework issue or escalate per the attempt rules.
3. For each `In Progress` issue whose worker run stopped with an error: diagnose, then rework, rescope or escalate.
4. **Persona and critic once per window**, after the milestone build. Each files at most three new issues, and each issue names what a user would notice.
5. **No empty lane.** While workers run, scope the next issue and its frozen tests, so each lane always has one `Todo` waiting. Two lanes never hold issues that touch the same files.
6. **Roadmap first.** A free lane takes the next engine roadmap issue, in this order: CIN-9, CIN-22, CIN-10, CIN-12, CIN-49, CIN-8, CIN-11, CIN-25, CIN-13 (and their split-off parts, such as CIN-72). Only an `owner-directive` or a bug a user would hit goes ahead of it.
7. **Follow-ups are capped at one dispatch in three.** Minor review findings go into one running backlog issue per area (for the feed: CIN-52), not one issue each. Fix a one-line finding on the PR itself.
8. Post the cycle comment on the milestone issue.

**At pause:** leave four dispatch-ready issues in Backlog (two per lane, no shared files), so the next window starts by labelling them. The pause comment opens with **What a user would notice**, and says how many commits wait for the owner's merge into `main`.

## State and resume

Durable loop state lives in Linear, never in a session. Every cycle comment on the milestone issue ends with a state line:

`State: merges N | attempts CIN-x 1, CIN-y 2 | lane A CIN-x (idle 4m) | lane B idle (idle 12m) | Claude: coordinator + reviewer`

The worker logs `[HH:MM:SS] CIN-x phase: ...` lines and posts `Timings: ...` on the issue's Draft PR comment. Add each lane's idle minutes in the window to the State line.

To resume in a new Coordinator session: read this file, `docs/vision.md`, and the latest milestone comments. Then start one worker per lane from the main checkout (they stop when the session that started them ends):

```bash
AGY_BASE_BRANCH=agents/integration AGY_WORK_ROOT="$TEMP/cinematch-agy-a" node automation/linear-antigravity/worker.mjs --watch
AGY_DISPATCH_LABEL=antigravity-ready-b AGY_BASE_BRANCH=agents/integration AGY_WORK_ROOT="$TEMP/cinematch-agy-b" node automation/linear-antigravity/worker.mjs --watch
```

The Coordinator also runs `node automation/linear-antigravity/owner-watch.mjs` as a wake signal: it prints a line within about a minute when an `owner-directive` issue is created, updated or commented on, or when `loop-stop` is set on the milestone. Owner input is then handled immediately instead of on the next timed tick.

A check failure that one line fixes may be fixed directly by the Coordinator in the worker's retained workspace, as long as it reruns the checks before pushing. Workers now attempt up to two repair passes on their own first.

## Constraints that bind every role

- Client-first and BYOK. No application backend, proxy or shared credential.
- Never put real credentials in code, issues, comments, logs or `.env` files. Tests use mocked providers.
- Passing automated checks is evidence, not proof. Record browser, device and provider checks that remain pending.
