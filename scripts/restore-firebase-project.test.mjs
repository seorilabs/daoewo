import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

const script = resolve('scripts/restore-firebase-project.mjs');

function run(cwd, projectId, ...args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    env: {...process.env, FIREBASE_PROJECT_ID: projectId},
    encoding: 'utf8',
  });
}

test('검증된 project ID로 gitignored Firebase alias를 복원한다', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'daoewo-firebase-'));
  try {
    const result = run(cwd, 'daoewo-prod-123', '--require');
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      JSON.parse(readFileSync(join(cwd, 'firebase/.firebaserc'), 'utf8')),
      {projects: {default: 'daoewo-prod-123'}},
    );
  } finally {
    rmSync(cwd, {recursive: true, force: true});
  }
});

test('누락·잘못된 project ID를 require 모드에서 거부한다', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'daoewo-firebase-'));
  try {
    assert.notEqual(run(cwd, '', '--require').status, 0);
    assert.notEqual(run(cwd, 'INVALID_PROJECT', '--require').status, 0);
  } finally {
    rmSync(cwd, {recursive: true, force: true});
  }
});
