import { readFileSync } from "node:fs";
import { deleteApp, getApps } from "firebase-admin/app";
import { afterAll, describe, expect, it, vi } from "vitest";

describe("notification function exports", () => {
  afterAll(async () => {
    await Promise.all(getApps().map((app) => deleteApp(app)));
    vi.unstubAllEnvs();
  });

  it("exports retryable Firestore triggers and App Check-enforced callables", async () => {
    stubBackendEnvironment();
    const functions = await import("../../src/index.js");

    expect(eventEndpoint(functions.enqueueDeckReadyNotification)).toMatchObject(
      {
        eventType: "google.cloud.firestore.document.v1.updated",
        eventFilterPathPatterns: { document: "deckRequests/{requestId}" },
        retry: true,
      }
    );
    expect(
      eventEndpoint(functions.processDeckReadyNotificationOutbox)
    ).toMatchObject({
      eventType: "google.cloud.firestore.document.v1.created",
      eventFilterPathPatterns: {
        document: "notificationOutbox/{eventId}",
      },
      retry: true,
    });
    expect(
      eventEndpoint(functions.sendCatalogPublishedNotification)
    ).toMatchObject({
      eventType: "google.cloud.firestore.document.v1.written",
      eventFilterPathPatterns: { document: "decks/{deckId}" },
      retry: true,
    });
    expect(eventEndpoint(functions.processAccountMergeCleanup)).toMatchObject({
      eventType: "google.cloud.firestore.document.v1.created",
      eventFilterPathPatterns: { document: "accountMerges/{sourceUid}" },
      retry: true,
    });
    expect(
      scheduleEndpoint(functions.accountMergeCleanupReconciliation)
    ).toMatchObject({
      maxInstances: 1,
      concurrency: 1,
      scheduleTrigger: {
        schedule: "every 15 minutes",
        timeZone: "UTC",
        retryConfig: {
          retryCount: 3,
          minBackoffSeconds: 60,
          maxBackoffSeconds: 300,
          maxRetrySeconds: 900,
        },
      },
    });

    for (const callable of [
      functions.completeDeckRequest,
      functions.registerNotificationInstallation,
      functions.unregisterNotificationInstallation,
    ]) {
      expect(
        (callable as unknown as { __endpoint: { callableTrigger?: object } })
          .__endpoint.callableTrigger
      ).toEqual({});
      expect(
        (
          callable as unknown as {
            __trigger: { httpsTrigger: { allowInsecure: boolean } };
          }
        ).__trigger.httpsTrigger.allowInsecure
      ).toBe(false);
    }
  }, 15_000);

  it("declares the bounded account-merge cleanup sweep composite index", () => {
    const config = JSON.parse(
      readFileSync(
        new URL("../../../firebase/firestore.indexes.json", import.meta.url),
        "utf8"
      )
    ) as {
      indexes: Array<{
        collectionGroup: string;
        queryScope: string;
        fields: Array<{ fieldPath: string; order: string }>;
      }>;
    };
    expect(config.indexes).toContainEqual({
      collectionGroup: "accountMerges",
      queryScope: "COLLECTION",
      fields: [
        { fieldPath: "schemaVersion", order: "ASCENDING" },
        { fieldPath: "cleanupStatus", order: "ASCENDING" },
        { fieldPath: "cleanupUpdatedAt", order: "ASCENDING" },
      ],
    });
  });
});

function eventEndpoint(value: unknown) {
  return (
    value as {
      __endpoint: {
        eventTrigger: {
          eventType: string;
          eventFilterPathPatterns: Record<string, string>;
          retry: boolean;
        };
      };
    }
  ).__endpoint.eventTrigger;
}

function scheduleEndpoint(value: unknown) {
  return (
    value as {
      __endpoint: {
        maxInstances: number;
        concurrency: number;
        scheduleTrigger: {
          schedule: string;
          timeZone: string;
          retryConfig: Record<string, number>;
        };
      };
    }
  ).__endpoint;
}

function stubBackendEnvironment(): void {
  vi.stubEnv("FUNCTIONS_REGION", "asia-northeast3");
  vi.stubEnv("GOOGLE_PLAY_PRODUCT_IDS", "daoewo.pro.monthly");
  vi.stubEnv("APP_STORE_APP_APPLE_ID", "1234567890");
  vi.stubEnv("APP_STORE_PRODUCT_IDS", "daoewo.pro.monthly");
  vi.stubEnv("APP_STORE_IAP_ISSUER_ID", "issuer-id");
  vi.stubEnv("APP_STORE_IAP_KEY_ID", "key-id");
  vi.stubEnv("GCLOUD_PROJECT", "demo-daoewo");
  vi.stubEnv(
    "FIREBASE_CONFIG",
    JSON.stringify({
      projectId: "demo-daoewo",
      storageBucket: "demo-daoewo.appspot.com",
    })
  );
}
