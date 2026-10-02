import fs from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_CONFIG, mergeConfig } from '../shared/config.js';

// Configuration utilisateur dans %APPDATA%/Rondelle/config.json
export class ConfigStore {
  // memory : rien n'est écrit sur le disque (mode démo)
  constructor(dir, { memory = false, seed = null } = {}) {
    this.memory = memory;
    this.seed = seed;
    this.file = path.join(dir, 'config.json');
    this.data = structuredClone(DEFAULT_CONFIG);
    this.saveTimer = null;
  }

  async load() {
    if (this.memory) return (this.data = mergeConfig(DEFAULT_CONFIG, this.seed ?? {}));
    try {
      this.data = mergeConfig(DEFAULT_CONFIG, JSON.parse(await fs.readFile(this.file, 'utf8')));
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn('[config] illisible, valeurs par défaut', err.message);
      this.data = structuredClone(DEFAULT_CONFIG);
    }
    return this.data;
  }

  set(next) {
    this.data = mergeConfig(DEFAULT_CONFIG, next);
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 400);
    return this.data;
  }

  async flush() {
    clearTimeout(this.saveTimer);
    if (this.memory) return;
    const tmp = `${this.file}.tmp`;
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(this.data, null, 2));
    await fs.rename(tmp, this.file);
  }
}
