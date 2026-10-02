import fs from 'node:fs';
import path from 'node:path';

// Premier lancement sous le nouveau nom : on reprend les réglages, les têtes émoji, le modèle
// vocal et les connexions (cookies) de l'ancienne version, sans rien re-télécharger.
export function migrateLegacyData({ appData, userData, legacyNames, log = () => {} }) {
  if (fs.existsSync(path.join(userData, 'config.json'))) return null;
  for (const name of legacyNames) {
    const old = path.join(appData, name);
    if (old === userData || !fs.existsSync(path.join(old, 'config.json'))) continue;
    fs.mkdirSync(userData, { recursive: true });
    fs.copyFileSync(path.join(old, 'config.json'), path.join(userData, 'config.json'));
    for (const dir of ['heads', 'models', 'cache', 'Partitions']) {
      const from = path.join(old, dir);
      const to = path.join(userData, dir);
      if (!fs.existsSync(from) || fs.existsSync(to)) continue;
      try {
        fs.renameSync(from, to);
      } catch {
        try {
          fs.cpSync(from, to, { recursive: true });
        } catch (err) {
          log(`migration ${dir} : ${err.message}`);
        }
      }
    }
    return old;
  }
  return null;
}
