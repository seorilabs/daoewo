import { BACKEND_CONFIG } from "../config.js";
import {
  GoogleApisPublisherClient,
  createAppleRuntimeClientsFromEnvironment,
} from "../receipts/runtime-providers.js";
import { StoreApiFailure } from "../receipts/providers.js";
import { AppStoreNotificationVerifier } from "./app-store.js";
import {
  createAppleNotificationHistorySource,
  createGoogleVoidedPurchasesSource,
} from "./reconciliation-sources.js";
import type { StoreReconciliationSource } from "./reconciliation.js";

export interface StoreReconciliationRuntime {
  googlePlay: StoreReconciliationSource;
  appStoreProduction: StoreReconciliationSource;
  appStoreSandbox: StoreReconciliationSource;
}

export function createStoreReconciliationRuntimeFromEnvironment(): StoreReconciliationRuntime {
  const googlePlay =
    BACKEND_CONFIG.googlePlayProductIds.length === 0
      ? unconfiguredSource("google-play-voided")
      : createGoogleVoidedPurchasesSource({
          client: new GoogleApisPublisherClient(),
          packageName: BACKEND_CONFIG.googlePlayPackageName,
        });
  try {
    const apple = createAppleRuntimeClientsFromEnvironment();
    if (apple === null) {
      return {
        googlePlay,
        appStoreProduction: unconfiguredSource("app-store-production-history"),
        appStoreSandbox: unconfiguredSource("app-store-sandbox-history"),
      };
    }
    const verifier = new AppStoreNotificationVerifier(
      apple.production,
      apple.sandbox,
      apple.config,
    );
    return {
      googlePlay,
      appStoreProduction: createAppleNotificationHistorySource({
        client: apple.production,
        verifier,
        environment: "production",
      }),
      appStoreSandbox: createAppleNotificationHistorySource({
        client: apple.sandbox,
        verifier,
        environment: "sandbox",
      }),
    };
  } catch {
    return {
      googlePlay,
      appStoreProduction: unconfiguredSource("app-store-production-history"),
      appStoreSandbox: unconfiguredSource("app-store-sandbox-history"),
    };
  }
}

function unconfiguredSource(key: string): StoreReconciliationSource {
  return {
    key,
    lookbackMs: 24 * 60 * 60 * 1_000,
    overlapMs: 60 * 60 * 1_000,
    staleWindowGraceMs: 60 * 60 * 1_000,
    async listPage() {
      throw new StoreApiFailure("configuration");
    },
  };
}
