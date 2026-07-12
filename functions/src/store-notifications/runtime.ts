import { BackendError } from "../errors.js";
import type { ReceiptAccountBindingResolver } from "../receipts/providers.js";
import {
  GoogleApisPublisherClient,
  createAppleRuntimeClientsFromEnvironment,
} from "../receipts/runtime-providers.js";
import { BACKEND_CONFIG } from "../config.js";
import {
  AppStoreAuthoritativeStateProvider,
  AppStoreNotificationVerifier,
} from "./app-store.js";
import { GooglePlayAuthoritativeStateProvider } from "./google-play.js";
import type {
  AppStoreSubscriptionNotification,
  AuthoritativeSubscriptionState,
  GooglePlaySubscriptionNotification,
  ReceiptClaimResolution,
  StoreSubscriptionStateProvider,
  VerifiedStoreNotificationEnvelope,
} from "./types.js";

export interface StoreNotificationRuntime {
  googlePlay: StoreSubscriptionStateProvider<GooglePlaySubscriptionNotification>;
  appStore: StoreSubscriptionStateProvider<AppStoreSubscriptionNotification>;
  appStoreVerifier: {
    verify(signedPayload: string): Promise<VerifiedStoreNotificationEnvelope>;
  };
}

export function createStoreNotificationRuntimeFromEnvironment(
  bindingResolver: ReceiptAccountBindingResolver,
): StoreNotificationRuntime {
  const googlePlay =
    BACKEND_CONFIG.googlePlayProductIds.length === 0
      ? new UnconfiguredGooglePlayStateProvider()
      : new GooglePlayAuthoritativeStateProvider(
          new GoogleApisPublisherClient(),
          {
            packageName: BACKEND_CONFIG.googlePlayPackageName,
            productIds: new Set(BACKEND_CONFIG.googlePlayProductIds),
          },
          bindingResolver,
          () => new Date(),
        );

  try {
    const apple = createAppleRuntimeClientsFromEnvironment();
    if (apple === null) {
      return {
        googlePlay,
        appStore: new UnconfiguredAppStoreStateProvider(),
        appStoreVerifier: new UnconfiguredAppStoreNotificationVerifier(),
      };
    }
    return {
      googlePlay,
      appStore: new AppStoreAuthoritativeStateProvider(
        apple.production,
        apple.sandbox,
        apple.config,
        bindingResolver,
        () => new Date(),
      ),
      appStoreVerifier: new AppStoreNotificationVerifier(
        apple.production,
        apple.sandbox,
        apple.config,
      ),
    };
  } catch {
    return {
      googlePlay,
      appStore: new UnconfiguredAppStoreStateProvider(),
      appStoreVerifier: new UnconfiguredAppStoreNotificationVerifier(),
    };
  }
}

class UnconfiguredGooglePlayStateProvider
  implements StoreSubscriptionStateProvider<GooglePlaySubscriptionNotification>
{
  readonly platform = "google-play" as const;

  async getState(
    _notification: GooglePlaySubscriptionNotification,
    _claim: Extract<ReceiptClaimResolution, { kind: "claimed" }>,
  ): Promise<AuthoritativeSubscriptionState> {
    throw unconfigured("Google Play");
  }
}

class UnconfiguredAppStoreStateProvider
  implements StoreSubscriptionStateProvider<AppStoreSubscriptionNotification>
{
  readonly platform = "app-store" as const;

  async getState(
    _notification: AppStoreSubscriptionNotification,
    _claim: Extract<ReceiptClaimResolution, { kind: "claimed" }>,
  ): Promise<AuthoritativeSubscriptionState> {
    throw unconfigured("App Store");
  }
}

class UnconfiguredAppStoreNotificationVerifier {
  async verify(_signedPayload: string): Promise<VerifiedStoreNotificationEnvelope> {
    throw unconfigured("App Store");
  }
}

function unconfigured(store: string): BackendError {
  return new BackendError(
    "failed-precondition",
    `${store} server notification provider is not configured.`,
  );
}
