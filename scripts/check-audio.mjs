// Vérifie sur Windows (CI) que l'assistant de volume compile et répond : le code C# des
// interfaces Core Audio est compilé par PowerShell au premier usage, une erreur n'apparaîtrait
// sinon que chez l'utilisateur. Sur une machine sans carte son, « ok: false » est accepté.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { helperScript } from '../src/main/systemAudio.js';

if (process.platform !== 'win32') {
  console.log('[audio] vérification ignorée (Windows seulement)');
  process.exit(0);
}

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rondelle-audio-')), 'rondelle-audio.ps1');
fs.writeFileSync(file, helperScript(), 'utf8');
const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { windowsHide: true });
let out = '';
let err = '';
let ready = false;
const timer = setTimeout(() => {
  console.error('[audio] délai dépassé', out, err);
  process.exit(1);
}, 90_000);
proc.stderr.on('data', (d) => (err += d));
proc.stdout.on('data', (d) => {
  out += d;
  const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!ready && lines.some((l) => l.includes('"ready"'))) {
    ready = true;
    proc.stdin.write(`${JSON.stringify({ names: ['rondelle-introuvable'], exclude: [process.pid], all: false, factor: 1 })}\n`);
    return;
  }
  const reply = lines.find((l) => l.startsWith('{') && !l.includes('"ready"'));
  if (ready && reply) {
    clearTimeout(timer);
    const msg = JSON.parse(reply);
    console.log('[audio] assistant compilé, réponse :', msg);
    proc.stdin.end();
    process.exit(msg.ok === true || typeof msg.error === 'string' ? 0 : 1);
  }
});
proc.on('exit', (code) => {
  if (ready) return;
  console.error(`[audio] l'assistant s'est arrêté (${code}) :`, err || out);
  process.exit(1);
});
