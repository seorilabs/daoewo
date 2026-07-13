import { isIP } from "node:net";

const UNRESOLVED_PATTERN = /(?:확정 필요|\bTBD\b|\bTODO\b)/i;
const PLACEHOLDER_HOSTS = new Set([
  "example.com",
  "example.net",
  "example.org",
  "placehold.co",
]);
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;

export const APP_PRIVACY_DATA_CONTRACT = Object.freeze({
  NSPrivacyCollectedDataTypeUserID: privacyDataType(true, [
    "NSPrivacyCollectedDataTypePurposeAppFunctionality",
  ]),
  NSPrivacyCollectedDataTypeName: privacyDataType(true, [
    "NSPrivacyCollectedDataTypePurposeAppFunctionality",
  ]),
  NSPrivacyCollectedDataTypeEmailAddress: privacyDataType(true, [
    "NSPrivacyCollectedDataTypePurposeAppFunctionality",
  ]),
  NSPrivacyCollectedDataTypeCoarseLocation: privacyDataType(true, [
    "NSPrivacyCollectedDataTypePurposeAppFunctionality",
  ]),
  NSPrivacyCollectedDataTypePurchaseHistory: privacyDataType(true, [
    "NSPrivacyCollectedDataTypePurposeAppFunctionality",
  ]),
  NSPrivacyCollectedDataTypeOtherUserContent: privacyDataType(true, [
    "NSPrivacyCollectedDataTypePurposeAppFunctionality",
  ]),
  NSPrivacyCollectedDataTypeProductInteraction: privacyDataType(false, [
    "NSPrivacyCollectedDataTypePurposeAnalytics",
  ]),
  NSPrivacyCollectedDataTypeCrashData: privacyDataType(false, [
    "NSPrivacyCollectedDataTypePurposeAnalytics",
  ]),
  NSPrivacyCollectedDataTypeOtherDiagnosticData: privacyDataType(false, [
    "NSPrivacyCollectedDataTypePurposeAppFunctionality",
    "NSPrivacyCollectedDataTypePurposeAnalytics",
  ]),
  NSPrivacyCollectedDataTypeOtherDataTypes: privacyDataType(true, [
    "NSPrivacyCollectedDataTypePurposeAppFunctionality",
    "NSPrivacyCollectedDataTypePurposeAnalytics",
  ]),
  NSPrivacyCollectedDataTypeDeviceID: privacyDataType(true, [
    "NSPrivacyCollectedDataTypePurposeAppFunctionality",
    "NSPrivacyCollectedDataTypePurposeAnalytics",
  ]),
});

export function isFinalizedPublicHttpsUrl(value, options = {}) {
  const optional = options.optional === true;
  if (typeof value !== "string" || value.trim().length === 0) return optional;
  if (UNRESOLVED_PATTERN.test(value)) return false;

  try {
    const url = new URL(value.trim());
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (
      url.protocol !== "https:" ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      hostname.length === 0 ||
      !hostname.includes(".") ||
      isIP(hostname) !== 0
    ) {
      return false;
    }
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal") ||
      hostname.endsWith(".test") ||
      hostname.endsWith(".invalid") ||
      hostname.endsWith(".example") ||
      hostname.includes("placeholder")
    ) {
      return false;
    }
    return ![...PLACEHOLDER_HOSTS].some(
      (placeholder) =>
        hostname === placeholder || hostname.endsWith(`.${placeholder}`)
    );
  } catch {
    return false;
  }
}

export function validateStoreScreenshotInventory({
  registrationManifest,
  play,
  appStore,
  toss,
}) {
  const errors = [];
  const items = Array.isArray(registrationManifest?.items)
    ? registrationManifest.items
    : [];
  const registeredAssets = new Map();
  for (const item of items) {
    if (typeof item?.path !== "string") continue;
    if (registeredAssets.has(item.path)) {
      errors.push(`Registration manifest path is duplicated: ${item.path}`);
    }
    registeredAssets.set(item.path, item);
  }
  const groups = [
    {
      label: "Google Play phone",
      paths: play?.assets?.phoneScreenshots,
      min: 2,
      max: 8,
      prefix: "play-store/",
      validSize: (item) => validPlayScreenshot(item, 320, 3_840),
    },
    {
      label: "Google Play 7-inch tablet",
      paths: play?.assets?.sevenInchTabletScreenshots,
      min: 2,
      max: 8,
      prefix: "play-store/",
      validSize: (item) => validPlayScreenshot(item, 320, 3_840),
    },
    {
      label: "Google Play 10-inch tablet",
      paths: play?.assets?.tenInchTabletScreenshots,
      min: 2,
      max: 8,
      prefix: "play-store/",
      validSize: (item) => validPlayScreenshot(item, 1_080, 7_680),
    },
    {
      label: "App Store iPhone",
      paths: appStore?.assets?.iphone69Screenshots,
      min: 1,
      max: 10,
      prefix: "app-store/",
      validSize: (item) =>
        oneOfSizes(item, [
          [1_260, 2_736],
          [1_290, 2_796],
          [1_320, 2_868],
          [1_242, 2_688],
          [1_284, 2_778],
        ]),
    },
    {
      label: "App Store iPad",
      paths: appStore?.assets?.ipad13Screenshots,
      min: 1,
      max: 10,
      prefix: "app-store/",
      validSize: (item) =>
        oneOfSizes(item, [
          [2_064, 2_752],
          [2_048, 2_732],
        ]),
    },
    {
      label: "AppsInToss vertical",
      paths: toss?.assets?.screenshots636x1048,
      min: 3,
      max: null,
      prefix: "apps-in-toss/",
      validSize: (item) => oneOfSizes(item, [[636, 1_048]]),
    },
  ];
  const pathOwners = new Map();

  for (const group of groups) {
    const paths = Array.isArray(group.paths) ? group.paths : [];
    if (paths.length < group.min) {
      errors.push(
        `${group.label} screenshot needs at least ${group.min}; found ${paths.length}.`
      );
    }
    if (group.max !== null && paths.length > group.max) {
      errors.push(
        `${group.label} screenshot allows at most ${group.max}; found ${paths.length}.`
      );
    }

    for (const path of paths) {
      if (typeof path !== "string" || path.trim().length === 0) {
        errors.push(
          `${group.label} screenshot path is invalid: ${String(path)}`
        );
        continue;
      }
      const previousOwner = pathOwners.get(path);
      if (previousOwner !== undefined) {
        errors.push(
          `Store screenshot path is duplicated between ${previousOwner} and ${group.label}: ${path}`
        );
      } else {
        pathOwners.set(path, group.label);
      }
      if (!path.startsWith(group.prefix)) {
        errors.push(
          `${group.label} screenshot must stay under ${group.prefix}: ${path}`
        );
      }
      const item = registeredAssets.get(path);
      if (item === undefined) {
        errors.push(
          `${group.label} screenshot is not declared in the registration manifest: ${path}`
        );
        continue;
      }
      if (item.kind !== "screenshot") {
        errors.push(
          `${group.label} asset must have manifest kind=screenshot: ${path}`
        );
      }
      if (item.transparent === true) {
        errors.push(
          `${group.label} screenshot must not contain alpha: ${path}`
        );
      }
      if (!group.validSize(item)) {
        errors.push(
          `${
            group.label
          } screenshot manifest dimensions are invalid: ${path} (${String(
            item.width
          )}x${String(item.height)})`
        );
      }
    }
  }

  return errors;
}

export function validateSubscriptionSkuParity({
  playSubscription,
  appStoreSubscription,
  mobileSubscription,
  googleAllowlist,
  appleAllowlist,
}) {
  const errors = [];
  const sets = [
    ["Google Play config", playSubscription],
    ["App Store config", appStoreSubscription],
    ["mobile runtime", mobileSubscription],
  ];

  for (const [label, value] of sets) {
    for (const plan of ["monthly", "annual"]) {
      const productId = value?.[plan];
      if (!validProductId(productId)) {
        errors.push(`${label} ${plan} product ID is not finalized.`);
      }
    }
    if (
      validProductId(value?.monthly) &&
      validProductId(value?.annual) &&
      value.monthly === value.annual
    ) {
      errors.push(`${label} monthly and annual product IDs must differ.`);
    }
  }

  for (const plan of ["monthly", "annual"]) {
    const expected = mobileSubscription?.[plan];
    if (!validProductId(expected)) continue;
    if (playSubscription?.[plan] !== expected) {
      errors.push(
        `Google Play ${plan} product ID does not match the mobile runtime.`
      );
    }
    if (appStoreSubscription?.[plan] !== expected) {
      errors.push(
        `App Store ${plan} product ID does not match the mobile runtime.`
      );
    }
  }

  for (const [label, raw] of [
    ["GOOGLE_PLAY_PRODUCT_IDS", googleAllowlist],
    ["APP_STORE_PRODUCT_IDS", appleAllowlist],
  ]) {
    if (typeof raw !== "string" || raw.trim().length === 0) continue;
    const allowlist = new Set(
      raw
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    );
    for (const productId of [
      mobileSubscription?.monthly,
      mobileSubscription?.annual,
    ]) {
      if (validProductId(productId) && !allowlist.has(productId)) {
        errors.push(
          `${label} does not contain mobile product ID ${productId}.`
        );
      }
    }
  }

  return errors;
}

export function validateAppStoreMetadata(config) {
  const errors = [];
  for (const [locale, value] of Object.entries(config?.subtitle ?? {})) {
    if ([...String(value)].length > 30) {
      errors.push(`App Store ${locale} subtitle exceeds 30 characters.`);
    }
  }
  for (const [locale, value] of Object.entries(config?.promotionalText ?? {})) {
    if ([...String(value)].length > 170) {
      errors.push(
        `App Store ${locale} promotional text exceeds 170 characters.`
      );
    }
  }
  for (const [locale, value] of Object.entries(config?.description ?? {})) {
    if ([...String(value)].length > 4_000) {
      errors.push(`App Store ${locale} description exceeds 4000 characters.`);
    }
  }
  for (const [locale, value] of Object.entries(config?.keywords ?? {})) {
    const bytes = Buffer.byteLength(String(value), "utf8");
    if (bytes > 100) {
      errors.push(
        `App Store ${locale} keywords exceed 100 UTF-8 bytes (${bytes}).`
      );
    }
  }
  if (config?.contentRights !== "licensed-and-reviewed-curated-content") {
    errors.push("App Store content rights review is not complete.");
  }
  const collected = new Set(config?.privacy?.collected ?? []);
  for (const required of [
    "name-email-and-user-id-for-federated-account",
    "coarse-location-from-sign-in-ip-for-fraud-prevention",
    "native-crash-state-and-other-diagnostics",
    "fcm-installation-token-and-device-metadata",
  ]) {
    if (!collected.has(required)) {
      errors.push(`App Store privacy inventory is missing: ${required}.`);
    }
  }
  errors.push(...validateAppStorePrivacyContract(config?.privacy));
  return errors;
}

export function validateAppStorePrivacyContract(privacy) {
  const errors = [];
  if (privacy?.tracking !== false) {
    errors.push("App Store privacy tracking must be false.");
  }
  const actualTypes = privacy?.dataTypes;
  if (
    actualTypes === null ||
    typeof actualTypes !== "object" ||
    Array.isArray(actualTypes)
  ) {
    return [...errors, "App Store privacy dataTypes contract is missing."];
  }

  for (const [dataType, expected] of Object.entries(
    APP_PRIVACY_DATA_CONTRACT
  )) {
    const actual = actualTypes[dataType];
    if (actual === undefined) {
      errors.push(`App Store privacy dataTypes is missing ${dataType}.`);
      continue;
    }
    errors.push(
      ...validatePrivacyDataType({
        label: `App Store privacy ${dataType}`,
        actual,
        expected,
        linkedKey: "linked",
        trackingKey: "tracking",
        purposesKey: "purposes",
      })
    );
  }

  for (const dataType of Object.keys(actualTypes)) {
    if (!(dataType in APP_PRIVACY_DATA_CONTRACT)) {
      errors.push(`App Store privacy dataTypes has unexpected ${dataType}.`);
    }
  }
  return errors;
}

export function validatePrivacyInfoManifest(manifest) {
  const errors = [];
  if (manifest?.NSPrivacyTracking !== false) {
    errors.push("App PrivacyInfo NSPrivacyTracking must be false.");
  }
  const collected = manifest?.NSPrivacyCollectedDataTypes;
  if (!Array.isArray(collected)) {
    return [
      ...errors,
      "App PrivacyInfo NSPrivacyCollectedDataTypes must be an array.",
    ];
  }

  const actualTypes = new Map();
  for (const entry of collected) {
    const dataType = entry?.NSPrivacyCollectedDataType;
    if (typeof dataType !== "string" || dataType.length === 0) {
      errors.push(
        "App PrivacyInfo contains a data type without an identifier."
      );
      continue;
    }
    if (actualTypes.has(dataType)) {
      errors.push(`App PrivacyInfo data type is duplicated: ${dataType}.`);
      continue;
    }
    actualTypes.set(dataType, entry);
  }

  for (const [dataType, expected] of Object.entries(
    APP_PRIVACY_DATA_CONTRACT
  )) {
    const actual = actualTypes.get(dataType);
    if (actual === undefined) {
      errors.push(`App PrivacyInfo is missing ${dataType}.`);
      continue;
    }
    errors.push(
      ...validatePrivacyDataType({
        label: `App PrivacyInfo ${dataType}`,
        actual,
        expected,
        linkedKey: "NSPrivacyCollectedDataTypeLinked",
        trackingKey: "NSPrivacyCollectedDataTypeTracking",
        purposesKey: "NSPrivacyCollectedDataTypePurposes",
      })
    );
  }

  for (const dataType of actualTypes.keys()) {
    if (!(dataType in APP_PRIVACY_DATA_CONTRACT)) {
      errors.push(`App PrivacyInfo has unexpected data type ${dataType}.`);
    }
  }
  return errors;
}

export function validatePublishedContentInventory({
  manifest,
  publishedContent,
  expectedTotal = 14,
  expectedP1 = 7,
}) {
  const errors = [];
  const decks = Array.isArray(manifest?.decks) ? manifest.decks : [];
  const plannedIds = decks
    .map((deck) => deck?.id)
    .filter((id) => typeof id === "string");
  const p1Ids = decks
    .filter((deck) => deck?.priority === "P1")
    .map((deck) => deck?.id)
    .filter((id) => typeof id === "string");
  const publishedIds = Object.keys(publishedContent ?? {});

  if (plannedIds.length !== expectedTotal) {
    errors.push(
      `Content manifest must contain ${expectedTotal} v1 decks; found ${plannedIds.length}.`
    );
  }
  if (p1Ids.length !== expectedP1) {
    errors.push(
      `Content manifest must contain ${expectedP1} P1 decks; found ${p1Ids.length}.`
    );
  }
  const planned = new Set(plannedIds);
  const published = new Set(publishedIds);
  const missing = plannedIds.filter((id) => !published.has(id));
  const missingP1 = p1Ids.filter((id) => !published.has(id));
  const unexpected = publishedIds.filter((id) => !planned.has(id));

  for (const deck of decks) {
    const publicationErrors = validateSourcePublicationContract(deck);
    if (publicationErrors.length > 0) {
      errors.push(
        `Source deck ${String(
          deck?.id ?? "unknown"
        )} is not release-publishable: ${publicationErrors.join(", ")}.`
      );
    }
    const artifact = publishedContent?.[deck?.id];
    if (artifact !== undefined) {
      for (const error of validatePublishedDeckArtifact(deck, artifact)) {
        errors.push(`Published content ${String(deck?.id)}: ${error}`);
      }
    }
  }

  if (publishedIds.length !== expectedTotal || missing.length > 0) {
    errors.push(
      `Human-approved published deck bodies need ${expectedTotal}; found ${publishedIds.length} (missing ${missing.length}).`
    );
  }
  if (missingP1.length > 0) {
    errors.push(
      `Human-approved P1 deck bodies need ${expectedP1}; missing ${missingP1.length}.`
    );
  }
  if (unexpected.length > 0) {
    errors.push(
      `Published content contains ${unexpected.length} deck(s) outside the v1 manifest.`
    );
  }
  return errors;
}

function privacyDataType(linked, purposes) {
  return Object.freeze({
    linked,
    tracking: false,
    purposes: Object.freeze([...purposes]),
  });
}

function validatePrivacyDataType({
  label,
  actual,
  expected,
  linkedKey,
  trackingKey,
  purposesKey,
}) {
  const errors = [];
  if (actual?.[linkedKey] !== expected.linked) {
    errors.push(`${label} linked must be ${String(expected.linked)}.`);
  }
  if (actual?.[trackingKey] !== expected.tracking) {
    errors.push(`${label} tracking must be ${String(expected.tracking)}.`);
  }
  const purposes = actual?.[purposesKey];
  const actualPurposes = Array.isArray(purposes)
    ? [...new Set(purposes)].sort()
    : [];
  const expectedPurposes = [...expected.purposes].sort();
  if (
    !Array.isArray(purposes) ||
    purposes.length !== actualPurposes.length ||
    actualPurposes.length !== expectedPurposes.length ||
    actualPurposes.some((purpose, index) => purpose !== expectedPurposes[index])
  ) {
    errors.push(`${label} purposes must equal ${expectedPurposes.join(", ")}.`);
  }
  return errors;
}

function validateSourcePublicationContract(deck) {
  const errors = [];
  if (deck?.status !== "published") errors.push("requires status=published");
  if (deck?.reviewer?.status !== "approved") {
    errors.push("requires reviewer.status=approved");
  }
  if (!nonEmptyString(deck?.reviewer?.name)) {
    errors.push("requires reviewer.name");
  }
  if (!canonicalIsoDate(deck?.reviewer?.reviewedAt)) {
    errors.push("requires reviewer.reviewedAt UTC ISO");
  }
  if (!nonEmptyString(deck?.reviewer?.evidence)) {
    errors.push("requires reviewer.evidence");
  }
  if (!SHA256_PATTERN.test(deck?.provenance?.inputDigest ?? "")) {
    errors.push("requires provenance.inputDigest sha256");
  }
  if (!nonEmptyString(deck?.source?.revision)) {
    errors.push("requires source.revision");
  }
  if (
    deck?.source?.external === true &&
    !COMMIT_PATTERN.test(deck?.source?.commit ?? "")
  ) {
    errors.push("requires source.commit immutable 40-hex pin");
  }
  return errors;
}

function validatePublishedDeckArtifact(deck, artifact) {
  const errors = [];
  if (artifact?.deckId !== deck?.id)
    errors.push("deckId does not match source");
  if (artifact?.version !== deck?.version) {
    errors.push("version does not match source");
  }
  if (artifact?.chunkSize !== 200) errors.push("chunkSize must be 200");
  if (!Number.isInteger(artifact?.cardCount) || artifact.cardCount < 1) {
    errors.push("cardCount must be positive");
  }
  if (!canonicalIsoDate(artifact?.publishedAt)) {
    errors.push("publishedAt must be UTC ISO");
  }
  if (!SHA256_PATTERN.test(artifact?.publicationDigest ?? "")) {
    errors.push("publicationDigest must be sha256");
  }
  if (!Array.isArray(artifact?.chunks) || artifact.chunks.length < 1) {
    errors.push("chunks must not be empty");
    return errors;
  }

  let cardCount = 0;
  artifact.chunks.forEach((chunk, index) => {
    if (chunk?.chunkIndex !== index) {
      errors.push(`chunk ${index} index is not contiguous`);
    }
    if (!SHA256_PATTERN.test(chunk?.checksum ?? "")) {
      errors.push(`chunk ${index} checksum must be sha256`);
    }
    if (
      !Array.isArray(chunk?.cards) ||
      chunk.cards.length < 1 ||
      chunk.cards.length > 200
    ) {
      errors.push(`chunk ${index} must contain 1-200 cards`);
    } else {
      cardCount += chunk.cards.length;
    }
  });
  if (cardCount !== artifact.cardCount) {
    errors.push("chunk card total does not match cardCount");
  }
  return errors;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function canonicalIsoDate(value) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value)))
    return false;
  return new Date(value).toISOString() === value;
}

function validProductId(value) {
  return (
    typeof value === "string" &&
    value.length >= 3 &&
    value.length <= 255 &&
    /^[A-Za-z0-9][A-Za-z0-9._-]+$/.test(value) &&
    !UNRESOLVED_PATTERN.test(value)
  );
}

function validPlayScreenshot(item, minSide, maxSide) {
  const width = item?.width;
  const height = item?.height;
  return (
    Number.isSafeInteger(width) &&
    Number.isSafeInteger(height) &&
    Math.min(width, height) >= minSide &&
    Math.max(width, height) <= maxSide &&
    (width * 16 === height * 9 || width * 9 === height * 16)
  );
}

function oneOfSizes(item, allowed) {
  return allowed.some(
    ([width, height]) => item?.width === width && item?.height === height
  );
}
