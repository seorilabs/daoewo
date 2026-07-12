import { getAppCheck } from "firebase-admin/app-check";
import { getAuth } from "firebase-admin/auth";
import { logger } from "firebase-functions";
import { defineSecret, defineString } from "firebase-functions/params";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { onMessagePublished } from "firebase-functions/v2/pubsub";
import type { CallableRequest } from "firebase-functions/v2/https";
import { services } from "./app.js";
import { BACKEND_CONFIG } from "./config.js";
import { BackendError } from "./errors.js";
import {
  parseCatalogFilter,
  parseAnonymousAccountMerge,
  parseCreateGoal,
  parseDeactivateGoal,
  parseDeckRequest,
  parseDeleteAccount,
  parseDeliverWindow,
  parseProgressBatch,
  parsePullSyncState,
  parseReceipt,
  parseTossLoginExchange,
} from "./input.js";
import { requiresRevocationCheckForHttpPath } from "./security-policy.js";
import { StoreApiFailure } from "./receipts/providers.js";
import {
  parseGooglePlayDeveloperNotification,
  readGooglePlayPubSubJson,
} from "./store-notifications/google-play.js";
import { parseAppStoreNotificationRequest } from "./store-notifications/app-store.js";

const functionsRegion = defineString("FUNCTIONS_REGION", {
  input: {
    text: {
      validationRegex: "^[a-z]+(?:-[a-z0-9]+)+[0-9]$",
      validationErrorMessage: "FUNCTIONS_REGION must be a Google Cloud region.",
    },
  },
});
const googlePlayRtdnTopicParam = defineString("GOOGLE_PLAY_RTDN_TOPIC", {
  input: {
    text: {
      validationRegex: "^[A-Za-z][A-Za-z0-9._~+%-]{2,254}$",
      validationErrorMessage:
        "GOOGLE_PLAY_RTDN_TOPIC must be a Pub/Sub topic ID, not a full resource name.",
    },
  },
});

const callableOptions = {
  region: functionsRegion,
  enforceAppCheck: true,
  timeoutSeconds: 30,
  memory: "256MiB" as const,
};

// App Store Connect signing key와 JWS trust roots는 Secret Manager에서만 주입한다.
const appStoreIapPrivateKey = defineSecret(
  "APP_STORE_IAP_PRIVATE_KEY_BASE64",
);
const appStoreRootCertificates = defineSecret(
  "APP_STORE_ROOT_CA_CERTIFICATES_BASE64_JSON",
);
const receiptSecrets = [appStoreIapPrivateKey, appStoreRootCertificates];
export const googlePlaySubscriptionNotification = onMessagePublished(
  {
    // PubSubOptions.topic은 string 타입이므로 CEL string으로 넘긴다.
    // Firebase CLI가 discovery 후 param을 resolve해 project path를 한 번만 붙인다.
    topic: googlePlayRtdnTopicParam.toCEL(),
    region: functionsRegion,
    retry: true,
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async (event) => {
    try {
      const envelope = parseGooglePlayDeveloperNotification(
        readGooglePlayPubSubJson(event.data.message),
        event.data.message.messageId,
        BACKEND_CONFIG.googlePlayPackageName,
      );
      if (envelope.kind !== "subscription") return;
      await services.storeNotifications.process(envelope.notification);
    } catch (error) {
      if (isRetryableStoreNotificationFailure(error)) {
        logger.error("Google Play subscription notification retryable failure", {
          failure: sanitizedFailure(error),
        });
        throw error;
      }
      // Pub/Sub은 영구 payload/binding 오류를 재시도해도 해결되지 않는다.
      logger.warn("Google Play subscription notification rejected", {
        failure: sanitizedFailure(error),
      });
    }
  },
);

export const appStoreServerNotification = onRequest(
  {
    region: functionsRegion,
    timeoutSeconds: 60,
    memory: "256MiB",
    cors: false,
    invoker: "public",
    secrets: receiptSecrets,
  },
  async (request, response) => {
    response.set("Cache-Control", "no-store");
    if (request.method !== "POST") {
      response.status(405).end();
      return;
    }
    try {
      const signedPayload = parseAppStoreNotificationRequest(
        request.body as unknown,
      );
      const envelope = await services.appStoreNotificationVerifier.verify(
        signedPayload,
      );
      if (envelope.kind === "subscription") {
        await services.storeNotifications.process(envelope.notification);
      }
      // applied/idempotent/stale/missing/account-deleted/test/ignored는 모두 성공이다.
      response.status(204).end();
    } catch (error) {
      const retryable = isRetryableStoreNotificationFailure(error);
      logger[retryable ? "error" : "warn"](
        retryable
          ? "App Store server notification retryable failure"
          : "App Store server notification rejected",
        { failure: sanitizedFailure(error) },
      );
      response.status(retryable ? 503 : 400).end();
    }
  },
);

export const getCatalog = onCall(callableOptions, async (request) =>
  callable(request, async (uid) => ({
    decks: await services.catalog.list(uid, parseCatalogFilter(request.data)),
  })),
);

export const createOrResetGoal = onCall(callableOptions, async (request) =>
  mutationCallable(request, async (uid) => ({
    goal: await services.goals.createOrReset(uid, parseCreateGoal(request.data)),
  })),
);

export const deactivateGoal = onCall(callableOptions, async (request) =>
  mutationCallable(request, async (uid) => {
    const { goalId, deviceId } = parseDeactivateGoal(request.data);
    await services.goals.deactivate(uid, goalId, deviceId);
    return { ok: true };
  }),
);

export const getSyncState = onCall(callableOptions, async (request) =>
  mutationCallable(request, async (uid) => ({
    syncState: await services.study.pullSyncState(
      uid,
      parsePullSyncState(request.data),
    ),
  })),
);

export const getTodayWindow = onCall(
  { ...callableOptions, timeoutSeconds: 60, memory: "512MiB" as const },
  async (request) =>
    mutationCallable(request, async (uid) => ({
      window: await services.study.deliverTodayWindow(
        uid,
        parseDeliverWindow(request.data),
      ),
    })),
);

export const submitProgressBatch = onCall(callableOptions, async (request) =>
  mutationCallable(request, async (uid) => {
    const result = await services.study.submitProgressBatch(
      uid,
      parseProgressBatch(request.data),
    );
    return {
      idempotent: result.idempotent,
      receipt: result.receipt,
      progressRevision: result.progress.revision,
    };
  }),
);

export const createDeckRequest = onCall(callableOptions, async (request) =>
  mutationCallable(request, async (uid) => ({
    request: await services.deckRequests.create(uid, parseDeckRequest(request.data)),
  })),
);

export const getEntitlement = onCall(callableOptions, async (request) =>
  callable(request, async (uid) => services.entitlements.get(uid)),
);

export const verifyReceipt = onCall(
  { ...callableOptions, timeoutSeconds: 60, secrets: receiptSecrets },
  async (request) =>
    mutationCallable(request, async (uid) =>
      services.entitlements.verifyReceipt(uid, parseReceipt(request.data)),
    ),
);

export const mergeAnonymousAccount = onCall(callableOptions, async (request) =>
  mutationCallable(request, async (uid) => ({
    merge: await services.accountMerge.merge(
      uid,
      parseAnonymousAccountMerge(request.data),
    ),
  })),
);

export const deleteAccount = onCall(
  { ...callableOptions, timeoutSeconds: 300, memory: "512MiB" as const },
  async (request) => {
    try {
      if (request.auth === undefined) {
        throw new BackendError("unauthenticated", "Firebase Auth is required.");
      }
      if (request.app === undefined) {
        throw new BackendError("unauthenticated", "Firebase App Check is required.");
      }
      parseDeleteAccount(request.data);
      const identity = await verifyCallableDeletionIdentity(request);
      return await services.accountDeletion.delete(
        identity.uid,
        identity,
      );
    } catch (error) {
      const backendError = normalizeError(error);
      if (backendError.code === "internal") {
        logger.error("Daoewo account deletion failure", error);
      }
      throw new HttpsError(
        backendError.code,
        backendError.message,
        backendError.details,
      );
    }
  },
);

// AppsInToss 등 callable SDK를 쓸 수 없는 검증된 런타임을 위한 동일 계약의 REST 경계다.
// 일반 route는 Bearer ID token과 X-Firebase-AppCheck를 동시에 요구한다.
// AIT bootstrap/refresh route만 선행 App Check 없이 Toss identity 또는 Firebase ID token을 쓴다.
export const api = onRequest(
  {
    region: functionsRegion,
    timeoutSeconds: 60,
    memory: "512MiB",
    cors: true,
    secrets: receiptSecrets,
  },
  async (request, response) => {
    response.set("Cache-Control", "private, no-store");
    try {
      if (request.method !== "POST") {
        response.status(405).json({ error: { code: "method-not-allowed" } });
        return;
      }
      const body = request.body as unknown;
      const normalizedPath = request.path.replace(/\/+$/, "");
      if (normalizedPath === "/v1/auth/toss:exchange") {
        response.status(200).json({
          data: await services.appsInToss.exchangeLogin(
            parseTossLoginExchange(body),
            request.ip || request.socket.remoteAddress || "unknown",
          ),
        });
        return;
      }
      if (normalizedPath === "/v1/auth/toss:refreshAppCheck") {
        const identity = await verifyTossRefreshIdentity(
          request.header("authorization"),
        );
        await services.accounts.assertAccountActive(identity.uid);
        response.status(200).json({
          data: await services.appsInToss.refreshAppCheck(
            identity.uid,
            identity.signInProvider,
            request.ip || request.socket.remoteAddress || "unknown",
          ),
        });
        return;
      }
      const deletingAccount = normalizedPath === "/v1/account:delete";
      const checkRevoked = requiresRevocationCheckForHttpPath(normalizedPath);
      const identity = await verifyHttpIdentity(
        request.header("authorization"),
        request.header("x-firebase-appcheck"),
        checkRevoked,
      );
      if (deletingAccount) {
        parseDeleteAccount(body);
        response.status(200).json({
          data: await services.accountDeletion.delete(
            identity.uid,
            identity,
          ),
        });
        return;
      }
      await services.accounts.assertAccountActive(identity.uid);
      const result = await routeHttp(identity.uid, request.path, body);
      response.status(200).json({ data: result });
    } catch (error) {
      const backendError = normalizeError(error);
      if (backendError.code === "internal") logger.error("Daoewo API failure", error);
      response.status(httpStatus(backendError.code)).json({
        error: {
          code: backendError.code,
          message: backendError.message,
          ...(backendError.details === undefined ? {} : { details: backendError.details }),
        },
      });
    }
  },
);

// Toss server-to-server callback은 Firebase client Auth/App Check 대상이 아니다.
// mTLS/partner signature 검증을 provider가 통과시킨 event만 entitlement에 반영한다.
export const tossSubscriptionWebhook = onRequest(
  {
    region: functionsRegion,
    timeoutSeconds: 30,
    memory: "256MiB",
    cors: false,
  },
  async (request, response) => {
    response.set("Cache-Control", "no-store");
    try {
      if (request.method !== "POST") {
        response.status(405).json({ error: { code: "method-not-allowed" } });
        return;
      }
      const result = await services.appsInToss.processSubscriptionWebhook({
        headers: normalizeHeaders(request.headers),
        rawBody: request.rawBody,
        body: request.body as unknown,
      });
      response.status(200).json(result);
    } catch (error) {
      const backendError = normalizeError(error);
      if (backendError.code === "internal") {
        logger.error("AppsInToss subscription webhook failure", error);
      }
      const status =
        backendError.code === "failed-precondition"
          ? 503
          : httpStatus(backendError.code);
      response.status(status).json({
        error: { code: backendError.code, message: backendError.message },
      });
    }
  },
);

async function callable<T>(
  request: CallableRequest<unknown>,
  action: (uid: string) => Promise<T>,
  checkRevoked = false,
): Promise<T> {
  try {
    if (request.auth === undefined) {
      throw new BackendError("unauthenticated", "Firebase Auth is required.");
    }
    if (request.app === undefined) {
      throw new BackendError("unauthenticated", "Firebase App Check is required.");
    }
    if (checkRevoked) {
      await verifyCallableIdentity(request, true);
    }
    await services.accounts.assertAccountActive(request.auth.uid);
    return await action(request.auth.uid);
  } catch (error) {
    const backendError = normalizeError(error);
    if (backendError.code === "internal") logger.error("Daoewo callable failure", error);
    throw new HttpsError(
      backendError.code,
      backendError.message,
      backendError.details,
    );
  }
}

async function mutationCallable<T>(
  request: CallableRequest<unknown>,
  action: (uid: string) => Promise<T>,
): Promise<T> {
  return callable(request, action, true);
}

async function verifyHttpIdentity(
  authorization: string | undefined,
  appCheckToken: string | undefined,
  checkRevoked = false,
): Promise<{ uid: string; authenticatedAt: Date; signInProvider: string }> {
  if (authorization === undefined || !authorization.startsWith("Bearer ")) {
    throw new BackendError("unauthenticated", "Bearer Firebase ID token is required.");
  }
  if (appCheckToken === undefined || appCheckToken.length === 0) {
    throw new BackendError("unauthenticated", "X-Firebase-AppCheck is required.");
  }
  try {
    const [decodedIdToken] = await Promise.all([
      getAuth().verifyIdToken(authorization.slice("Bearer ".length), checkRevoked),
      getAppCheck().verifyToken(appCheckToken),
    ]);
    return {
      uid: decodedIdToken.uid,
      authenticatedAt: authenticationTime(decodedIdToken.auth_time),
      signInProvider: decodedIdToken.firebase.sign_in_provider,
    };
  } catch {
    throw new BackendError(
      "unauthenticated",
      "Firebase Auth or App Check token is invalid.",
    );
  }
}

async function verifyCallableDeletionIdentity(
  request: CallableRequest<unknown>,
): Promise<{ uid: string; authenticatedAt: Date; signInProvider: string }> {
  const decoded = await verifyCallableIdentity(request, true);
  return {
    uid: decoded.uid,
    authenticatedAt: authenticationTime(decoded.auth_time),
    signInProvider: decoded.firebase.sign_in_provider,
  };
}

async function verifyCallableIdentity(
  request: CallableRequest<unknown>,
  checkRevoked: boolean,
) {
  const authorization = request.rawRequest.header("authorization");
  if (authorization === undefined || !authorization.startsWith("Bearer ")) {
    throw new BackendError("unauthenticated", "Bearer Firebase ID token is required.");
  }
  try {
    const decoded = await getAuth().verifyIdToken(
      authorization.slice("Bearer ".length),
      checkRevoked,
    );
    if (request.auth === undefined || decoded.uid !== request.auth.uid) {
      throw new BackendError(
        "permission-denied",
        "Firebase token does not match the callable identity.",
      );
    }
    return decoded;
  } catch (error) {
    if (error instanceof BackendError) throw error;
    throw new BackendError(
      "unauthenticated",
      "Firebase ID token is invalid or revoked.",
    );
  }
}

function authenticationTime(value: unknown): Date {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new BackendError("unauthenticated", "Firebase auth_time claim is invalid.");
  }
  return new Date(value * 1_000);
}

async function verifyTossRefreshIdentity(
  authorization: string | undefined,
): Promise<{ uid: string; signInProvider: unknown }> {
  if (authorization === undefined || !authorization.startsWith("Bearer ")) {
    throw new BackendError("unauthenticated", "Bearer Firebase ID token is required.");
  }
  try {
    const decoded = await getAuth().verifyIdToken(
      authorization.slice("Bearer ".length),
      true,
    );
    return { uid: decoded.uid, signInProvider: decoded.signInProvider };
  } catch {
    throw new BackendError("unauthenticated", "Firebase ID token is invalid or revoked.");
  }
}

async function routeHttp(uid: string, path: string, body: unknown): Promise<unknown> {
  switch (path.replace(/\/+$/, "")) {
    case "/v1/catalog":
      return { decks: await services.catalog.list(uid, parseCatalogFilter(body)) };
    case "/v1/goals:createOrReset":
      return { goal: await services.goals.createOrReset(uid, parseCreateGoal(body)) };
    case "/v1/goals:deactivate": {
      const { goalId, deviceId } = parseDeactivateGoal(body);
      await services.goals.deactivate(uid, goalId, deviceId);
      return { ok: true };
    }
    case "/v1/sync:pull":
      return {
        syncState: await services.study.pullSyncState(uid, parsePullSyncState(body)),
      };
    case "/v1/windows:today":
      return {
        window: await services.study.deliverTodayWindow(uid, parseDeliverWindow(body)),
      };
    case "/v1/progress:batchSubmit": {
      const result = await services.study.submitProgressBatch(uid, parseProgressBatch(body));
      return {
        idempotent: result.idempotent,
        receipt: result.receipt,
        progressRevision: result.progress.revision,
      };
    }
    case "/v1/deckRequests:create":
      return { request: await services.deckRequests.create(uid, parseDeckRequest(body)) };
    case "/v1/entitlement":
      return services.entitlements.get(uid);
    case "/v1/receipts:verify":
      return services.entitlements.verifyReceipt(uid, parseReceipt(body));
    case "/v1/auth:mergeAnonymous":
      return {
        merge: await services.accountMerge.merge(
          uid,
          parseAnonymousAccountMerge(body),
        ),
      };
    default:
      throw new BackendError("not-found", "API route not found.");
  }
}

function normalizeError(error: unknown): BackendError {
  if (error instanceof BackendError) return error;
  return new BackendError("internal", "Internal server error.");
}

function httpStatus(code: BackendError["code"]): number {
  switch (code) {
    case "invalid-argument":
      return 400;
    case "unauthenticated":
      return 401;
    case "permission-denied":
      return 403;
    case "not-found":
      return 404;
    case "already-exists":
      return 409;
    case "failed-precondition":
      return 412;
    case "aborted":
      return 409;
    case "resource-exhausted":
      return 429;
    case "internal":
      return 500;
  }
}

function isRetryableStoreNotificationFailure(error: unknown): boolean {
  if (error instanceof StoreApiFailure) {
    return error.kind === "unavailable" || error.kind === "configuration";
  }
  if (error instanceof BackendError) {
    return (
      error.code === "internal" ||
      error.code === "aborted" ||
      error.code === "resource-exhausted" ||
      (error.code === "failed-precondition" &&
        error.message.includes("not configured"))
    );
  }
  return true;
}

function sanitizedFailure(error: unknown): Readonly<Record<string, string>> {
  if (error instanceof StoreApiFailure) {
    return { name: error.name, kind: error.kind };
  }
  if (error instanceof BackendError) {
    return { name: error.name, code: error.code };
  }
  return { name: error instanceof Error ? error.name : "UnknownFailure" };
}

function normalizeHeaders(
  headers: Readonly<Record<string, string | string[] | undefined>>,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(headers)
      .filter((entry): entry is [string, string | string[]] => entry[1] !== undefined)
      .map(([key, value]) => [key.toLowerCase(), Array.isArray(value) ? value.join(",") : value]),
  );
}
