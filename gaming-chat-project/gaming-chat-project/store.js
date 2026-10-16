import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storePath = process.env.DATA_FILE || path.join(__dirname, 'data.json');
export function readStore() {
  try {
    const value = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    return { users: Array.isArray(value.users) ? value.users : [], messages: Array.isArray(value.messages) ? value.messages : [] };
  } catch { return { users: [], messages: [] }; }
}
export function writeStore(store) {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  const temp = `${storePath}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.renameSync(temp, storePath);
}
