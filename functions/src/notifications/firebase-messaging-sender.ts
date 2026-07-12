import type {
  BatchResponse,
  Messaging,
  MulticastMessage,
} from "firebase-admin/messaging";
import type {
  DeckReadyMessage,
  NotificationDeliveryTarget,
  NotificationSendResult,
} from "./types.js";

const FCM_MULTICAST_LIMIT = 500;
const INVALID_REGISTRATION_CODES = new Set([
  "messaging/invalid-registration-token",
  "messaging/registration-token-not-registered",
]);
const PERMANENT_MESSAGE_CODES = new Set([
  "messaging/invalid-argument",
  "messaging/invalid-package-name",
  "messaging/mismatched-credential",
  "messaging/third-party-auth-error",
]);

export interface DeckReadyNotificationSender {
  sendDeckReady(
    message: DeckReadyMessage,
    targets: readonly NotificationDeliveryTarget[]
  ): Promise<NotificationSendResult>;
}

export interface CatalogPublishedNotificationSender {
  sendCatalogPublished(
    message: { readonly eventId: string },
    targets: readonly NotificationDeliveryTarget[]
  ): Promise<NotificationSendResult>;
}

/** 원본 Admin SDK error를 trigger 밖으로 내보내지 않는 비민감 retry 오류다. */
export class NotificationMessagingRetryError extends Error {
  readonly safeCode = "messaging-transient" as const;

  constructor() {
    super("Notification messaging transport is temporarily unavailable.");
    this.name = "NotificationMessagingRetryError";
  }
}

export class FirebaseMessagingSender
  implements DeckReadyNotificationSender, CatalogPublishedNotificationSender
{
  constructor(
    private readonly messaging: Pick<Messaging, "sendEachForMulticast">
  ) {}

  sendCatalogPublished(
    message: { readonly eventId: string },
    targets: readonly NotificationDeliveryTarget[]
  ): Promise<NotificationSendResult> {
    return this.sendMulticast(targets, (chunk) =>
      catalogPublishedMulticastMessage(message, chunk)
    );
  }

  async sendDeckReady(
    message: DeckReadyMessage,
    targets: readonly NotificationDeliveryTarget[]
  ): Promise<NotificationSendResult> {
    return this.sendMulticast(targets, (chunk) =>
      deckReadyMulticastMessage(message, chunk)
    );
  }

  private async sendMulticast(
    targets: readonly NotificationDeliveryTarget[],
    createMessage: (
      chunk: readonly NotificationDeliveryTarget[]
    ) => MulticastMessage
  ): Promise<NotificationSendResult> {
    let deliveredCount = 0;
    let transientFailureCount = 0;
    let permanentFailureCount = 0;
    const invalidInstallationHashes: string[] = [];

    for (let start = 0; start < targets.length; start += FCM_MULTICAST_LIMIT) {
      const chunk = targets.slice(start, start + FCM_MULTICAST_LIMIT);
      let response: BatchResponse;
      try {
        response = await this.messaging.sendEachForMulticast(
          createMessage(chunk)
        );
      } catch {
        // Admin error message에는 provider payload가 들어갈 수 있으므로 그대로 던지거나 로그하지 않는다.
        throw new NotificationMessagingRetryError();
      }

      response.responses.forEach((result, index) => {
        const target = chunk[index];
        if (target === undefined) {
          transientFailureCount += 1;
          return;
        }
        if (result.success) {
          deliveredCount += 1;
          return;
        }
        const code = safeMessagingCode(result.error?.code);
        if (INVALID_REGISTRATION_CODES.has(code)) {
          invalidInstallationHashes.push(target.installationHash);
        } else if (PERMANENT_MESSAGE_CODES.has(code)) {
          permanentFailureCount += 1;
        } else {
          transientFailureCount += 1;
        }
      });
    }

    return {
      deliveredCount,
      invalidInstallationHashes,
      transientFailureCount,
      permanentFailureCount,
    };
  }
}

function catalogPublishedMulticastMessage(
  message: { readonly eventId: string },
  targets: readonly NotificationDeliveryTarget[]
): MulticastMessage {
  return {
    tokens: targets.map((target) => target.fcmToken),
    notification: {
      title: "다외워",
      body: "새로운 덱이 공개됐어요.",
    },
    data: { kind: "catalog-published" },
    android: {
      collapseKey: message.eventId,
      notification: { tag: message.eventId },
    },
    apns: {
      headers: { "apns-collapse-id": message.eventId },
      payload: { aps: { threadId: "deck-updates" } },
    },
  };
}

function deckReadyMulticastMessage(
  message: DeckReadyMessage,
  targets: readonly NotificationDeliveryTarget[]
): MulticastMessage {
  return {
    tokens: targets.map((target) => target.fcmToken),
    notification: {
      title: "다외워",
      body: "요청한 덱이 준비됐어요.",
    },
    data: {
      kind: "deck-ready",
    },
    android: {
      collapseKey: message.eventId,
      notification: { tag: message.eventId },
    },
    apns: {
      headers: { "apns-collapse-id": message.eventId },
      payload: { aps: { threadId: "deck-ready" } },
    },
  };
}

function safeMessagingCode(value: unknown): string {
  return typeof value === "string" && /^messaging\/[a-z0-9-]+$/.test(value)
    ? value
    : "messaging/unknown-error";
}
