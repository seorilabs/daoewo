import type { DaoewoTts } from '@daoewo/product-ui';

import NativeDaoewoTts, {
  type Spec as NativeDaoewoTtsModule,
} from '../specs/NativeDaoewoTts';

export const NATIVE_TTS_MAX_INPUT_LENGTH = 4_000;

const DEFAULT_SPEECH_LOCALE = 'ko-KR';
const SPEECH_LOCALE_ALIASES: Readonly<Record<string, string>> = {
  ko: 'ko-KR',
  'ko-kr': 'ko-KR',
  한국어: 'ko-KR',
  en: 'en-US',
  'en-us': 'en-US',
  영어: 'en-US',
  ja: 'ja-JP',
  'ja-jp': 'ja-JP',
  일본어: 'ja-JP',
};

export function createNativeTtsAdapter(
  nativeModule: NativeDaoewoTtsModule | null = NativeDaoewoTts,
): DaoewoTts {
  return {
    availability: nativeModule === null ? 'unsupported' : 'available',
    async speak(text, locale) {
      const normalizedText = normalizeSpeechText(text);
      if (nativeModule === null) {
        throw new Error('이 기기에서 네이티브 TTS를 사용할 수 없어요.');
      }
      await nativeModule.speak(normalizedText, normalizeSpeechLocale(locale));
    },
    async stop() {
      if (nativeModule !== null) {
        await nativeModule.stop();
      }
    },
  };
}

export function normalizeSpeechLocale(locale?: string): string {
  const candidate = locale?.trim().replace(/_/g, '-') ?? '';
  const alias = SPEECH_LOCALE_ALIASES[candidate.toLocaleLowerCase('en-US')];
  if (alias !== undefined) {
    return alias;
  }
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(candidate)) {
    return DEFAULT_SPEECH_LOCALE;
  }
  return candidate
    .split('-')
    .map((part, index) => {
      if (index === 0) {
        return part.toLowerCase();
      }
      if (part.length === 2 || /^\d{3}$/.test(part)) {
        return part.toUpperCase();
      }
      if (part.length === 4) {
        return `${part[0]!.toUpperCase()}${part.slice(1).toLowerCase()}`;
      }
      return part;
    })
    .join('-');
}

function normalizeSpeechText(text: string): string {
  const normalized = text.trim();
  if (normalized.length === 0) {
    throw new Error('읽을 텍스트가 비어 있어요.');
  }
  if (normalized.length > NATIVE_TTS_MAX_INPUT_LENGTH) {
    throw new Error(
      `읽을 텍스트는 ${NATIVE_TTS_MAX_INPUT_LENGTH.toLocaleString()}자 이하여야 해요.`,
    );
  }
  return normalized;
}
