import { randomUUID } from "node:crypto";
import type { Clock } from "../domain/types.js";
import { BackendError, assertBackend } from "../errors.js";
import type {
  CatalogNotificationEventRepository,
  NotificationRepository,
} from "../repositories/contracts.js";
import { sha256 } from "../utils/hash.js";
import { addHours } from "../utils/time.js";
import {
  NotificationMessagingRetryError,
  type CatalogPublishedNotificationSender,
} from "./firebase-messaging-sender.js";
import { notificationInstallationInvalidations } from "./policy.js";

export const CATALOG_NOTIFICATION_EVENT_TTL_HOURS = 30 * 24;
export const CATALOG_NOTIFICATION_LEASE_MINUTES = 5;
export const MAX_CATALOG_NOTIFICATION_ATTEMPTS = 8;

export class CatalogPublishedNotificationRetryError extends Error {
  readonly safeCode = "delivery-contention" as const;

  constructor() {
    super("Catalog notification delivery should be retried.");
    this.name = "CatalogPublishedNotificationRetryError";
  }
}

export interface CatalogPublicationState {
  readonly status: unknown;
  readonly version: unknown;
  readonly publishedAt: unknown;
}

export class CatalogPublishedNotificationService {
  constructor(
    private readonly events: CatalogNotificationEventRepository,
    private readonly notifications: NotificationRepository,
    private readonly sender: CatalogPublishedNotificationSender,
    private readonly clock: Clock,
    private readonly createLeaseId: () => string = randomUUID
  ) {}

  async send(input: {
    readonly deckId: string;
    readonly before: CatalogPublicationState;
    readonly after: CatalogPublicationState;
  }): Promise<{ readonly sent: boolean; readonly eventId: string | null }> {
    if (
      input.before.status === "published" ||
      isValidPublishedAt(input.before.publishedAt) ||
      input.after.status !== "published"
    ) {
      return { sent: false, eventId: null };
    }
    assertBackend(
      /^[A-Za-z0-9_-]{1,128}$/.test(input.deckId),
      "failed-precondition",
      "Published deck ID is invalid.",
      { kind: "catalog-publication-invalid" }
    );
    assertBackend(
      typeof input.after.version === "number" &&
        Number.isSafeInteger(input.after.version) &&
        input.after.version > 0,
      "failed-precondition",
      "Published deck version is invalid.",
      { kind: "catalog-publication-invalid" }
    );
    assertBackend(
      isValidPublishedAt(input.after.publishedAt),
      "failed-precondition",
      "Published deck timestamp is invalid.",
      { kind: "catalog-publication-invalid" }
    );

    const eventId = catalogPublishedNotificationEventId(
      input.deckId,
      input.after.version
    );
    const now = this.clock.now();
    const leaseId = this.createLeaseId();
    let claimed: boolean;
    try {
      claimed = await this.events.claimCatalogNotificationEvent({
        eventId,
        leaseId,
        now,
        leaseUntil: new Date(
          now.getTime() + CATALOG_NOTIFICATION_LEASE_MINUTES * 60 * 1_000
        ),
        expiresAt: addHours(now, CATALOG_NOTIFICATION_EVENT_TTL_HOURS),
        maxAttempts: MAX_CATALOG_NOTIFICATION_ATTEMPTS,
      });
    } catch (error) {
      if (
        error instanceof BackendError &&
        error.details?.kind === "catalog-notification-lease-active"
      ) {
        throw new CatalogPublishedNotificationRetryError();
      }
      throw error;
    }
    if (!claimed) return { sent: false, eventId };
    const targets =
      await this.notifications.listCatalogNotificationInstallations(now);
    if (targets.length === 0) {
      await this.events.completeCatalogNotificationEvent({
        eventId,
        leaseId,
        status: "delivered",
        now: this.clock.now(),
      });
      return { sent: false, eventId };
    }
    let result;
    try {
      result = await this.sender.sendCatalogPublished({ eventId }, targets);
    } catch (error) {
      await this.events
        .completeCatalogNotificationEvent({
          eventId,
          leaseId,
          status: "failed",
          now: this.clock.now(),
        })
        .catch(() => undefined);
      throw error;
    }
    await this.notifications
      .deleteCatalogNotificationInstallations(
        notificationInstallationInvalidations(
          targets,
          result.invalidInstallationHashes
        )
      )
      .catch(() => undefined);
    if (result.transientFailureCount > 0) {
      await this.events.completeCatalogNotificationEvent({
        eventId,
        leaseId,
        status: "failed",
        now: this.clock.now(),
      });
      throw new NotificationMessagingRetryError();
    }
    await this.events.completeCatalogNotificationEvent({
      eventId,
      leaseId,
      status: "delivered",
      now: this.clock.now(),
    });
    return { sent: result.deliveredCount > 0, eventId };
  }
}

export function catalogPublishedNotificationEventId(
  deckId: string,
  version: number
): string {
  return sha256(`catalog-published:${deckId}:${version}`);
}

export function catalogPublicationState(
  value: Readonly<Record<string, unknown>> | undefined
): CatalogPublicationState {
  return value === undefined
    ? { status: undefined, version: undefined, publishedAt: undefined }
    : {
        status: value.status,
        version: value.version,
        publishedAt: value.publishedAt,
      };
}

function isValidPublishedAt(value: unknown): boolean {
  if (value instanceof Date) return Number.isFinite(value.getTime());
  if (typeof value === "string") return Number.isFinite(Date.parse(value));
  if (value === null || typeof value !== "object") return false;
  const candidate = value as { readonly toDate?: unknown };
  if (typeof candidate.toDate !== "function") return false;
  try {
    const date = candidate.toDate.call(value) as unknown;
    return date instanceof Date && Number.isFinite(date.getTime());
  } catch {
    return false;
  }
}

export function isCatalogPublicationInputError(error: unknown): boolean {
  return (
    error instanceof BackendError &&
    error.details?.kind === "catalog-publication-invalid"
  );
}
