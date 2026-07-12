#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  injectIosGoogleUrlScheme,
  readPlistString,
} from './mobile-firebase-config.mjs';

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const required = args.has('--require');
const android = args.has('--android') || args.has('--all');
const ios = args.has('--ios') || args.has('--all');
const bundleId = 'com.seorilabs.daoewo';
const expectedProjectId = process.env.FIREBASE_PROJECT_ID?.trim() ?? '';

if (required && expectedProjectId.length === 0) {
  throw new Error('FIREBASE_PROJECT_ID is required.');
}

if (!android && !ios) {
  console.error('Usage: restore-mobile-firebase-config.mjs --android|--ios|--all [--require]');
  process.exit(2);
}

function decode(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    if (required) throw new Error(`${name} is required.`);
    return null;
  }
  return Buffer.from(value, 'base64');
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, { mode: 0o600 });
  console.log(`Restored ${path}`);
}

if (android) {
  const content = decode('FIREBASE_ANDROID_GOOGLE_SERVICES_JSON_BASE64');
  if (content) {
    const config = JSON.parse(content.toString('utf8'));
    const client = (config.client ?? []).find(
      (candidate) =>
        candidate.client_info?.android_client_info?.package_name === bundleId,
    );
    if (!client) throw new Error(`google-services.json does not contain ${bundleId}.`);
    if (
      expectedProjectId.length > 0 &&
      config.project_info?.project_id !== expectedProjectId
    ) {
      throw new Error('google-services.json project_id does not match FIREBASE_PROJECT_ID.');
    }
    if (
      typeof client.client_info?.mobilesdk_app_id !== 'string' ||
      client.client_info.mobilesdk_app_id.length === 0 ||
      !(client.api_key ?? []).some(
        (entry) =>
          typeof entry.current_key === 'string' && entry.current_key.length > 0,
      )
    ) {
      throw new Error('google-services.json is missing mobilesdk_app_id or api_key.');
    }
    write(join(root, 'apps/mobile/android/app/google-services.json'), content);
  }
}

if (ios) {
  const content = decode('FIREBASE_IOS_GOOGLE_SERVICE_INFO_PLIST_BASE64');
  if (content) {
    const text = content.toString('utf8');
    if (readPlistString(text, 'BUNDLE_ID') !== bundleId) {
      throw new Error(`GoogleService-Info.plist does not contain ${bundleId}.`);
    }
    if (
      expectedProjectId.length > 0 &&
      readPlistString(text, 'PROJECT_ID') !== expectedProjectId
    ) {
      throw new Error('GoogleService-Info.plist PROJECT_ID does not match FIREBASE_PROJECT_ID.');
    }
    const reversedClientId = readPlistString(text, 'REVERSED_CLIENT_ID');
    const googleAppId = readPlistString(text, 'GOOGLE_APP_ID');
    const apiKey = readPlistString(text, 'API_KEY');
    if (!/^com\.googleusercontent\.apps\.[A-Za-z0-9._-]+$/.test(reversedClientId)) {
      throw new Error('GoogleService-Info.plist has no valid REVERSED_CLIENT_ID.');
    }
    if (googleAppId.length === 0 || apiKey.length === 0) {
      throw new Error('GoogleService-Info.plist has no GOOGLE_APP_ID or API_KEY.');
    }
    write(join(root, 'apps/mobile/ios/Daoewo/GoogleService-Info.plist'), content);
    const infoPlistPath = join(root, 'apps/mobile/ios/Daoewo/Info.plist');
    const infoPlist = readFileSync(infoPlistPath, 'utf8');
    write(
      infoPlistPath,
      injectIosGoogleUrlScheme(infoPlist, reversedClientId),
    );
  }
}
