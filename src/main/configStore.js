import fs from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_CONFIG, mergeConfig } from '../shared/config.js';

// Configuration utilisateur dans %APPDATA%/Habs Régie/config.json
export class ConfigStore {
  constructor(dir) {
    this.file = path.join(dir, 'config.json');
    this.data = structuredClone(DEFAULT_CONFIG);
    this.saveTimer = null;
  }

  async load() {
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
    const tmp = `${this.file}.tmp`;
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(this.data, null, 2));
    await fs.rename(tmp, this.file);
  }
}
