import {sha1} from '@noble/hashes/legacy.js';
import {sha256} from '@noble/hashes/sha2.js';
import {
  bytesToHex,
  concatBytes,
  hexToBytes,
  utf8ToBytes,
} from '@noble/hashes/utils.js';

const GOOGLE_BINDING_PREFIX =
  'daoewo:google-play:com.seorilabs.daoewo:';
const APPLE_BINDING_PREFIX = 'daoewo:app-store:com.seorilabs.daoewo:';
const UUID_DNS_NAMESPACE = hexToBytes(
  '6ba7b8109dad11d180b400c04fd430c8',
);

export interface StoreAccountBinding {
  readonly googleObfuscatedAccountId: string;
  readonly appleAppAccountToken: string;
}

/**
 * 스토어 영수증을 Firebase 계정에 묶는 공개·결정적 식별자다. 원본 UID는 스토어로
 * 전송하지 않으며, 서버 provider가 동일 알고리즘으로 검증한다.
 */
export function createStoreAccountBinding(uid: string): StoreAccountBinding {
  const normalizedUid = uid.trim();
  if (normalizedUid.length === 0) {
    throw new Error('구매 계정 식별자를 확인할 수 없어요.');
  }
  return {
    googleObfuscatedAccountId: bytesToHex(
      sha256(utf8ToBytes(`${GOOGLE_BINDING_PREFIX}${normalizedUid}`)),
    ),
    appleAppAccountToken: uuidV5(
      `${APPLE_BINDING_PREFIX}${normalizedUid}`,
      UUID_DNS_NAMESPACE,
    ),
  };
}

function uuidV5(name: string, namespace: Uint8Array): string {
  const bytes = sha1(concatBytes(namespace, utf8ToBytes(name))).slice(0, 16);
  // RFC 9562의 version/variant 비트를 정확히 설정해야 하므로 bitwise 연산을 사용한다.
  // eslint-disable-next-line no-bitwise
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  // eslint-disable-next-line no-bitwise
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16,
  )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
