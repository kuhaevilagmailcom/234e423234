import { tsImport } from 'tsx/esm/api';

process.env.NODE_ENV ??= 'production';

await tsImport('./server/index.ts', import.meta.url);
