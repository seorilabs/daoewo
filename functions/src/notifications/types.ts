export type NotificationPlatform = "android" | "ios";

export interface RegisterNotificationInstallationInput {
  readonly deviceId: string;
  readonly fcmToken: string;
  readonly platform: NotificationPlatform;
  readonly locale: string;
  readonly appVersion: string;
  readonly buildNumber: string;
}

export interface UnregisterNotificationInstallationInput {
  readonly deviceId: string;
}

export interface NotificationInstallationRecord {
  readonly installationHash: string;
  readonly uid: string;
  readonly appId: "daoewo";
  readonly fcmToken: string;
  readonly fcmTokenHash: string;
  readonly platform: NotificationPlatform;
  readonly deckReadyEnabled: true;
  readonly locale: string;
  readonly appVersion: string;
  readonly buildNumber: string;
  readonly createdAt: string;
  readonly tokenUpdatedAt: string;
  readonly lastSeenAt: string;
  readonly updatedAt: string;
  readonly expiresAt: string;
}

export type NotificationOutboxStatus =
  | "pending"
  | "delivered"
  | "skipped"
  | "dead-letter";

/**
 * Outbox에는 수신자 UID, FCM token, 덱 요청의 topic/note를 넣지 않는다. 처리 시점에
 * requestId로 권위 deckRequests 문서를 다시 읽어 현재 계정과 ready 상태를 확인한다.
 */
export interface DeckReadyNotificationOutbox {
  readonly id: string;
  readonly schemaVersion: 1;
  readonly kind: "deck-ready";
  readonly requestId: string;
  readonly requestRevision: number;
  readonly status: NotificationOutboxStatus;
  readonly attemptCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastAttemptAt?: string;
  /** 처리 중인 worker만 아는 불투명 lease 식별자다. */
  readonly leaseId?: string;
  /** 이 시각 이후에는 다른 worker가 lease를 재선점할 수 있다. */
  readonly leaseUntil?: string;
  readonly completedAt?: string;
  readonly expiresAt?: string;
  readonly completionReason?: DeckReadyCompletionReason;
  readonly deliveredCount?: number;
  readonly invalidatedCount?: number;
  readonly permanentFailureCount?: number;
  readonly lastErrorCode?: "messaging-transient";
}

export type DeckReadyCompletionReason =
  | "delivered"
  | "account-unavailable"
  | "invalid-request-state"
  | "no-installations"
  | "invalid-installations"
  | "permanent-messaging-failure"
  | "retry-limit";

export interface DeckReadyNotificationTarget {
  readonly uid: string;
  readonly readyDeckId: string;
}

export interface NotificationDeliveryTarget {
  readonly installationHash: string;
  readonly fcmToken: string;
  readonly platform: NotificationPlatform;
  readonly locale: string;
}

/** 조회 뒤 계정/token이 재바인딩된 installation을 잘못 지우지 않기 위한 비교 값이다. */
export interface NotificationInstallationInvalidation {
  readonly installationHash: string;
  readonly fcmTokenHash: string;
}

export interface DeckReadyMessage {
  readonly eventId: string;
}

export interface NotificationSendResult {
  readonly deliveredCount: number;
  readonly invalidInstallationHashes: readonly string[];
  readonly transientFailureCount: number;
  readonly permanentFailureCount: number;
}
