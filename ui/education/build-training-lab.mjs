import { createHash } from 'node:crypto';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(here, 'training-lab-source');
const output = path.join(here, 'training-lab');
const cache = path.resolve(here, '../../.cache/training-lab-assets');
const manifestFile = path.join(here, 'training-lab-assets.json');
const record = process.argv.includes('--record-assets');
const assetsOnly = process.argv.includes('--assets-only');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const execute = promisify(execFile);
let assets = record ? [] : JSON.parse(await readFile(manifestFile, 'utf8'));

async function fetchBytes(url) {
  const head = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(30000) });
  if (!head.ok) throw new Error(`${head.status} ${url}`);
  const length = Number(head.headers.get('content-length'));
  const ranged = length > 512 * 1024 &&
    (head.headers.get('accept-ranges') === 'bytes' || new URL(url).hostname.endsWith('.blob.core.windows.net'));
  const chunkSize = ranged ? 256 * 1024 : length || 100 * 1024 * 1024;
  const parts = [];
  for (let offset = 0; offset < (length || 1); offset += chunkSize) parts.push(offset);
  const buffers = new Array(parts.length);
  let cursor = 0;
  async function worker() {
    while (cursor < parts.length) {
      const index = cursor++, start = parts[index], end = Math.min(length - 1, start + chunkSize - 1);
      const args = ['--fail', '--location', '--silent', '--show-error', '--retry', '2',
        '--connect-timeout', '30', '--max-time', '180'];
      if (ranged) args.push('--range', `${start}-${end}`);
      const result = await execute('curl', [...args, url], { encoding: 'buffer', maxBuffer: 100 * 1024 * 1024 });
      if (ranged && result.stdout.length !== end - start + 1) throw new Error(`Invalid range response: ${url}`);
      buffers[index] = result.stdout;
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, parts.length) }, worker));
  return Buffer.concat(buffers);
}

async function download(url, relative) {
  const target = path.join(cache, relative);
  const entry = assets.find(asset => asset.path === relative);
  if (!record && (!entry || entry.url !== url)) throw new Error(`Unpinned asset: ${relative}`);
  let bytes;
  try {
    bytes = await readFile(target);
    if (entry && hash(bytes) !== entry.sha256) bytes = undefined;
  } catch { /* Fetch a missing cache entry. */ }
  if (!bytes) {
    console.log(`Downloading ${relative}`);
    bytes = await fetchBytes(url);
  }
  const digest = hash(bytes);
  if (entry && digest !== entry.sha256) throw new Error(`Asset checksum mismatch: ${relative}`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
  if (record && !entry) assets.push({ path: relative, url, sha256: digest, bytes: bytes.length });
  return bytes;
}

async function model(url, relative) {
  const bytes = await download(url, relative);
  const data = JSON.parse(bytes);
  for (const group of data.weightsManifest) {
    for (const shard of group.paths) {
      if (shard.includes('..') || /^[a-z]+:/i.test(shard)) throw new Error(`Unexpected weight path: ${shard}`);
      await download(new URL(shard, url).href, path.posix.join(path.posix.dirname(relative), shard));
    }
  }
}

// These are the exact checkpoints used by classifier@1.3.6. Runtime URLs are
// rewritten at build time; the training implementation itself is retained.
await model('https://store.gen-ai.fi/tm/models/mobilenet_v2/model.json', 'models/mobilenet_v2/model.json');
await model('https://tmstore.blob.core.windows.net/models/posenet_075/model-stride16.json', 'models/posenet_075/model-stride16.json');
await model('https://store.gen-ai.fi/tm/models/speech-commands/18w/model.json', 'models/speech-commands/18w/model.json');
await download('https://store.gen-ai.fi/tm/models/speech-commands/18w/metadata.json', 'models/speech-commands/18w/metadata.json');
await download('https://store.gen-ai.fi/tm/Imagenet/imagenet_dataset.json', 'Imagenet/imagenet_dataset.json');
if (record) {
  assets.sort((a, b) => a.path.localeCompare(b.path));
  await writeFile(manifestFile, `${JSON.stringify(assets, null, 2)}\n`);
}
if (assetsOnly) process.exit(0);

function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: source, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`Build command failed: ${args.join(' ')}`);
}
run(['node_modules/typescript/bin/tsc', '--noEmit']);
run(['node_modules/vite/bin/vite.js', 'build']);
for (const asset of assets) {
  const destination = path.join(output, asset.path);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(path.join(cache, asset.path), destination);
}
// Keep concept labels/probabilities but omit third-party ImageNet thumbnails:
// those remote examples are neither training data nor required for inference.
const datasetPath = path.join(output, 'Imagenet/imagenet_dataset.json');
const dataset = JSON.parse(await readFile(datasetPath, 'utf8'));
for (const item of dataset) item.images = [];
await writeFile(datasetPath, JSON.stringify(dataset));
const hands = path.join(source, 'node_modules/@mediapipe/hands');
const handsOutput = path.join(output, 'models/hands');
await mkdir(handsOutput, { recursive: true });
for (const name of await readdir(hands)) {
  if (/\.(js|wasm|data|tflite|binarypb)$/.test(name)) {
    await cp(path.join(hands, name), path.join(handsOutput, name));
  }
}
await cp(path.join(source, 'LICENSE'), path.join(output, 'LICENSE'));
await cp(manifestFile, path.join(output, 'MODEL-ASSETS.json'));
await cp(path.join(here, 'TRAINING-LAB.md'), path.join(output, 'PROVENANCE.md'));

// Preserve installed package license texts, including nested dependency copies.
const licenses = [];
async function collect(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (!item.isDirectory() || item.name.startsWith('.')) continue;
    const folder = path.join(directory, item.name);
    if (item.name.startsWith('@')) { await collect(folder); continue; }
    let pkg;
    try { pkg = JSON.parse(await readFile(path.join(folder, 'package.json'), 'utf8')); } catch { continue; }
    const files = (await readdir(folder)).filter(name => /^(licen[cs]e|notice|copying)(\.|$)/i.test(name));
    const texts = [];
    for (const file of files) {
      try { texts.push(`${file}\n${await readFile(path.join(folder, file), 'utf8')}`); } catch { /* Some packages use license directories. */ }
    }
    licenses.push(`${pkg.name}@${pkg.version} (${pkg.license || 'see package'})\n${texts.join('\n\n')}`);
    try { await collect(path.join(folder, 'node_modules')); } catch { /* No nested dependencies. */ }
  }
}
await collect(path.join(source, 'node_modules'));
await writeFile(path.join(output, 'THIRD-PARTY-NOTICES.txt'), licenses.sort().join('\n\n' + '='.repeat(72) + '\n\n'));
console.log(`Built ${output}`);
