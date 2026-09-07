#!/usr/bin/env node
// Platform discovery는 @seorilabs/platform-sdk가 exact로 선언되고, 감지된 package
// manager의 lockfile이 같은 exact 버전으로 해석될 때만 integration=SDK로 분류한다.
// 선언이 floating이거나 lock이 다른 버전·부재이거나 lockfile이 두 벌 커밋돼
// package manager 신호가 갈리면 CUSTOM_HTTP로 떨어진다.
//
// 이 검사는 그 조건들을 저장소 안에서 재현해 회귀를 막는다.
//   1. 커밋되는 JS lockfile은 루트 pnpm-lock.yaml 하나뿐이다.
//   2. SDK를 선언한 모든 workspace package.json이 Platform 승인 artifact 버전을
//      캐럿·틸드 없이 같은 값으로 쓴다.
//   3. lockfile의 해당 importer가 같은 exact 버전으로 해석되고 npm 공개
//      레지스트리 integrity를 가진다.

import {readFileSync, readdirSync} from 'node:fs';
import {basename, join, relative, sep} from 'node:path';
import process from 'node:process';

const PACKAGE_NAME = '@seorilabs/platform-sdk';
// Platform이 승인한 SDK artifact 버전. Platform release가 새 artifact를 승인할 때만
// 바꾸고, 그때 pnpm-lock.yaml 해석도 같이 옮긴다. 임의 상향·하향을 막는 기준값이다.
export const APPROVED_SDK_VERSION = '0.5.0';
const EXACT_VERSION = /^\d+\.\d+\.\d+$/;
// Backoffice repository-discovery가 lock integrity를 받아들이는 것과 같은 경계다.
const INTEGRITY = /^(?:sha256-[A-Za-z0-9+/]{43}=|sha512-[A-Za-z0-9+/]{86}==)$/;
const NPM_TARBALL_PREFIX = 'https://registry.npmjs.org/';
// JS package manager 신호가 되는 lockfile. Gemfile.lock, Podfile.lock 같은
// 다른 생태계 lock은 package manager 감지에 쓰이지 않으므로 제외한다.
const FOREIGN_LOCKFILES = ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'bun.lock', 'bun.lockb'];
const SKIP_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'build', 'Pods', '.ait', '.granite', 'vendor']);
// Backoffice discovery가 package.json 후보로 보는 깊이와 같게 맞춘다.
const MAX_DEPTH = 4;

function collectPaths(root) {
  const found = [];
  const walk = (directory, depth) => {
    let entries;
    try {
      entries = readdirSync(directory, {withFileTypes: true});
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.github') continue;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name) || depth >= MAX_DEPTH) continue;
        walk(absolute, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name === 'package.json' || entry.name === 'pnpm-lock.yaml' || FOREIGN_LOCKFILES.includes(entry.name)) {
        found.push(relative(root, absolute).split(sep).join('/'));
      }
    }
  };
  walk(root, 1);
  return found.sort();
}

function readJson(root, path) {
  return JSON.parse(readFileSync(join(root, path), 'utf8'));
}

function unquote(value) {
  const trimmed = value.trim();
  return /^'.*'$/.test(trimmed) || /^".*"$/.test(trimmed) ? trimmed.slice(1, -1) : trimmed;
}

function inlineMapValue(text, key) {
  const match = new RegExp(`(?:^|[{,])\\s*${key}:\\s*([^,}]+)`).exec(text);
  return match ? unquote(match[1]) : null;
}

// pnpm lockfile v9는 들여쓰기가 고정된 좁은 형태만 쓰므로, 새 의존성을 들이지 않고
// 필요한 두 구역(importers, packages)만 직접 읽는다. 기대한 형태가 아니면
// 조용히 통과하지 않고 호출부에서 실패로 만든다.
function readPnpmLock(text) {
  const importers = new Map();
  const packages = new Map();
  let section = null;
  let importer = null;
  let dependencyGroup = null;
  let dependency = null;
  let packageKey = null;

  for (const rawLine of text.split('\n')) {
    if (rawLine.trim().length === 0 || rawLine.trimStart().startsWith('#')) continue;
    const indent = rawLine.length - rawLine.trimStart().length;
    const line = rawLine.trim();

    if (indent === 0) {
      section = line.endsWith(':') ? line.slice(0, -1) : null;
      importer = null;
      packageKey = null;
      continue;
    }
    if (section === 'importers') {
      if (indent === 2 && line.endsWith(':')) {
        importer = unquote(line.slice(0, -1));
        importers.set(importer, new Map());
        dependencyGroup = null;
        dependency = null;
      } else if (indent === 4 && line.endsWith(':')) {
        dependencyGroup = line.slice(0, -1);
        dependency = null;
      } else if (indent === 6 && line.endsWith(':')) {
        dependency = unquote(line.slice(0, -1));
        if (importer !== null && dependencyGroup !== null) {
          importers.get(importer).set(dependency, {group: dependencyGroup});
        }
      } else if (indent === 8 && dependency !== null && importer !== null) {
        const [key, ...rest] = line.split(':');
        const entry = importers.get(importer).get(dependency);
        if (entry && (key === 'specifier' || key === 'version')) {
          entry[key] = unquote(rest.join(':'));
        }
      }
      continue;
    }
    if (section === 'packages') {
      if (indent === 2 && line.endsWith(':')) {
        packageKey = unquote(line.slice(0, -1));
        packages.set(packageKey, {});
      } else if (indent === 4 && packageKey !== null && line.startsWith('resolution:')) {
        packages.get(packageKey).resolution = line.slice('resolution:'.length).trim();
      }
    }
  }
  return {importers, packages};
}

export function checkPlatformSdkLock(root, approvedVersion = APPROVED_SDK_VERSION) {
  const problems = [];
  const paths = collectPaths(root);

  // Backoffice repository-discovery의 packageManagerFor는 후보 디렉터리에서 위로
  // 올라가며 첫 신호에서 멈춘다. 저장소 전체를 훑지 않는다. 그래서 SDK를 선언한
  // package의 조상이 아닌 곳의 lockfile은 판정에 영향을 주지 않는다.
  // 이 저장소의 firebase/functions/package-lock.json이 그런 경우다.
  const declaringDirectories = paths
    .filter((path) => basename(path) === 'package.json')
    .filter((path) => {
      try {
        const manifest = readJson(root, path);
        return (manifest?.dependencies?.[PACKAGE_NAME] ?? manifest?.devDependencies?.[PACKAGE_NAME]) !== undefined;
      } catch {
        return false;
      }
    })
    .map((path) => (path === 'package.json' ? '.' : path.slice(0, -'/package.json'.length)));

  const ancestorDirectories = new Set(['.']);
  for (const directory of declaringDirectories) {
    const segments = directory === '.' ? [] : directory.split('/');
    for (let index = 0; index <= segments.length; index += 1) {
      ancestorDirectories.add(index === 0 ? '.' : segments.slice(0, index).join('/'));
    }
  }

  const foreignLocks = paths
    .filter((path) => FOREIGN_LOCKFILES.includes(basename(path)))
    .filter((path) => {
      const directory = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.';
      return ancestorDirectories.has(directory);
    });
  for (const path of foreignLocks) {
    problems.push(`${path}: SDK를 선언한 package의 조상 디렉터리에 다른 package manager의 lockfile이 있다. package manager 신호가 갈려 Platform discovery가 SDK 탑재를 확인하지 못한다.`);
  }

  const pnpmLocks = paths.filter((path) => basename(path) === 'pnpm-lock.yaml');
  if (!pnpmLocks.includes('pnpm-lock.yaml')) {
    problems.push('pnpm-lock.yaml: 루트 lockfile이 없다.');
  }
  // 조상 범위 밖의 pnpm lockfile은 discovery 판정에 쓰이지 않는다. 별도 workspace를
  // 갖는 디렉터리(예: firebase/)가 자기 lockfile을 두는 것은 정상이다.
  const nestedPnpmLocks = pnpmLocks
    .filter((path) => path !== 'pnpm-lock.yaml')
    .filter((path) => ancestorDirectories.has(path.slice(0, -'/pnpm-lock.yaml'.length)));
  for (const path of nestedPnpmLocks) {
    problems.push(`${path}: SDK를 선언한 package의 조상 디렉터리에 별도 pnpm lockfile이 있다. 루트 하나만 두어야 importer 해석이 갈리지 않는다.`);
  }

  let rootPackage = null;
  try {
    rootPackage = readJson(root, 'package.json');
  } catch {
    problems.push('package.json: 루트 package.json을 읽지 못했다.');
  }
  const packageManager = rootPackage?.packageManager;
  if (typeof packageManager !== 'string' || !/^pnpm@\d+\.\d+\.\d+$/.test(packageManager)) {
    problems.push(`package.json: packageManager는 "pnpm@<x.y.z>" exact여야 한다. 현재 값: ${JSON.stringify(packageManager ?? null)}`);
  }

  const declarations = [];
  for (const path of paths.filter((path) => basename(path) === 'package.json')) {
    let manifest;
    try {
      manifest = readJson(root, path);
    } catch {
      problems.push(`${path}: package.json을 파싱하지 못했다.`);
      continue;
    }
    const spec = manifest?.dependencies?.[PACKAGE_NAME] ?? manifest?.devDependencies?.[PACKAGE_NAME];
    if (spec === undefined) continue;
    if (typeof spec !== 'string' || !EXACT_VERSION.test(spec)) {
      problems.push(`${path}: ${PACKAGE_NAME}는 캐럿·틸드 없이 exact 버전으로 선언해야 한다. 현재 값: ${JSON.stringify(spec)}`);
      continue;
    }
    const directory = path === 'package.json' ? '.' : path.slice(0, -'/package.json'.length);
    declarations.push({path, directory, version: spec});
  }

  if (declarations.length === 0) {
    problems.push(`${PACKAGE_NAME}를 선언한 workspace package.json이 없다.`);
  }
  const versions = [...new Set(declarations.map((entry) => entry.version))];
  if (versions.length > 1) {
    problems.push(`${PACKAGE_NAME} 선언 버전이 target마다 다르다: ${versions.join(', ')}`);
  }
  for (const declaration of declarations.filter((entry) => entry.version !== approvedVersion)) {
    problems.push(`${declaration.path}: ${PACKAGE_NAME}는 Platform 승인 artifact ${approvedVersion}을 탑재해야 한다. 현재 값: ${declaration.version}`);
  }

  let lock = null;
  if (pnpmLocks.includes('pnpm-lock.yaml')) {
    try {
      lock = readPnpmLock(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8'));
    } catch {
      problems.push('pnpm-lock.yaml: lockfile을 읽지 못했다.');
    }
  }

  const resolved = [];
  if (lock) {
    for (const declaration of declarations) {
      const importer = lock.importers.get(declaration.directory);
      if (!importer) {
        problems.push(`pnpm-lock.yaml: importer "${declaration.directory}" 항목이 없다. lockfile이 ${declaration.path}와 어긋나 있다.`);
        continue;
      }
      const entry = importer.get(PACKAGE_NAME);
      if (!entry) {
        problems.push(`pnpm-lock.yaml: importer "${declaration.directory}"에 ${PACKAGE_NAME} 항목이 없다.`);
        continue;
      }
      if (entry.specifier !== declaration.version || entry.version !== declaration.version) {
        problems.push(`pnpm-lock.yaml: importer "${declaration.directory}"가 ${declaration.version}으로 해석되지 않는다. specifier=${entry.specifier}, version=${entry.version}`);
        continue;
      }
      const packageEntry = lock.packages.get(`${PACKAGE_NAME}@${declaration.version}`);
      if (!packageEntry?.resolution) {
        problems.push(`pnpm-lock.yaml: packages에 ${PACKAGE_NAME}@${declaration.version} resolution이 없다.`);
        continue;
      }
      const integrity = inlineMapValue(packageEntry.resolution, 'integrity');
      if (!integrity || !INTEGRITY.test(integrity)) {
        problems.push(`pnpm-lock.yaml: ${PACKAGE_NAME}@${declaration.version} integrity가 레지스트리 해시 형식이 아니다.`);
        continue;
      }
      // SDK는 npm 공개 레지스트리 trusted publishing으로 발행한다. 사설 tarball로
      // 되돌아가면 토큰 없는 CI와 자율 실행이 다시 설치에 실패한다.
      const tarball = inlineMapValue(packageEntry.resolution, 'tarball');
      if (tarball !== null && !tarball.startsWith(NPM_TARBALL_PREFIX)) {
        problems.push(`pnpm-lock.yaml: ${PACKAGE_NAME}@${declaration.version} tarball이 npm 공개 레지스트리가 아니다: ${tarball}`);
        continue;
      }
      resolved.push({...declaration, integrity, tarball});
    }
  }

  return {problems, declarations, resolved};
}

function main() {
  const root = process.argv[2] ?? process.cwd();
  const {problems, resolved} = checkPlatformSdkLock(root);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`- ${problem}`);
    console.error(`\nPlatform SDK lock check failed (${problems.length} problem(s)).`);
    process.exit(1);
  }
  for (const entry of resolved) {
    console.log(`${entry.path} -> ${PACKAGE_NAME}@${entry.version} (pnpm-lock.yaml importer "${entry.directory}", integrity ${entry.integrity.slice(0, 16)}...)`);
  }
  console.log('Platform SDK lock check passed.');
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
