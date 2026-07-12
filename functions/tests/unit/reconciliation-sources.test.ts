import { describe, expect, it, vi } from "vitest";
import {
  createAppleNotificationHistorySource,
  createGoogleVoidedPurchasesSource,
} from "../../src/store-notifications/reconciliation-sources.js";

describe("store reconciliation sources", () => {
  it("keeps a Google voided token only in the in-memory authoritative envelope", async () => {
    const listVoidedPurchases = vi.fn(async () => ({
      items: [
        {
          purchaseToken: "raw-token-in-memory",
          orderId: "GPA.1234-5678-9012-34567..0",
          voidedTimeMillis: "1783825200000",
        },
      ],
      nextPageToken: "next-google-page",
    }));
    const source = createGoogleVoidedPurchasesSource({
      client: { listVoidedPurchases },
      packageName: "com.seorilabs.daoewo",
    });

    const page = await source.listPage({
      startTime: new Date("2026-07-11T00:00:00.000Z"),
      endTime: new Date("2026-07-12T00:00:00.000Z"),
      pageToken: null,
    });

    expect(page.nextPageToken).toBe("next-google-page");
    expect(page.envelopes[0]).toMatchObject({
      kind: "subscription",
      notification: {
        platform: "google-play",
        notificationType: "voided-purchase",
        voidedOrderId: "GPA.1234-5678-9012-34567..0",
      },
    });
    const serialized = JSON.stringify(page.envelopes[0]);
    // Envelope는 provider 호출 동안 token을 보유한다. cursor는 이 envelope를 받지 않고,
    // repository event persistence는 별도 회귀 테스트에서 raw field를 거부한다.
    expect(serialized).toContain("raw-token-in-memory");
    expect(listVoidedPurchases).toHaveBeenCalledWith(
      expect.objectContaining({ pageToken: null }),
    );
  });

  it("requests only failed Apple history and verifies JWS before returning envelopes", async () => {
    const listNotificationHistory = vi.fn(async () => ({
      signedPayloads: ["signed-jws-in-memory"],
      nextPageToken: null,
    }));
    const verify = vi.fn(async () => ({
      kind: "test" as const,
      platform: "app-store" as const,
      eventId: "apple-test",
    }));
    const source = createAppleNotificationHistorySource({
      client: { listNotificationHistory },
      verifier: { verify },
      environment: "production",
    });

    await expect(
      source.listPage({
        startTime: new Date("2026-07-11T00:00:00.000Z"),
        endTime: new Date("2026-07-12T00:00:00.000Z"),
        pageToken: null,
      }),
    ).resolves.toEqual({
      envelopes: [{ kind: "test", platform: "app-store", eventId: "apple-test" }],
      nextPageToken: null,
    });
    expect(listNotificationHistory).toHaveBeenCalledWith(
      expect.objectContaining({ onlyFailures: true }),
    );
    expect(verify).toHaveBeenCalledWith("signed-jws-in-memory");
  });
});
