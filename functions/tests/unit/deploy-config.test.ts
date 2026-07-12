import { describe, expect, it } from "vitest";
import {
  renderFunctionsRuntimeDotenv,
  requireGooglePlayRtdnTopicId,
  validateFunctionsDeployEnvironment,
} from "../../src/deploy-config.js";

describe("validateFunctionsDeployEnvironment", () => {
  it("fails closed when any notification authority setting is missing", () => {
    expect(() => validateFunctionsDeployEnvironment({})).toThrow(
      "FUNCTIONS_REGION",
    );
    const valid = validEnvironment();
    for (const name of [
      "GOOGLE_PLAY_RTDN_TOPIC",
      "GOOGLE_PLAY_PRODUCT_IDS",
      "APP_STORE_APP_APPLE_ID",
      "APP_STORE_PRODUCT_IDS",
      "APP_STORE_IAP_ISSUER_ID",
      "APP_STORE_IAP_KEY_ID",
      "TOSS_FIREBASE_APP_ID",
    ]) {
      expect(() =>
        validateFunctionsDeployEnvironment({ ...valid, [name]: "" }),
      ).toThrow(name);
    }
  });

  it("accepts explicit region/topic/allowlists and Apple identifiers", () => {
    expect(validateFunctionsDeployEnvironment(validEnvironment())).toMatchObject({
      region: "asia-northeast3",
      googlePlayRtdnTopic: "daoewo-google-play-rtdn",
      googlePlayProductIds: ["daoewo.pro.monthly", "daoewo.pro.yearly"],
      appStoreAppAppleId: 1234567890,
    });
  });

  it("rejects invalid region, duplicate products, and Apple app IDs", () => {
    expect(() =>
      validateFunctionsDeployEnvironment({
        ...validEnvironment(),
        FUNCTIONS_REGION: "unknown",
      }),
    ).toThrow("FUNCTIONS_REGION");
    expect(() =>
      validateFunctionsDeployEnvironment({
        ...validEnvironment(),
        GOOGLE_PLAY_PRODUCT_IDS: "same,same",
      }),
    ).toThrow("GOOGLE_PLAY_PRODUCT_IDS");
    expect(() =>
      validateFunctionsDeployEnvironment({
        ...validEnvironment(),
        APP_STORE_APP_APPLE_ID: "0",
      }),
    ).toThrow("APP_STORE_APP_APPLE_ID");
    expect(() =>
      validateFunctionsDeployEnvironment({
        ...validEnvironment(),
        GOOGLE_PLAY_RTDN_TOPIC:
          "projects/daoewo-project/topics/google-play-rtdn",
      }),
    ).toThrow("topic ID");
  });

  it("stages validated non-secret runtime config and never secret values", () => {
    const dotenv = renderFunctionsRuntimeDotenv(
      validateFunctionsDeployEnvironment({
        ...validEnvironment(),
        DECK_CHUNK_SIZE: "240",
        APP_STORE_IAP_PRIVATE_KEY_BASE64: "must-not-be-staged",
      }),
    );
    expect(dotenv).toContain(
      'GOOGLE_PLAY_RTDN_TOPIC="daoewo-google-play-rtdn"',
    );
    expect(dotenv).toContain('FUNCTIONS_REGION="asia-northeast3"');
    expect(dotenv).toContain('TOSS_FIREBASE_APP_ID="1:123:web:abc"');
    expect(dotenv).toContain('DECK_CHUNK_SIZE="240"');
    expect(dotenv).not.toContain("PRIVATE_KEY");
    expect(dotenv).not.toContain("ROOT_CA");
    expect(dotenv).not.toContain("must-not-be-staged");
  });

  it("rejects a full resource name at the export boundary helper", () => {
    expect(() =>
      requireGooglePlayRtdnTopicId(
        "projects/daoewo/topics/daoewo-google-play-rtdn",
      ),
    ).toThrow("topic ID");
  });
});

function validEnvironment(): Record<string, string> {
  return {
    FUNCTIONS_REGION: "asia-northeast3",
    GOOGLE_PLAY_RTDN_TOPIC: "daoewo-google-play-rtdn",
    GOOGLE_PLAY_PRODUCT_IDS: "daoewo.pro.monthly,daoewo.pro.yearly",
    APP_STORE_APP_APPLE_ID: "1234567890",
    APP_STORE_PRODUCT_IDS: "daoewo.pro.monthly,daoewo.pro.yearly",
    APP_STORE_IAP_ISSUER_ID: "issuer-id",
    APP_STORE_IAP_KEY_ID: "key-id",
    TOSS_FIREBASE_APP_ID: "1:123:web:abc",
  };
}
