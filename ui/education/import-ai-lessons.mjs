import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const revision = '2cd0e0fbead893e5ca8c3698847f2e5bd373d176';
const repository = 'JaniceWei99/AI-Lessons';
const root = fileURLToPath(new URL('./ai-lessons/', import.meta.url));
const response = await fetch(`https://api.github.com/repos/${repository}/git/trees/${revision}?recursive=1`);
if (!response.ok) throw new Error(`GitHub tree: ${response.status}`);
const tree = await response.json();
const files = tree.tree.filter(entry => entry.type === 'blob' && (
  ['LICENSE', 'index.html'].includes(entry.path)
  || /^(css|js)\/[^/]+\.(css|js)$/.test(entry.path)
  || /^(standard-5|standard-15|lab-10|web-ai-12|app-inventor-10)\/(index\.html|lessons\/lesson\d+\.html)$/.test(entry.path)
));
let cursor = 0;
let completed = 0;
async function worker() {
  while (cursor < files.length) {
    const entry = files[cursor++];
    let bytes;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await fetch(`https://raw.githubusercontent.com/${repository}/${revision}/${entry.path}`, {
          signal: AbortSignal.timeout(30000),
        });
        if (!result.ok) throw new Error(`Download ${entry.path}: ${result.status}`);
        bytes = Buffer.from(await result.arrayBuffer());
        const digest = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
        if (digest !== entry.sha) throw new Error(`Checksum mismatch: ${entry.path}`);
        break;
      } catch (error) { if (attempt === 2) throw error; }
    }
    const target = path.join(root, entry.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
    completed++;
    if (completed % 10 === 0) console.log(`Imported ${completed}/${files.length} files`);
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
console.log(`Imported ${completed} verified runtime files at ${revision}. Local adaptations must be reapplied after import.`);
