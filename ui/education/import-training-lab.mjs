import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const commit = '4a9b696f03cd5fd6f346424a56fb51ba9cfe86cf';
const expected = '762eea09c91ba39f80edc9566476362e37c275426ba1027ee3daeff091a5303b';
const cache = path.join(root, '.cache/education-upstream');
const archive = path.join(cache, `genai-tm-${commit}.tar.gz`);
const destination = process.argv[2] ? path.resolve(process.argv[2]) : path.join(here, 'training-lab-source');
const verify = process.argv.includes('--verify');
const target = verify ? path.join(here, 'training-lab-source') : destination;
await mkdir(cache, { recursive: true });
let bytes;
try { bytes = await readFile(archive); } catch {
  const response = await fetch(`https://codeload.github.com/knicos/genai-tm/tar.gz/${commit}`, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Source download: ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
}
assertHash(bytes, expected, 'upstream archive');
await writeFile(archive, bytes);
const temporary = await mkdtemp(path.join(cache, 'training-lab-import-'));
run('tar', ['-xzf', archive, '-C', temporary]);
const original = path.join(temporary, `genai-tm-${commit}`);
const patch = await readFile(path.join(here, 'training-lab-upstream.patch'), 'utf8');
run('git', ['-c', 'core.autocrlf=false', 'apply', '--no-index',
  `--directory=${path.relative(root, original).split(path.sep).join('/')}`, '-'], root, patch);
if (!verify) {
  try {
    if ((await readdir(target)).length) throw new Error(`Refusing to overwrite nonempty source directory: ${target}. Use --verify or a new destination.`);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await cp(original, target, { recursive: true });
  console.log(`Imported pinned and patched source to ${target}`);
} else {
  let count = 0;
  async function compare(directory, relative = '') {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const name = path.join(relative, item.name);
      if (item.isDirectory()) await compare(path.join(directory, item.name), name);
      else {
        const wanted = await readFile(path.join(original, name));
        const actual = await readFile(path.join(target, name));
        assertHash(actual, createHash('sha256').update(wanted).digest('hex'), name);
        count++;
      }
    }
  }
  await compare(original);
  console.log(`Verified ${count} vendored source files against pinned archive plus local patch.`);
}

function assertHash(bytes, wanted, label) {
  if (createHash('sha256').update(bytes).digest('hex') !== wanted) throw new Error(`Checksum mismatch: ${label}`);
}
function run(command, args, cwd = root, input) {
  const result = spawnSync(command, args, { cwd, input, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
}
