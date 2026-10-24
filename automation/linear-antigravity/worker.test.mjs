import assert from 'node:assert/strict';
import test from 'node:test';
import { branchFor, eligible, promptFor } from './worker.mjs';

const issue = {
  identifier: 'CIN-42',
  title: 'Keep saved ratings after restart',
  description: 'Add a regression check for saved ratings.',
  state: { name: 'Ready' },
  labels: { nodes: [{ name: 'antigravity-ready' }] },
};

test('dispatch requires the exact state, label, and a safe issue ID', () => {
  assert.equal(eligible(issue, 'Ready', 'antigravity-ready'), true);
  assert.equal(eligible({ ...issue, state: { name: 'Backlog' } }, 'Ready', 'antigravity-ready'), false);
  assert.equal(eligible({ ...issue, labels: { nodes: [] } }, 'Ready', 'antigravity-ready'), false);
  assert.equal(eligible({ ...issue, identifier: 'CIN-42; rm -rf .' }, 'Ready', 'antigravity-ready'), false);
});

test('branch names and prompts are bounded to an issue', () => {
  assert.equal(branchFor(issue.identifier), 'codex/antigravity-cin-42');
  assert.throws(() => branchFor('bad/branch'));
  const prompt = promptFor(issue);
  assert.match(prompt, /CIN-42: Keep saved ratings/);
  assert.match(prompt, /Do not commit, push, open a PR/);
});

test('rework issues continue from a validated worker branch', async () => {
  const { branchFromFor } = await import('./worker.mjs');
  assert.equal(branchFromFor(issue), null);
  assert.equal(branchFromFor({ description: 'Branch from: codex/antigravity-cin-7\n\nFix review findings.' }), 'codex/antigravity-cin-7');
  assert.throws(() => branchFromFor({ description: 'Branch from: main; rm -rf .' }));
  assert.throws(() => branchFromFor({ description: 'Branch from: ../evil' }));
  assert.equal(branchFromFor({ description: 'Branch from: codex/antigravity-[CIN-6](https://linear.app/x/issue/CIN-6/y)\n\nBody' }), 'codex/antigravity-cin-6');
  assert.equal(branchFromFor({ description: 'Branch from: `codex/antigravity-cin-6`' }), 'codex/antigravity-cin-6');
});

test('repair prompts carry the failure and forbid weakening tests', async () => {
  const { repairPromptFor } = await import('./worker.mjs');
  const prompt = repairPromptFor(issue, 'x'.repeat(5000) + 'error TS2304: Cannot find name');
  assert.match(prompt, /CIN-42/);
  assert.match(prompt, /Do not weaken, skip or delete tests/);
  assert.match(prompt, /error TS2304/);
  assert.ok(prompt.length < 3600);
});

test('self-review prompts carry criteria and changed files and forbid weakening tests', async () => {
  const { reviewPromptFor } = await import('./worker.mjs');
  const prompt = reviewPromptFor(issue, ['src/a.ts', 'src/a.test.ts']);
  assert.match(prompt, /Add a regression check for saved ratings/);
  assert.match(prompt, /- src\/a\.test\.ts/);
  assert.match(prompt, /Never weaken, skip or delete a test/);
  assert.match(prompt, /REVIEW SUMMARY:/);
});

test('a self-review that calls RunCommand is discarded; other failures still fail the run', async () => {
  const { reviewOrDiscard } = await import('./worker.mjs');
  let restored = 0;
  const restore = async () => { restored++; };
  assert.equal(await reviewOrDiscard(async () => 'REVIEW SUMMARY: ok', restore), 'REVIEW SUMMARY: ok');
  assert.equal(restored, 0);
  const denied = Object.assign(new Error('Antigravity did not complete'), { deniedCommand: true });
  assert.equal(await reviewOrDiscard(async () => { throw denied; }, restore), null);
  assert.equal(restored, 1);
  await assert.rejects(reviewOrDiscard(async () => { throw new Error('timeout'); }, restore), /timeout/);
  assert.equal(restored, 1);
});
