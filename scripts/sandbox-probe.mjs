#!/usr/bin/env node
// Prints what the build sandbox exposes (runbook agent-runs.md §9). Never prints secret values.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const isSet = (name) => Boolean(process.env[name]);

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 20_000 });
  return r.status === 0;
};

let pid1;
try {
  pid1 = readFileSync('/proc/1/cmdline', 'utf8').split('\0')[0] || '(empty)';
} catch (err) {
  pid1 = `unreadable (${err.code ?? err.message})`;
}

const lines = [
  ['CLAUDE_CODE_OAUTH_TOKEN set', isSet('CLAUDE_CODE_OAUTH_TOKEN')],
  ['ANTHROPIC_API_KEY set', isSet('ANTHROPIC_API_KEY')],
  ['GITHUB_TOKEN set', isSet('GITHUB_TOKEN')],
  ['/proc/1/cmdline (first line)', pid1],
  ['sudo -n true works', run('sudo', ['-n', 'true'])],
  ['curl https://example.com works', run('curl', ['-sS', '-o', '/dev/null', 'https://example.com'])],
  [
    'curl https://registry.npmjs.org works',
    run('curl', ['-sS', '-o', '/dev/null', 'https://registry.npmjs.org']),
  ],
];

for (const [label, value] of lines) console.log(`${label}: ${value}`);
