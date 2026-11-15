import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const secretDirectory = path.dirname(fileURLToPath(import.meta.url));
const decryptScript = '$s=ConvertTo-SecureString ([IO.File]::ReadAllText($env:AGY_SECRET_FILE).Trim()); $p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }';

async function powershell(secretPath) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, AGY_SECRET_FILE: secretPath };
    delete env.LINEAR_API_KEY;
    delete env.GITHUB_TOKEN;
    for (const name of Object.keys(env)) {
      if (name.toLowerCase() === 'psmodulepath') delete env[name];
    }
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', decryptScript], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env,
    });
    let output = '';
    let errors = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { errors += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve(output.trim());
      const category = [
        ['bad encrypted format', /Input string was not in a correct format/i],
        ['decryption rejected', /data is invalid|Key not valid for use in specified state/i],
        ['missing encrypted file', /Could not find|cannot find path/i],
        ['missing file path', /Value cannot be null|Cannot bind argument/i],
        ['PowerShell syntax', /ParserError/i],
      ].find(([, pattern]) => pattern.test(errors))?.[0] || 'unknown';
      reject(new Error(`Windows credential protection failed at ${category} (exit ${code})`));
    });
  });
}

async function loadKey(fileName, pattern, label) {
  const secretPath = path.join(secretDirectory, fileName);
  try { await access(secretPath); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
  const key = await powershell(secretPath);
  if (!pattern.test(key)) throw new Error(`Saved ${label} key is invalid`);
  return key;
}

export function loadLinearKey() {
  return loadKey('linear-key.local', /^lin_api_[A-Za-z0-9]+$/, 'Linear');
}

export function loadGitHubToken() {
  return loadKey('github-token.local', /^github_pat_[A-Za-z0-9_]+$/, 'GitHub');
}
