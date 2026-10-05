import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { tsImport } from 'tsx/esm/api';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distIndex = path.join(__dirname, 'dist', 'index.html');

process.env.NODE_ENV ??= 'production';

if (!existsSync(distIndex)) {
  console.log('Frontend build not found. Building Vite app...');
  await build({
    root: __dirname,
    logLevel: 'info'
  });
  console.log('Frontend build completed.');
}

await tsImport('./server/index.ts', import.meta.url);
