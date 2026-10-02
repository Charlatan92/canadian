import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Mode surcouche, Windows : baisse le volume d'autres programmes (navigateur, appli du fournisseur
// télé) pendant les pubs, via le mélangeur de volume de Windows (Core Audio). Un petit assistant
// PowerShell compile le code C# ci-dessous une fois, puis reçoit des ordres JSON ligne par ligne.
// Rien à installer : PowerShell et .NET sont présents sur tous les Windows 10/11.

const CSHARP = String.raw`
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace RondelleAudio {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
  class MMDeviceEnumeratorCom {}

  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
  }

  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
  }

  [Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionManager2 {
    int GetAudioSessionControl(IntPtr sessionGuid, int flags, out IntPtr control);
    int GetSimpleAudioVolume(IntPtr sessionGuid, int flags, out IntPtr volume);
    int GetSessionEnumerator(out IAudioSessionEnumerator sessions);
  }

  [Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionEnumerator {
    int GetCount(out int count);
    int GetSession(int index, out IAudioSessionControl2 session);
  }

  [Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl2 {
    int GetState(out int state);
    int GetDisplayName(out IntPtr name);
    int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string value, ref Guid context);
    int GetIconPath(out IntPtr path);
    int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string value, ref Guid context);
    int GetGroupingParam(out Guid param);
    int SetGroupingParam(ref Guid param, ref Guid context);
    int RegisterAudioSessionNotification(IntPtr client);
    int UnregisterAudioSessionNotification(IntPtr client);
    int GetSessionIdentifier(out IntPtr id);
    int GetSessionInstanceIdentifier(out IntPtr id);
    int GetProcessId(out uint pid);
    int IsSystemSoundsSession();
    int SetDuckingPreference(bool optOut);
  }

  [Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface ISimpleAudioVolume {
    int SetMasterVolume(float level, ref Guid context);
    int GetMasterVolume(out float level);
    int SetMute(bool mute, ref Guid context);
    int GetMute(out bool mute);
  }

  public static class Mixer {
    // Volume de chaque programme avant la baisse, pour le remettre exactement
    static readonly Dictionary<uint, float> Baseline = new Dictionary<uint, float>();

    public static string Apply(string[] names, uint[] exclude, bool all, float factor) {
      names = names ?? new string[0];
      exclude = exclude ?? new uint[0];
      var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorCom());
      IMMDevice device;
      Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out device));
      Guid iid = typeof(IAudioSessionManager2).GUID;
      object o;
      Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out o));
      var manager = (IAudioSessionManager2)o;
      IAudioSessionEnumerator sessions;
      Marshal.ThrowExceptionForHR(manager.GetSessionEnumerator(out sessions));
      int count;
      sessions.GetCount(out count);
      int touched = 0;
      for (int i = 0; i < count; i++) {
        IAudioSessionControl2 control;
        if (sessions.GetSession(i, out control) != 0 || control == null) continue;
        uint pid;
        control.GetProcessId(out pid);
        if (pid == 0 || Array.IndexOf(exclude, pid) >= 0 || control.IsSystemSoundsSession() == 0) continue;
        string name;
        try { name = Process.GetProcessById((int)pid).ProcessName.ToLowerInvariant(); } catch { continue; }
        if (!all && Array.IndexOf(names, name) < 0) continue;
        var volume = control as ISimpleAudioVolume;
        if (volume == null) continue;
        float current;
        volume.GetMasterVolume(out current);
        if (!Baseline.ContainsKey(pid)) Baseline[pid] = current;
        Guid context = Guid.Empty;
        volume.SetMasterVolume(Math.Max(0f, Math.Min(1f, Baseline[pid] * factor)), ref context);
        if (factor >= 0.999f) Baseline.Remove(pid);
        touched++;
      }
      return "{\"ok\":true,\"sessions\":" + touched + "}";
    }
  }
}
`;

export function helperScript() {
  return `$ErrorActionPreference = 'Stop'
$code = @'
${CSHARP}
'@
Add-Type -TypeDefinition $code -Language CSharp
[Console]::Out.WriteLine('{"ready":true}')
[Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  try {
    $c = $line | ConvertFrom-Json
    $r = [RondelleAudio.Mixer]::Apply([string[]]@($c.names), [uint32[]]@($c.exclude), [bool]$c.all, [single]$c.factor)
    [Console]::Out.WriteLine($r)
  } catch {
    [Console]::Out.WriteLine((@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress))
  }
  [Console]::Out.Flush()
}
`;
}

export function parseApps(text) {
  return String(text ?? '')
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase().replace(/\.exe$/, ''))
    .filter(Boolean);
}

export class SystemAudio {
  constructor({ dir, ownPids = () => [] }) {
    this.dir = dir;
    this.ownPids = ownPids;
    this.proc = null;
    this.ready = null;
    this.waiting = [];
    this.buffer = '';
    this.factor = 1;
    this.chain = Promise.resolve();
    this.lastError = null;
    this.target = null; // { mode, apps }
  }

  get supported() {
    return process.platform === 'win32';
  }

  #start() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const file = path.join(this.dir, 'rondelle-audio.ps1');
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(file, helperScript(), 'utf8');
      const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { windowsHide: true });
      this.proc = proc;
      const timer = setTimeout(() => reject(new Error("l'assistant audio ne répond pas")), 30_000);
      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', (chunk) => {
        this.buffer += chunk;
        let i;
        while ((i = this.buffer.indexOf('\n')) >= 0) {
          const line = this.buffer.slice(0, i).trim();
          this.buffer = this.buffer.slice(i + 1);
          if (!line) continue;
          let msg;
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }
          if (msg.ready) {
            clearTimeout(timer);
            resolve();
          } else this.waiting.shift()?.(msg);
        }
      });
      proc.stderr.on('data', (d) => (this.lastError = String(d).slice(0, 300)));
      proc.on('exit', () => {
        clearTimeout(timer);
        reject(new Error(this.lastError ?? "l'assistant audio s'est arrêté"));
        this.proc = null;
        this.ready = null;
        for (const w of this.waiting.splice(0)) w({ ok: false, error: 'arrêté' });
      });
    });
    this.ready.catch(() => {});
    return this.ready;
  }

  async #send(cmd) {
    await this.#start();
    return new Promise((resolve) => {
      this.waiting.push(resolve);
      this.proc.stdin.write(`${JSON.stringify(cmd)}\n`);
    });
  }

  #apply(factor) {
    const t = this.target;
    if (!t || t.mode === 'off') return Promise.resolve({ ok: true, sessions: 0 });
    return this.#send({ names: parseApps(t.apps), exclude: this.ownPids(), all: t.mode === 'all', factor });
  }

  // db : gain voulu (≤ 0) ; fondu en quelques pas sur rampMs
  duck({ db, rampMs = 900, mode, apps }) {
    if (!this.supported) return Promise.resolve({ ok: false, error: 'Windows seulement' });
    if (mode === 'off' && this.factor === 1) return Promise.resolve({ ok: true, sessions: 0 });
    this.target = { mode: mode === 'off' ? this.target?.mode ?? 'off' : mode, apps };
    const goal = mode === 'off' ? 1 : db <= -60 ? 0 : Math.min(1, 10 ** (db / 20));
    this.chain = this.chain.then(async () => {
      const from = this.factor;
      const steps = Math.max(1, Math.min(8, Math.round(rampMs / 120)));
      let res = null;
      for (let i = 1; i <= steps; i++) {
        const f = from + ((goal - from) * i) / steps;
        res = await this.#apply(f).catch((err) => ({ ok: false, error: err.message }));
        if (!res?.ok) break;
        if (i < steps) await new Promise((r) => setTimeout(r, rampMs / steps));
      }
      this.factor = res?.ok ? goal : this.factor;
      if (!res?.ok) this.lastError = res?.error ?? 'inconnu';
      return res;
    });
    return this.chain;
  }

  restore() {
    if (!this.supported || this.factor === 1) return Promise.resolve();
    return this.duck({ db: 0, rampMs: 300, mode: this.target?.mode ?? 'off', apps: this.target?.apps });
  }

  dispose() {
    try {
      this.proc?.stdin.end();
      this.proc?.kill();
    } catch {
      /* déjà arrêté */
    }
  }
}
