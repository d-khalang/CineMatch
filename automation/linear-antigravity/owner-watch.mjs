// Coordinator wake signal: prints one line whenever an owner-directive issue is created or updated
// (including new comments) or the milestone gets the loop-stop label. Run under a Monitor.
import { loadLinearKey } from './secret.mjs';

const endpoint = 'https://api.linear.app/graphql';
const teamId = process.env.LINEAR_TEAM_ID || 'b4898ae2-0dec-44fc-a31a-1287e3d0a14b';
const milestone = process.env.LOOP_MILESTONE || 'CIN-5';
const interval = Math.max(30, Number(process.env.OWNER_WATCH_SECONDS) || 60) * 1000;
const key = process.env.LINEAR_API_KEY || await loadLinearKey();

async function query(text, variables) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: key },
    body: JSON.stringify({ query: text, variables }),
  });
  const payload = await response.json();
  if (!response.ok || payload.errors?.length) throw new Error(payload.errors?.map((e) => e.message).join('; ') || String(response.status));
  return payload.data;
}

const seen = new Map();
let stopped = false;
let first = true;
for (;;) {
  try {
    const data = await query(`query($team: String!, $milestone: String!) {
      team(id: $team) { issues(first: 50, filter: { labels: { name: { eq: "owner-directive" } } }) {
        nodes { identifier title updatedAt state { name } comments(last: 1) { nodes { createdAt } } }
      } }
      issue(id: $milestone) { labels { nodes { name } } }
    }`, { team: teamId, milestone });
    for (const issue of data.team.issues.nodes) {
      const stamp = `${issue.updatedAt}|${issue.comments.nodes[0]?.createdAt || ''}`;
      if (!first && seen.get(issue.identifier) !== stamp) {
        console.log(`owner-directive ${seen.has(issue.identifier) ? 'updated' : 'new'}: ${issue.identifier} (${issue.state.name}) ${issue.title}`);
      }
      seen.set(issue.identifier, stamp);
    }
    const hasStop = data.issue.labels.nodes.some((label) => label.name === 'loop-stop');
    if (hasStop && !stopped) console.log(`loop-stop set on ${milestone}`);
    stopped = hasStop;
    first = false;
  } catch (error) {
    console.error(`owner-watch: ${error instanceof Error ? error.message : error}`);
  }
  await new Promise((resolve) => setTimeout(resolve, interval));
}
