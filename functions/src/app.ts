import { getApps, initializeApp } from "firebase-admin/app";
import { getAppCheck } from "firebase-admin/app-check";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { getStorage } from "firebase-admin/storage";
import { systemClock } from "./domain/types.js";
import { failClosedAppsInTossPartnerProvider } from "./apps-in-toss/provider.js";
import { createReceiptProvidersFromEnvironment } from "./receipts/runtime-providers.js";
import { FirestoreReceiptAccountBindingResolver } from "./receipts/firestore-account-binding-resolver.js";
import { CloudStorageDeckContentRepository } from "./repositories/cloud-storage-deck-content.js";
import { FirestoreRepository } from "./repositories/firestore-repository.js";
import { CatalogService } from "./services/catalog-service.js";
import { DeckRequestService } from "./services/deck-request-service.js";
import { EntitlementService } from "./services/entitlement-service.js";
import { GoalService } from "./services/goal-service.js";
import { StudyService } from "./services/study-service.js";
import { AppsInTossService } from "./services/apps-in-toss-service.js";
import { BACKEND_CONFIG } from "./config.js";
import { AccountMergeService } from "./services/account-merge-service.js";
import { AccountDeletionService } from "./services/account-deletion-service.js";
import { createStoreNotificationRuntimeFromEnvironment } from "./store-notifications/runtime.js";
import { StoreNotificationService } from "./store-notifications/service.js";
import { StoreReconciliationService } from "./store-notifications/reconciliation.js";
import { FirestoreReconciliationCursorRepository } from "./store-notifications/firestore-reconciliation-cursor.js";
import { createStoreReconciliationRuntimeFromEnvironment } from "./store-notifications/reconciliation-runtime.js";
import { NotificationInstallationService } from "./notifications/installation-service.js";
import { DeckReadyNotificationService } from "./notifications/deck-ready-outbox.js";
import { FirebaseMessagingSender } from "./notifications/firebase-messaging-sender.js";
import { CatalogPublishedNotificationService } from "./notifications/catalog-published.js";
import { DeckRequestOperatorService } from "./services/deck-request-operator-service.js";
import { AccountMergeCleanupService } from "./services/account-merge-cleanup-service.js";

if (getApps().length === 0) initializeApp();

const repository = new FirestoreRepository(getFirestore(), getAuth());
const content = new CloudStorageDeckContentRepository(getStorage().bucket());
const receiptBindingResolver = new FirestoreReceiptAccountBindingResolver(
  getFirestore()
);
const receiptProviders = createReceiptProvidersFromEnvironment(
  receiptBindingResolver
);
const storeNotificationRuntime = createStoreNotificationRuntimeFromEnvironment(
  receiptBindingResolver
);
export const storeReconciliationSources =
  createStoreReconciliationRuntimeFromEnvironment();
const storeNotifications = new StoreNotificationService(
  repository,
  storeNotificationRuntime.googlePlay,
  storeNotificationRuntime.appStore,
  systemClock
);
const notificationSender = new FirebaseMessagingSender(getMessaging());

export const services = Object.freeze({
  catalog: new CatalogService(repository, repository, systemClock),
  goals: new GoalService(
    repository,
    repository,
    repository,
    repository,
    systemClock
  ),
  study: new StudyService(repository, content, repository, systemClock),
  deckRequests: new DeckRequestService(repository, repository, systemClock),
  deckRequestOperator: new DeckRequestOperatorService(repository, systemClock),
  entitlements: new EntitlementService(
    repository,
    repository,
    receiptProviders,
    systemClock
  ),
  appsInToss: new AppsInTossService(
    failClosedAppsInTossPartnerProvider,
    repository,
    repository,
    getAuth(),
    getAppCheck(),
    BACKEND_CONFIG.tossFirebaseAppId,
    repository,
    systemClock
  ),
  accounts: repository,
  accountMerge: new AccountMergeService(getAuth(), repository, systemClock),
  accountMergeCleanup: new AccountMergeCleanupService(repository, systemClock),
  accountDeletion: new AccountDeletionService(
    getAuth(),
    repository,
    systemClock
  ),
  notificationInstallations: new NotificationInstallationService(
    repository,
    systemClock
  ),
  deckReadyNotifications: new DeckReadyNotificationService(
    repository,
    repository,
    notificationSender,
    systemClock
  ),
  catalogPublishedNotifications: new CatalogPublishedNotificationService(
    repository,
    repository,
    notificationSender,
    systemClock
  ),
  storeNotifications,
  storeReconciliation: new StoreReconciliationService(
    new FirestoreReconciliationCursorRepository(getFirestore()),
    repository,
    storeNotifications,
    systemClock
  ),
  appStoreNotificationVerifier: storeNotificationRuntime.appStoreVerifier,
});
