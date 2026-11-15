import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readFile, rm, symlink, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGitHubToken, loadLinearKey } from './secret.mjs';

const endpoint = 'https://api.linear.app/graphql';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function eligible(issue, readyState, dispatchLabel) {
  return issue?.state?.name === readyState &&
    issue.labels?.nodes?.some((label) => label.name === dispatchLabel) &&
    /^[A-Z][A-Z0-9]*-\d+$/.test(issue.identifier);
}

export function branchFor(identifier) {
  if (!/^[A-Z][A-Z0-9]*-\d+$/.test(identifier)) throw new Error('Invalid Linear identifier');
  return `codex/antigravity-${identifier.toLowerCase()}`;
}

export function branchFromFor(issue) {
  // Linear rewrites issue IDs into markdown links, e.g. codex/antigravity-[CIN-6](https://...).
  const line = /^\s*Branch from:\s*(.+)$/im.exec(issue?.description || '')?.[1];
  if (!line) return null;
  const branch = line.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/`/g, '').trim().split(/\s/)[0].toLowerCase();
  if (!/^codex\/antigravity-[a-z][a-z0-9]*-\d+$/.test(branch)) throw new Error('Invalid Branch from line');
  return branch;
}

export function repairPromptFor(issue, failure) {
  return [
    `Your changes for Linear issue ${issue.identifier} fail the repository checks (typecheck, lint, test, build).`,
    'Fix the cause with the smallest change. Do not weaken, skip or delete tests to make them pass, and do not change unrelated files.',
    'Do not commit, push, open a PR, or run terminal commands; the worker reruns the checks.',
    '',
    'Check output (tail):',
    failure.slice(-3000),
  ].join('\n');
}

export function reviewPromptFor(issue, files) {
  return [
    `You are a fresh, strict code reviewer for Linear issue ${issue.identifier}: ${issue.title}. Another agent implemented it; the repository checks currently pass.`,
    '',
    'Issue (the acceptance criteria are the contract):',
    issue.description || '(No description supplied.)',
    '',
    'Changed files:',
    ...files.map((file) => `- ${file}`),
    '',
    'Read the changed files and the code they touch. Look for blocking problems:',
    '- acceptance criteria not met, or met only for the default options',
    '- unbounded or unfairly shared resources (request budgets, loops, caches), races, cancellation gaps',
    '- tests that are weak, tautological, or do not prove the criterion they name; missing edge cases (empty, NaN, single item)',
    '- scope creep, behavior changes outside the issue, credentials or new network destinations',
    'Fix every blocking problem directly in code and tests. Never weaken, skip or delete a test to make it pass.',
    'Do not commit, push, open a PR, or run terminal commands; the worker reruns the checks.',
    'End your response with "REVIEW SUMMARY:" followed by a short list of what you found, what you fixed, and any remaining risk.',
  ].join('\n');
}

// The work already passed its checks, so a self-review that calls RunCommand is dropped rather than failing the run.
export async function reviewOrDiscard(review, restore) {
  try {
    return await review();
  } catch (error) {
    if (!error?.deniedCommand) throw error;
    await restore();
    return null;
  }
}

export const DENIED_COMMAND_REMINDER = 'Your previous attempt called RunCommand, which is not available, so it stopped before editing anything. Start again and use only the workspace file tools to search, read and edit files.';

export function promptFor(issue) {
  return [
    `Implement Linear issue ${issue.identifier}: ${issue.title}`,
    '',
    issue.description || '(No description supplied.)',
    '',
    'Work only in this repository. Follow its existing architecture and instructions.',
    'Product direction is in docs/vision.md when present; follow it for user-facing choices.',
    'Make the smallest complete change that meets the issue acceptance criteria.',
    'Add meaningful regression coverage for behavior changes.',
    'Do not commit, push, open a PR, change credentials, or alter unrelated files.',
    'Use the workspace file tools to inspect and edit files; do not run terminal commands.',
    'RunCommand is unavailable and any call to it fails the run, including read-only searches such as grep, find, ls or cat. Search and read with the file tools only.',
    'The worker runs the repository checks after your edits. Report any incomplete work clearly.',
  ].join('\n');
}

function settings(env = process.env, dryRun = false) {
  const required = dryRun ? ['LINEAR_API_KEY'] : ['LINEAR_API_KEY', 'GITHUB_TOKEN'];
  const missing = required.filter((key) => !env[key]);
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  const repo = env.AGY_GITHUB_REPO || 'd-khalang/CineMatch';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('AGY_GITHUB_REPO must be owner/repo');
  const interval = Number(env.AGY_POLL_SECONDS || 60);
  if (!Number.isFinite(interval) || interval < 30) throw new Error('AGY_POLL_SECONDS must be at least 30');
  return {
    linearKey: env.LINEAR_API_KEY,
    teamId: env.LINEAR_TEAM_ID || 'b4898ae2-0dec-44fc-a31a-1287e3d0a14b',
    githubToken: env.GITHUB_TOKEN,
    repo,
    repoUrl: `https://github.com/${repo}.git`,
    base: env.AGY_BASE_BRANCH || 'main',
    ready: env.AGY_READY_STATE || 'Todo',
    active: env.AGY_ACTIVE_STATE || 'In Progress',
    review: env.AGY_REVIEW_STATE || 'In Review',
    label: env.AGY_DISPATCH_LABEL || 'antigravity-ready',
    interval,
    bin: env.AGY_BIN || 'agy',
    model: env.AGY_MODEL || '',
    testWorkers: Math.max(1, Number(env.AGY_TEST_WORKERS) || 3),
    repairPasses: Math.min(3, Math.max(0, Number(env.AGY_REPAIR_PASSES ?? 2))),
    selfReview: env.AGY_SELF_REVIEW !== '0',
    depsSource: env.AGY_DEPS_SOURCE || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
    workRoot: env.AGY_WORK_ROOT || path.join(os.tmpdir(), 'cinematch-antigravity'),
  };
}

async function linear(config, query, variables = {}) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: config.linearKey },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json();
  if (!response.ok || payload.errors?.length) {
    throw new Error(`Linear API: ${payload.errors?.map((e) => e.message).join('; ') || response.status}`);
  }
  return payload.data;
}

async function listReady(config) {
  const issues = [];
  let cursor = null;
  do {
    const data = await linear(config, `query($team: String!, $after: String, $ready: String!, $label: String!) {
      team(id: $team) {
        id
        states { nodes { id name } }
        issues(first: 50, after: $after, filter: {
          state: { name: { eq: $ready } }
          labels: { name: { eq: $label } }
        }) {
          nodes { id identifier title description url state { name } labels { nodes { name } } }
          pageInfo { hasNextPage endCursor }
        }
      }
    }`, { team: config.teamId, after: cursor, ready: config.ready, label: config.label });
    if (!data.team) throw new Error('Linear team not found or key lacks access');
    const states = data.team.states.nodes;
    const page = data.team.issues;
    issues.push(...page.nodes.filter((issue) => eligible(issue, config.ready, config.label)));
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    if (!cursor) return { issues, states };
  } while (true);
}

async function move(config, issueId, stateId) {
  const data = await linear(config, `mutation($id: String!, $state: String!) {
    issueUpdate(id: $id, input: { stateId: $state }) { success }
  }`, { id: issueId, state: stateId });
  if (!data.issueUpdate.success) throw new Error('Linear status update failed');
}

async function comment(config, issueId, body) {
  const data = await linear(config, `mutation($id: String!, $body: String!) {
    commentCreate(input: { issueId: $id, body: $body }) { success }
  }`, { id: issueId, body });
  if (!data.commentCreate.success) throw new Error('Linear comment failed');
}

function command(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false, env: agentEnvironment(), ...options });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout = (stdout + chunk).slice(-100_000); process.stdout.write(chunk); });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-100_000); process.stderr.write(chunk); });
    child.on('error', reject);
    // tsc and eslint report on stdout, so failures carry both streams for repair prompts.
    child.on('close', (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(`${executable} exited ${code}: ${(stdout.slice(-2500) + '\n' + stderr.slice(-1000)).trim()}`)));
  });
}

function agentEnvironment() {
  const env = { ...process.env };
  delete env.LINEAR_API_KEY;
  delete env.GITHUB_TOKEN;
  env.GIT_TERMINAL_PROMPT = '0';
  return env;
}

// npm ci takes minutes per clone; link the main checkout's node_modules when the lockfile is identical.
async function prepareDependencies(config, folder, install) {
  // Normalize line endings: the main checkout may use CRLF while fresh clones use LF.
  const lock = (dir) => readFile(path.join(dir, 'package-lock.json'), 'utf8').then((text) => text.replace(/\r\n/g, '\n')).catch(() => null);
  const [ours, shared] = await Promise.all([lock(folder), lock(config.depsSource)]);
  const source = path.join(config.depsSource, 'node_modules');
  if (ours && ours === shared && existsSync(source)) {
    await symlink(source, path.join(folder, 'node_modules'), 'junction');
    console.log(`Linked node_modules from ${config.depsSource}`);
    return;
  }
  await install();
}

async function unlinkSharedDependencies(folder) {
  const link = path.join(folder, 'node_modules');
  const stats = await lstat(link).catch(() => null);
  if (stats?.isSymbolicLink()) await unlink(link);
}

async function removeSuccessfulWorkspace(workRoot, folder) {
  const root = path.resolve(workRoot);
  const target = path.resolve(folder);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to remove workspace outside ${root}`);
  }
  await unlinkSharedDependencies(target);
  await rm(target, { recursive: true, force: true });
}

async function githubPr(config, issue, branch, review = '') {
  const response = await fetch(`https://api.github.com/repos/${config.repo}/pulls`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${config.githubToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: `${issue.identifier}: ${issue.title}`,
      head: branch,
      base: config.base,
      draft: true,
      body: `Linear: ${issue.url}\n\nGenerated by the local Antigravity worker. Review the diff and CI before merging.${review ? `\n\n## Gemini self-review\n\n${review.slice(0, 4000)}` : ''}`,
    }),
  });
  const data = await response.json();
  if (!response.ok || !data.html_url) throw new Error(`GitHub PR creation failed: ${response.status} ${data.message || ''}`);
  return data.html_url;
}

async function implement(config, issue) {
  const branch = branchFor(issue.identifier);
  const folder = await mkdtemp(path.join(config.workRoot, `${issue.identifier}-`));
  console.log(`Workspace: ${folder}`);
  const start = branchFromFor(issue) || config.base;
  await command('git', ['clone', '--depth', '1', '--branch', start, config.repoUrl, folder]);
  await command('git', ['switch', '-c', branch], { cwd: folder });
  const runAgent = async (prompt) => {
    const output = await command(config.bin, [
      '--add-dir', folder,
      '-p', prompt,
      '--mode', 'accept-edits',
      '--output-format', 'json',
      '--print-timeout', '30m',
      '--sandbox',
      ...(config.model ? ['--model', config.model] : []),
    ], { cwd: folder, env: agentEnvironment() });
    const result = JSON.parse(output);
    if (result.status !== 'SUCCESS' || result.denied_actions?.length || !result.response?.trim()) {
      const error = new Error(`Antigravity did not complete: ${result.status}; denied actions: ${JSON.stringify(result.denied_actions || [])}`);
      error.deniedCommand = result.denied_actions?.some((item) => item.action === 'command');
      throw error;
    }
    return result.response.trim();
  };
  try {
    await runAgent(promptFor(issue));
  } catch (error) {
    // A command denied before any edit (usually a search) ends the run early; retry once with a reminder.
    if (!error.deniedCommand || await command('git', ['status', '--porcelain'], { cwd: folder })) throw error;
    console.log(`Retrying ${issue.identifier} after a denied command`);
    await runAgent(`${promptFor(issue)}\n\n${DENIED_COMMAND_REMINDER}`);
  }
  const changes = await command('git', ['status', '--porcelain'], { cwd: folder });
  if (!changes) throw new Error('Antigravity produced no file changes');
  const npm = process.platform === 'win32' ? 'cmd.exe' : 'npm';
  const npmArgs = (args) => process.platform === 'win32' ? ['/d', '/s', '/c', 'npm.cmd', ...args] : args;
  await prepareDependencies(config, folder, () => command(npm, npmArgs(['ci']), { cwd: folder }));
  const runChecks = async () => {
    for (const script of ['typecheck', 'lint', 'test', 'build']) {
      if (script !== 'test') { await command(npm, npmArgs(['run', script]), { cwd: folder }); continue; }
      // jsdom-heavy suite; bound workers and retry once so machine load does not fail a run.
      const testArgs = npmArgs(['run', 'test', '--', `--maxWorkers=${config.testWorkers}`]);
      try { await command(npm, testArgs, { cwd: folder }); } catch { await command(npm, testArgs, { cwd: folder }); }
    }
  };
  // Antigravity cannot run commands itself, so feed check failures back for bounded repair passes.
  const checkAndRepair = async () => {
    for (let attempt = 0; ; attempt++) {
      try { await runChecks(); return; } catch (error) {
        if (attempt >= config.repairPasses) throw error;
        const failure = error instanceof Error ? error.message : String(error);
        console.log(`Repair pass ${attempt + 1} for ${issue.identifier}`);
        await runAgent(repairPromptFor(issue, failure));
      }
    }
  };
  await checkAndRepair();
  // A fresh Antigravity session reviews and fixes the work before the Coordinator's review.
  let review = '';
  if (config.selfReview) {
    const tree = async () => { await command('git', ['add', '-A'], { cwd: folder }); return command('git', ['write-tree'], { cwd: folder }); };
    const before = await tree();
    const files = (await command('git', ['diff', '--cached', '--name-only', 'HEAD'], { cwd: folder })).split('\n').filter(Boolean);
    console.log(`Self-review for ${issue.identifier}`);
    review = await reviewOrDiscard(
      () => runAgent(reviewPromptFor(issue, files)),
      // New files are staged by tree(), so read-tree -u also removes them.
      async () => { await tree(); await command('git', ['read-tree', '--reset', '-u', before], { cwd: folder }); },
    );
    if (review === null) {
      console.log(`Self-review for ${issue.identifier} called RunCommand; discarded its edits`);
      review = 'Skipped: the self-review called RunCommand, so its edits were discarded. The checked work is unchanged.';
    } else if (await tree() !== before) await checkAndRepair();
  }
  await command('git', ['add', '-A'], { cwd: folder });
  await command('git', ['diff', '--cached', '--check'], { cwd: folder });
  await command('git', ['-c', 'user.name=CineMatch Antigravity Worker', '-c', 'user.email=worker@cinematch.invalid', 'commit', '-m', `${issue.identifier}: ${issue.title}`], { cwd: folder });
  await command('git', ['push', '-u', 'origin', branch], { cwd: folder });
  const url = await githubPr(config, issue, branch, review);
  await removeSuccessfulWorkspace(config.workRoot, folder);
  return { url };
}

async function runOnce(config, dryRun) {
  const { issues, states } = await listReady(config);
  const state = (name) => {
    const match = states.filter((item) => item.name.toLowerCase() === name.toLowerCase());
    if (match.length !== 1) throw new Error(`Expected one Linear state named ${name}; found ${match.length}`);
    return match[0].id;
  };
  const activeId = state(config.active);
  const reviewId = state(config.review);
  for (const issue of issues) {
    if (dryRun) { console.log(`Would run ${issue.identifier}: ${issue.title}`); continue; }
    await move(config, issue.id, activeId);
    await comment(config, issue.id, 'Antigravity worker started. It will open a draft PR after checks pass.');
    try {
      const result = await implement(config, issue);
      await comment(config, issue.id, `Draft PR: ${result.url}\n\nTypecheck, lint, tests, and build passed. Review is required before merging.`);
      await move(config, issue.id, reviewId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await comment(config, issue.id, `Antigravity worker stopped: ${message.slice(0, 1200)}\n\nIssue remains In Progress for investigation. No automatic retry will occur.`);
      console.error(`${issue.identifier}: ${message}`);
    }
  }
  if (!issues.length) console.log('No ready Antigravity issues.');
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const env = { ...process.env };
  if (!env.LINEAR_API_KEY) env.LINEAR_API_KEY = await loadLinearKey();
  if (!dryRun && !env.GITHUB_TOKEN) env.GITHUB_TOKEN = await loadGitHubToken();
  const config = settings(env, dryRun);
  const watch = process.argv.includes('--watch');
  await mkdir(config.workRoot, { recursive: true });
  const lockPath = path.join(config.workRoot, 'worker.lock');
  let lock;
  try { lock = await open(lockPath, 'wx'); } catch { throw new Error(`Worker lock exists: ${lockPath}`); }
  try {
    do {
      try { await runOnce(config, dryRun); } catch (error) { console.error(error); if (!watch) throw error; }
      if (watch) await sleep(config.interval * 1000);
    } while (watch);
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
