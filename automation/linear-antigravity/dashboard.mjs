// Loop dashboard: one local page showing every agent interaction, its state, timing and history.
// Reads Linear (saved key), GitHub (gh CLI) and the worker lane folders. Binds to 127.0.0.1 only.
//   node automation/linear-antigravity/dashboard.mjs   → http://127.0.0.1:4317
import { execFile } from 'node:child_process';
import { readFile, stat, open } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLinearKey } from './secret.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.DASHBOARD_PORT) || 4317;
const teamId = process.env.LINEAR_TEAM_ID || 'b4898ae2-0dec-44fc-a31a-1287e3d0a14b';
const repo = process.env.AGY_GITHUB_REPO || 'd-khalang/CineMatch';
const milestone = process.env.LOOP_MILESTONE || 'CIN-5';
const refreshMs = Math.max(30, Number(process.env.DASHBOARD_SECONDS) || 60) * 1000;
const lanes = {
  A: { label: 'antigravity-ready', root: process.env.AGY_WORK_ROOT_A || path.join(os.tmpdir(), 'cinematch-agy-a') },
  B: { label: 'antigravity-ready-b', root: process.env.AGY_WORK_ROOT_B || path.join(os.tmpdir(), 'cinematch-agy-b') },
};
const key = process.env.LINEAR_API_KEY || await loadLinearKey();
if (!key) throw new Error('No Linear key: save linear-key.local (see README) or set LINEAR_API_KEY');

async function linear(query, variables = {}) {
  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: key },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json();
  if (!response.ok || payload.errors?.length) throw new Error(`Linear: ${payload.errors?.map((e) => e.message).join('; ') || response.status}`);
  return payload.data;
}

function gh(args) {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(new Error(`gh: ${(stderr || error.message).trim().slice(0, 300)}`));
      else resolve(stdout);
    });
  });
}

// Linear caps query complexity at 10000, so pages stay small.
async function fetchIssues() {
  const issues = [];
  let after = null;
  do {
    const data = await linear(`query($team: String!, $after: String) {
      team(id: $team) { issues(first: 25, after: $after, orderBy: updatedAt) {
        nodes {
          id identifier title url priority createdAt updatedAt completedAt canceledAt
          state { name type } labels { nodes { name } } parent { identifier }
          history(first: 25) { nodes { createdAt fromState { name } toState { name } addedLabels { name } removedLabels { name } } }
          comments(first: 25) { nodes { id createdAt body botActor { name } } }
        }
        pageInfo { hasNextPage endCursor }
      } }
    }`, { team: teamId, after });
    const page = data.team.issues;
    issues.push(...page.nodes);
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  return issues;
}

async function fetchMilestone() {
  const data = await linear(`query($id: String!) { issue(id: $id) {
    identifier title url labels { nodes { name } } comments(first: 100) { nodes { createdAt body } }
  } }`, { id: milestone });
  return data.issue;
}

async function fetchPulls() {
  const [owner, name] = repo.split('/');
  const out = await gh(['api', 'graphql', '-f', `query=query{repository(owner:"${owner}",name:"${name}"){pullRequests(last:40){nodes{
    number title url state isDraft createdAt mergedAt closedAt headRefName
    comments(last:20){nodes{author{login} createdAt body}}
    reviews(last:10){nodes{author{login} submittedAt comments(first:30){nodes{body}}}}
  }}}}`]);
  return JSON.parse(out).data.repository.pullRequests.nodes;
}

async function laneStatus(lane) {
  const result = { running: false, logAt: null, logLine: null };
  try { await stat(path.join(lane.root, 'worker.lock')); result.running = true; } catch { /* no lock: lane stopped */ }
  try {
    const logPath = path.join(lane.root, 'worker.log');
    const info = await stat(logPath);
    result.logAt = info.mtime.toISOString();
    const handle = await open(logPath, 'r');
    try {
      const size = Math.min(info.size, 4000);
      const { buffer } = await handle.read(Buffer.alloc(size), 0, size, info.size - size);
      const lines = buffer.toString('utf8').split(/\r?\n/).map((l) => l.trim())
        .filter((l) => l && !/^(remote:|To https|\s*\*|branch ')/.test(l));
      result.logLine = lines.at(-1)?.slice(0, 200) || null;
    } finally { await handle.close(); }
  } catch { /* no log yet */ }
  return result;
}

const has = (issue, label) => issue.labels.nodes.some((l) => l.name === label);
const laneOf = (issue) => (has(issue, lanes.B.label) ? 'B' : has(issue, lanes.A.label) ? 'A' : null);
const prNumberOf = (issue, pulls) => {
  const branch = `codex/antigravity-${issue.identifier.toLowerCase()}`;
  return pulls.filter((p) => p.headRefName === branch).sort((a, b) => b.number - a.number)[0];
};

// Every Linear write comes from one API key, so the actor is inferred from what happened.
function commentActor(issue, body, botActor) {
  if (botActor) return botActor.name;
  if (/^Antigravity worker|^Draft PR:/.test(body)) return `Gemini ${laneOf(issue) || ''}`.trim();
  if (/Coordinator/.test(body.slice(0, 120))) return 'Coordinator';
  if (has(issue, 'owner-directive')) return 'Owner';
  return 'Coordinator';
}

function transitionActor(issue, from, to) {
  if ((from === 'Todo' && to === 'In Progress') || (from === 'In Progress' && to === 'In Review')) return `Gemini ${laneOf(issue) || ''}`.trim();
  return 'Coordinator';
}

const verbs = { 'Todo>In Progress': 'Picked up', 'In Progress>In Review': 'Submitted for review', 'In Review>In Progress': 'Sent back to work', 'In Review>Done': 'Done', 'In Progress>Done': 'Done', 'Backlog>Todo': 'Queued', 'Todo>Backlog': 'Unqueued' };
const transitionText = (from, to) => `${verbs[`${from}>${to}`] || `Moved to ${to}`} (${from || '—'} → ${to})`;

const firstLine = (body) => body.replace(/\*\*/g, '').split(/\r?\n/).map((l) => l.trim()).find(Boolean)?.slice(0, 160) || '';

function codexReview(pr) {
  const summary = pr.comments.nodes.filter((c) => c.author?.login === 'chatgpt-codex-connector').at(-1);
  if (!summary) return pr.isDraft ? null : { status: 'pending' };
  const stateJson = /codex-review-state:v1 (\{.*?\})\s*-->/s.exec(summary.body)?.[1];
  let state = null;
  try { state = JSON.parse(stateJson).code_review; } catch { /* older summary format */ }
  const inline = pr.reviews.nodes.filter((r) => r.author?.login === 'chatgpt-codex-connector').flatMap((r) => r.comments.nodes.map((c) => c.body));
  return {
    status: state?.status || 'completed',
    at: summary.createdAt,
    p1: inline.filter((b) => /\bP1\b/.test(b)).length,
    p2: inline.filter((b) => /\bP2\b/.test(b)).length,
    findings: state?.has_any_findings ?? inline.length > 0,
  };
}

function segmentsFor(issue, now) {
  const changes = issue.history.nodes.filter((h) => h.toState).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let current = changes[0]?.fromState?.name || issue.state.name;
  let since = issue.createdAt;
  const segments = [];
  for (const change of changes) {
    segments.push({ state: current, from: since, to: change.createdAt });
    current = change.toState.name;
    since = change.createdAt;
  }
  segments.push({ state: current, from: since, to: now, open: true });
  return segments.filter((s) => s.to > s.from);
}

async function snapshot() {
  const now = new Date().toISOString();
  const errors = [];
  const settle = (promise, fallback, label) => promise.catch((error) => { errors.push(`${label}: ${error.message}`); return fallback; });
  const [issues, mile, pulls, laneA, laneB] = await Promise.all([
    fetchIssues(),
    settle(fetchMilestone(), null, 'milestone'),
    settle(fetchPulls(), [], 'GitHub'),
    laneStatus(lanes.A),
    laneStatus(lanes.B),
  ]);

  const events = [];
  const cards = issues.map((issue) => {
    const pr = prNumberOf(issue, pulls);
    const comments = issue.comments.nodes.filter((c) => !/comment thread is synced/.test(c.body));
    const attempts = comments.filter((c) => /^Antigravity worker started/.test(c.body)).length;
    const failed = comments.filter((c) => /^Antigravity worker stopped/.test(c.body)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const lastStart = comments.filter((c) => /^Antigravity worker started/.test(c.body)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const segments = segmentsFor(issue, now);
    const kind = has(issue, 'owner-directive') ? 'owner' : has(issue, 'feedback') ? 'feedback' : 'loop';

    events.push({ at: issue.createdAt, issue: issue.identifier, actor: kind === 'owner' ? 'Owner' : 'Coordinator', type: 'created', text: `Created: ${issue.title}` });
    for (const h of issue.history.nodes) {
      if (h.toState) events.push({ at: h.createdAt, issue: issue.identifier, actor: transitionActor(issue, h.fromState?.name, h.toState.name), type: 'state', text: transitionText(h.fromState?.name, h.toState.name), to: h.toState.name });
      for (const l of h.addedLabels || []) if (['needs-owner', 'loop-stop', 'antigravity-ready', 'antigravity-ready-b'].includes(l.name)) {
        events.push({ at: h.createdAt, issue: issue.identifier, actor: 'Coordinator', type: 'label', text: l.name.startsWith('antigravity') ? `Dispatched to lane ${l.name.endsWith('-b') ? 'B' : 'A'}` : `Label + ${l.name}` });
      }
    }
    for (const c of comments) {
      if (issue.identifier === milestone) continue; // cycle comments come from the milestone query below
      if (/^(Antigravity worker started|Draft PR:)/.test(c.body)) continue; // duplicates the state change and the PR event
      events.push({ at: c.createdAt, issue: issue.identifier, actor: commentActor(issue, c.body, c.botActor), type: /stopped:/.test(c.body) ? 'error' : 'comment', text: firstLine(c.body), body: c.body.slice(0, 4000) });
    }
    return {
      id: issue.identifier, title: issue.title, url: issue.url, state: issue.state.name, stateType: issue.state.type,
      kind, lane: laneOf(issue), parent: issue.parent?.identifier || null, priority: issue.priority,
      labels: issue.labels.nodes.map((l) => l.name), createdAt: issue.createdAt, updatedAt: issue.updatedAt,
      since: segments.at(-1)?.from || issue.updatedAt, segments, attempts, lastStartAt: lastStart?.createdAt || null,
      failedAt: failed && (!lastStart || failed.createdAt >= lastStart.createdAt) && issue.state.name === 'In Progress' ? failed.createdAt : null,
      failure: failed ? firstLine(failed.body) : null,
      needsOwner: has(issue, 'needs-owner'),
      pr: pr ? { number: pr.number, url: pr.url, state: pr.isDraft ? 'DRAFT' : pr.state, mergedAt: pr.mergedAt, codex: codexReview(pr) } : null,
    };
  });

  for (const pr of pulls) {
    const issueId = /antigravity-([a-z]+-\d+)/.exec(pr.headRefName)?.[1]?.toUpperCase() || null;
    events.push({ at: pr.createdAt, issue: issueId, pr: pr.number, actor: 'Gemini', type: 'pr', text: `Opened PR #${pr.number}`, url: pr.url });
    if (pr.mergedAt) events.push({ at: pr.mergedAt, issue: issueId, pr: pr.number, actor: 'Coordinator', type: 'merge', text: `Merged PR #${pr.number}`, url: pr.url });
    else if (pr.closedAt) events.push({ at: pr.closedAt, issue: issueId, pr: pr.number, actor: 'Coordinator', type: 'state', text: `Closed PR #${pr.number}`, url: pr.url });
    for (const c of pr.comments.nodes) {
      const codex = c.author?.login === 'chatgpt-codex-connector';
      const review = codex ? codexReview({ ...pr, comments: { nodes: [c] } }) : null;
      events.push({
        at: c.createdAt, issue: issueId, pr: pr.number, actor: codex ? 'Codex' : /^Coordinator/.test(c.body) ? 'Coordinator' : 'Owner',
        type: codex ? 'review' : 'comment', url: pr.url,
        text: codex ? `Review on #${pr.number}: ${review.findings ? `${review.p1} P1 · ${review.p2} P2` : 'no findings'}` : firstLine(c.body),
        body: codex ? null : c.body.slice(0, 4000),
      });
    }
  }

  let loop = { stopped: false, cycles: [] };
  if (mile) {
    const cycles = mile.comments.nodes.filter((c) => !/comment thread is synced/.test(c.body)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    loop = {
      id: mile.identifier, title: mile.title, url: mile.url,
      stopped: mile.labels.nodes.some((l) => l.name === 'loop-stop'),
      stateLine: cycles.map((c) => /^State:.*$/m.exec(c.body)?.[0]).find(Boolean) || null,
      cycles: cycles.map((c) => ({ at: c.createdAt, title: firstLine(c.body), body: c.body.slice(0, 6000) })),
    };
    for (const c of cycles) events.push({ at: c.createdAt, issue: mile.identifier, actor: 'Coordinator', type: 'cycle', text: firstLine(c.body), body: c.body.slice(0, 6000) });
  }

  // A lane's current issue is the one its worker started most recently.
  const active = (lane) => cards.filter((c) => c.lane === lane && c.lastStartAt).sort((a, b) => b.lastStartAt.localeCompare(a.lastStartAt))[0] || null;
  return {
    generatedAt: now, refreshMs, repo, errors,
    loop,
    lanes: { A: { ...laneA, issue: active('A')?.id || null }, B: { ...laneB, issue: active('B')?.id || null } },
    issues: cards,
    events: events.filter((e) => e.at).sort((a, b) => b.at.localeCompare(a.at)),
  };
}

let cache = null;
let inflight = null;
async function current() {
  if (cache && Date.now() - cache.time < refreshMs - 2000) return cache.data;
  inflight ||= snapshot().then((data) => { cache = { time: Date.now(), data }; return data; }).finally(() => { inflight = null; });
  return inflight;
}

http.createServer(async (request, response) => {
  try {
    if (request.url === '/api/state') {
      const data = await current();
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return response.end(JSON.stringify(data));
    }
    if (request.url === '/' || request.url === '/index.html') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return response.end(await readFile(path.join(here, 'dashboard.html')));
    }
    response.writeHead(404).end();
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: error.message }));
  }
}).listen(port, '127.0.0.1', () => console.log(`Loop dashboard: http://127.0.0.1:${port}`));
