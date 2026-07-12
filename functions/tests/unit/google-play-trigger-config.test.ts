import { deleteApp, getApps } from "firebase-admin/app";
import { afterAll, describe, expect, it, vi } from "vitest";

describe("googlePlaySubscriptionNotification trigger", () => {
  afterAll(async () => {
    await Promise.all(getApps().map((app) => deleteApp(app)));
    vi.unstubAllEnvs();
  });

  it("exports a deploy-resolved topic parameter without reading its value during discovery", async () => {
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
      }),
    );

    const { googlePlaySubscriptionNotification } = await import(
      "../../src/index.js"
    );
    const trigger = googlePlaySubscriptionNotification as typeof googlePlaySubscriptionNotification & {
      __endpoint: {
        eventTrigger: { eventFilters: { topic: string } };
      };
      __trigger: {
        eventTrigger: { resource: string };
      };
    };
    expect(trigger.__endpoint.eventTrigger.eventFilters.topic).toBe(
      "{{ params.GOOGLE_PLAY_RTDN_TOPIC }}",
    );
    expect(trigger.__trigger.eventTrigger.resource).toBe(
      "projects/demo-daoewo/topics/{{ params.GOOGLE_PLAY_RTDN_TOPIC }}",
    );
  }, 15_000);
});
