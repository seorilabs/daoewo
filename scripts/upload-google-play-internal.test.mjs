import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

test('Google Play 업로더가 releaseNotes와 기존 notes를 모두 읽는다', () => {
  const source = String.raw`
import importlib.util
from pathlib import Path

path = Path("scripts/upload-google-play-internal.py")
spec = importlib.util.spec_from_file_location("daoewo_google_play_upload", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

assert module.default_release_notes(
    {"releaseNotes": {"ko-KR": "첫 테스트 버전", "en-US": "First test build"}},
    "ko-KR",
) == "첫 테스트 버전"
assert module.default_release_notes(
    {"notes": {"en-US": "Legacy note"}},
    "ko-KR",
) == "Legacy note"
assert module.default_release_notes({}, "ko-KR") == ""
`;
  const result = spawnSync('python3', ['-c', source], {
    cwd: process.cwd(),
    env: {...process.env, PYTHONDONTWRITEBYTECODE: '1'},
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
});
