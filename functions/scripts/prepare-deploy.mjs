import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const functionsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(functionsRoot, '..');
const deployRoot = resolve(functionsRoot, 'deploy');
const coreRoot = resolve(repoRoot, 'packages/product-core');
const sourcePackage = JSON.parse(
  await readFile(resolve(functionsRoot, 'package.json'), 'utf8'),
);
const corePackage = JSON.parse(await readFile(resolve(coreRoot, 'package.json'), 'utf8'));
const { renderFunctionsRuntimeDotenv, validateFunctionsDeployEnvironment } = await import(
  resolve(functionsRoot, 'lib/src/deploy-config.js')
);

// firebase.json predeploy가 direct deploy에서도 release authority 설정 누락을 차단한다.
const deployConfig = validateFunctionsDeployEnvironment(process.env);

await rm(resolve(deployRoot, 'lib'), { recursive: true, force: true });
await rm(resolve(deployRoot, 'vendor'), { recursive: true, force: true });
await rm(resolve(deployRoot, 'package-lock.json'), { force: true });
await rm(resolve(deployRoot, '.env'), { force: true });
await mkdir(resolve(deployRoot, 'vendor/product-core'), { recursive: true });
await cp(resolve(functionsRoot, 'lib'), resolve(deployRoot, 'lib'), { recursive: true });
await cp(resolve(coreRoot, 'dist'), resolve(deployRoot, 'vendor/product-core/dist'), {
  recursive: true,
});

const runtimePackage = {
  name: '@daoewo/functions-deploy',
  version: sourcePackage.version,
  private: true,
  type: 'module',
  main: 'lib/src/index.js',
  engines: { node: '22' },
  dependencies: {
    '@daoewo/product-core': 'file:vendor/product-core',
    ...Object.fromEntries(
      Object.entries(sourcePackage.dependencies).filter(
        ([name]) => name !== '@daoewo/product-core',
      ),
    ),
  },
};
const runtimeCorePackage = {
  name: '@daoewo/product-core',
  version: corePackage.version,
  private: true,
  type: 'module',
  sideEffects: false,
  main: './dist/index.js',
  types: './dist/index.d.ts',
  exports: {
    '.': {
      types: './dist/index.d.ts',
      import: './dist/index.js',
      default: './dist/index.js',
    },
  },
};

await writeFile(
  resolve(deployRoot, 'package.json'),
  `${JSON.stringify(runtimePackage, null, 2)}\n`,
);
await writeFile(
  resolve(deployRoot, '.env'),
  renderFunctionsRuntimeDotenv(deployConfig),
  { mode: 0o600 },
);
await writeFile(
  resolve(deployRoot, 'vendor/product-core/package.json'),
  `${JSON.stringify(runtimeCorePackage, null, 2)}\n`,
);

execFileSync(
  'npm',
  ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
  { cwd: deployRoot, stdio: 'inherit' },
);
