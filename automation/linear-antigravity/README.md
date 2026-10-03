# Linear → Antigravity local worker

The worker polls the CineMatch Linear team every 60 seconds. It picks up issues in **Todo** with the **antigravity-ready** label, moves them to **In Progress**, runs the locally signed-in Antigravity CLI in a fresh clone, runs the app checks, and opens a **draft** GitHub PR. It then moves the issue to **In Review**. A failed run leaves the issue In Progress with an error comment; move it back to Todo only when you want to retry.

This is a local bridge, not a native Linear agent. It runs only while this computer and the worker process are on. No public webhook endpoint is needed.

Planning and review are governed by the repository's `AGENTS.md` and the repo scoped `.codex/skills/cinematch-tech-lead/SKILL.md`. Active issues labeled `codex-cordinate` belong to the Codex coordination queue. The worker implements only fully scoped leaf issues carrying `antigravity-ready`; it does not decompose owner direction, review PRs, or merge them.

## One-time setup

1. The CineMatch team, the two projects, the `antigravity-ready` team issue label, and the GitHub connection are present in Linear. The worker uses its existing **Todo**, **In Progress**, and **In Review** states.
2. A CineMatch-only personal Linear API key has been created with Read, Create issues, and Create comments permissions. Copy it from Linear's one-time display and save it locally with the masked PowerShell prompt below. Run this command from the repository root (`C:\Users\Noor\Desktop\Programming\Git\movie-recom`); the relative file path will not work from `C:\Users\Noor`. The team UUID is configured in the worker. If you move to a different Windows account, create and save a new key there.

   ```powershell
   Read-Host 'Paste Linear key' -AsSecureString | ConvertFrom-SecureString | Set-Content -LiteralPath '.\automation\linear-antigravity\linear-key.local'
   ```

   The resulting `.local` file is encrypted for your Windows account and ignored by Git. The prompt does not put the key in shell history. The worker uses Windows PowerShell to decrypt it.
3. Create a fine-grained GitHub token scoped to `d-khalang/CineMatch` with **Pull requests: read/write**. Copy it, then save it once in your Windows PowerShell session:

   ```powershell
   $token = (Get-Clipboard -Raw).Trim()
   if ($token -notmatch '^github_pat_[A-Za-z0-9_]+$') { throw 'Copy the fine-grained GitHub token first' }
   ConvertTo-SecureString $token -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -LiteralPath 'C:\Users\Noor\Desktop\Programming\Git\movie-recom\automation\linear-antigravity\github-token.local'
   Remove-Variable token
   Set-Clipboard -Value ''
   ```

   The worker loads this Git-ignored, Windows-encrypted file automatically. Separately, sign in to Git on this computer with repository write access so `git push` can use your existing Git credential manager.
4. Run `agy` interactively once and sign in. The worker reuses that cached sign-in and attaches each fresh clone with `--add-dir`, so Antigravity can read and edit it with workspace file tools. The worker runs shell-based checks itself. If headless work still reports a denied tool, use scoped rules, not blanket approval.
5. From the repository root, inspect the queue, then start the worker:

   ```powershell
   node .\automation\linear-antigravity\worker.mjs --dry-run
   node .\automation\linear-antigravity\worker.mjs --watch
   ```

   `--dry-run` queries Linear and prints eligible issues without changing them. `--watch` stays running. Without either flag, it processes the current queue once. Only one worker can run at a time on this computer.

## Issue handoff

Write acceptance criteria in the issue description. Once the issue is ready to implement, set its state to **Todo** and add `antigravity-ready`. The worker starts automatically on its next poll. The issue ID goes into the branch and PR title so Linear can link them.

The worker runs `npm ci`, `npm run typecheck`, `npm run lint`, `npm run test`, and `npm run build` before it pushes a branch. It never merges a PR. A reviewer should inspect the diff, exercise the affected user flow, and decide whether the evidence meets the issue's acceptance criteria.

GitHub attributes the PR creation to the owner of the saved GitHub token. Commits use the unlinked `CineMatch Antigravity Worker <worker@cinematch.invalid>` identity, which is a label rather than a separate GitHub account.

## Configuration

Optional environment variables: `LINEAR_TEAM_ID` (default `b4898ae2-0dec-44fc-a31a-1287e3d0a14b`), `AGY_GITHUB_REPO` (`owner/repo`, default `d-khalang/CineMatch`), `AGY_BASE_BRANCH` (`main`), `AGY_READY_STATE` (`Todo`), `AGY_ACTIVE_STATE` (`In Progress`), `AGY_REVIEW_STATE` (`In Review`), `AGY_DISPATCH_LABEL` (`antigravity-ready`), `AGY_POLL_SECONDS` (`60`), `AGY_BIN` (`agy`), and `AGY_WORK_ROOT` (system temp directory). All values in parentheses are defaults.

The worker retains a failed clone under `AGY_WORK_ROOT` for diagnosis and removes a successful clone. It creates `worker.lock` there to prevent duplicate local workers. If the process crashes, remove that lock only after confirming no worker is still running.
