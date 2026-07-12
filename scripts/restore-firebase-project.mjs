#!/usr/bin/env node

import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

const required = process.argv.slice(2).includes('--require');
const projectId = process.env.FIREBASE_PROJECT_ID?.trim() ?? '';

if (projectId.length === 0) {
  if (required) {
    throw new Error('FIREBASE_PROJECT_ID is required.');
  }
  process.exit(0);
}

if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) {
  throw new Error('FIREBASE_PROJECT_ID is not a valid Google Cloud project ID.');
}

const directory = join(process.cwd(), 'firebase');
const path = join(directory, '.firebaserc');
mkdirSync(directory, {recursive: true});
writeFileSync(
  path,
  `${JSON.stringify({projects: {default: projectId}}, null, 2)}\n`,
  {mode: 0o600},
);
console.log(`Restored ${path}`);
