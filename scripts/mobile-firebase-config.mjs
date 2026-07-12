const IOS_URL_SCHEME_START = '<!-- DAOEWO_FIREBASE_URL_SCHEME_BEGIN -->';
const IOS_URL_SCHEME_END = '<!-- DAOEWO_FIREBASE_URL_SCHEME_END -->';

export function readPlistString(text, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(
    new RegExp(
      `<key>\\s*${escaped}\\s*</key>\\s*<string>\\s*([^<]+?)\\s*</string>`,
    ),
  );
  return match?.[1]?.trim() ?? '';
}

export function injectIosGoogleUrlScheme(infoPlist, reversedClientId) {
  if (!/^com\.googleusercontent\.apps\.[A-Za-z0-9._-]+$/.test(reversedClientId)) {
    throw new Error('Google reversed client ID 형식이 올바르지 않습니다.');
  }
  const start = infoPlist.indexOf(IOS_URL_SCHEME_START);
  const end = infoPlist.indexOf(IOS_URL_SCHEME_END);
  if (start < 0 || end < start) {
    throw new Error('Info.plist의 Firebase URL scheme marker를 찾을 수 없습니다.');
  }
  const block = `${IOS_URL_SCHEME_START}\n\t<key>CFBundleURLTypes</key>\n\t<array>\n\t\t<dict>\n\t\t\t<key>CFBundleTypeRole</key>\n\t\t\t<string>Editor</string>\n\t\t\t<key>CFBundleURLSchemes</key>\n\t\t\t<array>\n\t\t\t\t<string>${reversedClientId}</string>\n\t\t\t</array>\n\t\t</dict>\n\t</array>\n\t${IOS_URL_SCHEME_END}`;
  return `${infoPlist.slice(0, start)}${block}${infoPlist.slice(
    end + IOS_URL_SCHEME_END.length,
  )}`;
}
