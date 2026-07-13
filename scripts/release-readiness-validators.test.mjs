import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  APP_PRIVACY_DATA_CONTRACT,
  isFinalizedPublicHttpsUrl,
  validateAppStoreMetadata,
  validatePublishedContentInventory,
  validatePrivacyInfoManifest,
  validateStoreScreenshotInventory,
  validateSubscriptionSkuParity,
} from "./release-readiness-validators.mjs";

test("public HTTPS validator rejects private, reserved and placeholder hosts", () => {
  assert.equal(
    isFinalizedPublicHttpsUrl("https://support.seorilabs.com/daoewo"),
    true
  );
  assert.equal(isFinalizedPublicHttpsUrl("", { optional: true }), true);
  assert.equal(isFinalizedPublicHttpsUrl(""), false);
  for (const value of [
    "http://support.seorilabs.com",
    "https://10.0.0.1/privacy",
    "https://[2001:db8::1]/privacy",
    "https://user:password@support.seorilabs.com/privacy",
    "https://intranet/privacy",
    "https://foo.example.com/privacy",
    "https://foo.example.net/privacy",
    "https://localhost/privacy",
    "https://support.local/privacy",
    "https://support.internal/privacy",
    "https://support.test/privacy",
    "https://placeholder.seorilabs.com/privacy",
    "확정 필요",
  ]) {
    assert.equal(isFinalizedPublicHttpsUrl(value), false, value);
  }
});

test("App Store metadata enforces UTF-8 keyword bytes and required privacy inventory", () => {
  const valid = appStoreMetadataFixture();
  assert.deepEqual(validateAppStoreMetadata(valid), []);

  const overLimit = {
    ...valid,
    keywords: { "ko-KR": "가".repeat(34) },
  };
  assert.match(
    validateAppStoreMetadata(overLimit).join("\n"),
    /exceed 100 UTF-8 bytes \(102\)/
  );

  const missingPrivacy = {
    ...valid,
    privacy: { collected: [] },
  };
  assert.match(
    validateAppStoreMetadata(missingPrivacy).join("\n"),
    /privacy inventory is missing/
  );

  const wrongPrivacyContract = structuredClone(valid);
  wrongPrivacyContract.privacy.dataTypes.NSPrivacyCollectedDataTypeOtherDataTypes.linked = false;
  assert.match(
    validateAppStoreMetadata(wrongPrivacyContract).join("\n"),
    /App Store privacy NSPrivacyCollectedDataTypeOtherDataTypes linked must be true/
  );

  for (const [field, value, expected] of [
    ["subtitle", "가".repeat(31), /subtitle exceeds 30/],
    ["promotionalText", "가".repeat(171), /promotional text exceeds 170/],
    ["description", "가".repeat(4_001), /description exceeds 4000/],
  ]) {
    assert.match(
      validateAppStoreMetadata({
        ...valid,
        [field]: { "ko-KR": value },
      }).join("\n"),
      expected
    );
  }

  assert.match(
    validateAppStoreMetadata({
      ...valid,
      contentRights: "review-required-before-submission",
    }).join("\n"),
    /content rights review is not complete/
  );

  const repoConfig = JSON.parse(
    fs.readFileSync("app-store/app-store.config.json", "utf8")
  );
  assert.ok(
    Buffer.byteLength(repoConfig.keywords["ko-KR"], "utf8") <= 100,
    "repo Korean keywords must stay within Apple 100-byte limit"
  );
  assert.equal(repoConfig.marketingUrl, "");
  assert.equal(
    isFinalizedPublicHttpsUrl(repoConfig.marketingUrl, { optional: true }),
    true
  );
});

test("PrivacyInfo enforces every data type purpose, linked and tracking contract", () => {
  const valid = privacyInfoFixture();
  assert.deepEqual(validatePrivacyInfoManifest(valid), []);

  const missing = structuredClone(valid);
  missing.NSPrivacyCollectedDataTypes =
    missing.NSPrivacyCollectedDataTypes.filter(
      (entry) =>
        entry.NSPrivacyCollectedDataType !==
        "NSPrivacyCollectedDataTypePurchaseHistory"
    );
  assert.match(
    validatePrivacyInfoManifest(missing).join("\n"),
    /is missing NSPrivacyCollectedDataTypePurchaseHistory/
  );

  const wrongPurpose = structuredClone(valid);
  findPrivacyType(
    wrongPurpose,
    "NSPrivacyCollectedDataTypeCrashData"
  ).NSPrivacyCollectedDataTypePurposes = [
    "NSPrivacyCollectedDataTypePurposeAppFunctionality",
  ];
  assert.match(
    validatePrivacyInfoManifest(wrongPurpose).join("\n"),
    /CrashData purposes must equal.*PurposeAnalytics/
  );

  const wrongLinked = structuredClone(valid);
  findPrivacyType(
    wrongLinked,
    "NSPrivacyCollectedDataTypeOtherDataTypes"
  ).NSPrivacyCollectedDataTypeLinked = false;
  assert.match(
    validatePrivacyInfoManifest(wrongLinked).join("\n"),
    /OtherDataTypes linked must be true/
  );

  const wrongTracking = structuredClone(valid);
  findPrivacyType(
    wrongTracking,
    "NSPrivacyCollectedDataTypeDeviceID"
  ).NSPrivacyCollectedDataTypeTracking = true;
  assert.match(
    validatePrivacyInfoManifest(wrongTracking).join("\n"),
    /DeviceID tracking must be false/
  );

  const rootTracking = structuredClone(valid);
  rootTracking.NSPrivacyTracking = true;
  assert.match(
    validatePrivacyInfoManifest(rootTracking).join("\n"),
    /NSPrivacyTracking must be false/
  );
});

test("screenshot inventory accepts unique screenshot-kind assets at market sizes", () => {
  const fixture = screenshotFixture();
  assert.deepEqual(validateStoreScreenshotInventory(fixture), []);
});

test("screenshot inventory rejects insufficient, duplicate, wrong-kind and wrong-size assets", () => {
  const insufficient = screenshotFixture();
  insufficient.play.assets.phoneScreenshots.pop();
  assert.match(
    validateStoreScreenshotInventory(insufficient).join("\n"),
    /needs at least 2/
  );

  const duplicate = screenshotFixture();
  duplicate.play.assets.tenInchTabletScreenshots[0] =
    duplicate.play.assets.phoneScreenshots[0];
  assert.match(
    validateStoreScreenshotInventory(duplicate).join("\n"),
    /path is duplicated/
  );

  const duplicateManifest = screenshotFixture();
  duplicateManifest.registrationManifest.items.push({
    ...duplicateManifest.registrationManifest.items[0],
  });
  assert.match(
    validateStoreScreenshotInventory(duplicateManifest).join("\n"),
    /Registration manifest path is duplicated/
  );

  const wrongKind = screenshotFixture();
  const path = wrongKind.appStore.assets.iphone69Screenshots[0];
  wrongKind.registrationManifest.items.find((item) => item.path === path).kind =
    "icon";
  assert.match(
    validateStoreScreenshotInventory(wrongKind).join("\n"),
    /kind=screenshot/
  );

  const wrongPrefix = screenshotFixture();
  const wrongPrefixPath = wrongPrefix.appStore.assets.iphone69Screenshots[0];
  wrongPrefix.appStore.assets.iphone69Screenshots[0] =
    "play-store/screenshots/iphone/1.png";
  wrongPrefix.registrationManifest.items.find(
    (item) => item.path === wrongPrefixPath
  ).path = "play-store/screenshots/iphone/1.png";
  assert.match(
    validateStoreScreenshotInventory(wrongPrefix).join("\n"),
    /must stay under app-store\//
  );

  const missingManifest = screenshotFixture();
  missingManifest.registrationManifest.items =
    missingManifest.registrationManifest.items.filter(
      (item) => item.path !== missingManifest.toss.assets.screenshots636x1048[0]
    );
  assert.match(
    validateStoreScreenshotInventory(missingManifest).join("\n"),
    /is not declared in the registration manifest/
  );

  const transparent = screenshotFixture();
  const transparentPath = transparent.play.assets.phoneScreenshots[0];
  transparent.registrationManifest.items.find(
    (item) => item.path === transparentPath
  ).transparent = true;
  assert.match(
    validateStoreScreenshotInventory(transparent).join("\n"),
    /must not contain alpha/
  );

  const tooMany = screenshotFixture();
  for (let index = 3; index <= 9; index += 1) {
    const path = `play-store/screenshots/phone/${index}.png`;
    tooMany.play.assets.phoneScreenshots.push(path);
    tooMany.registrationManifest.items.push({
      path,
      width: 1_080,
      height: 1_920,
      kind: "screenshot",
      transparent: false,
    });
  }
  assert.match(
    validateStoreScreenshotInventory(tooMany).join("\n"),
    /allows at most 8/
  );

  const wrongSize = screenshotFixture();
  const aitPath = wrongSize.toss.assets.screenshots636x1048[0];
  const aitItem = wrongSize.registrationManifest.items.find(
    (item) => item.path === aitPath
  );
  aitItem.width = 600;
  aitItem.height = 1_000;
  assert.match(
    validateStoreScreenshotInventory(wrongSize).join("\n"),
    /manifest dimensions are invalid/
  );
});

test("subscription SKU validator detects config, runtime and allowlist drift", () => {
  const valid = {
    playSubscription: { monthly: "daoewo.monthly", annual: "daoewo.annual" },
    appStoreSubscription: {
      monthly: "daoewo.monthly",
      annual: "daoewo.annual",
    },
    mobileSubscription: { monthly: "daoewo.monthly", annual: "daoewo.annual" },
    googleAllowlist: "daoewo.monthly,daoewo.annual",
    appleAllowlist: "daoewo.monthly,daoewo.annual",
  };
  assert.deepEqual(validateSubscriptionSkuParity(valid), []);

  assert.match(
    validateSubscriptionSkuParity({
      ...valid,
      appStoreSubscription: {
        monthly: "daoewo.ios.monthly",
        annual: "daoewo.annual",
      },
    }).join("\n"),
    /App Store monthly product ID does not match/
  );
  assert.match(
    validateSubscriptionSkuParity({
      ...valid,
      googleAllowlist: "other.sku",
    }).join("\n"),
    /GOOGLE_PLAY_PRODUCT_IDS does not contain/
  );
  assert.match(
    validateSubscriptionSkuParity({
      ...valid,
      appleAllowlist: "other.sku",
    }).join("\n"),
    /APP_STORE_PRODUCT_IDS does not contain/
  );
  assert.match(
    validateSubscriptionSkuParity({
      ...valid,
      playSubscription: {
        monthly: "daoewo.monthly",
        annual: "daoewo.monthly",
      },
    }).join("\n"),
    /monthly and annual product IDs must differ/
  );
  assert.match(
    validateSubscriptionSkuParity({
      ...valid,
      mobileSubscription: { monthly: "확정 필요", annual: "" },
    }).join("\n"),
    /mobile runtime monthly product ID is not finalized/
  );
});

test("content inventory requires all v1 14 decks and all P1 7 decks", () => {
  const decks = Array.from({ length: 14 }, (_, index) =>
    approvedSourceDeckFixture(index)
  );
  const publishedContent = Object.fromEntries(
    decks.map((deck) => [deck.id, publishedDeckArtifactFixture(deck)])
  );
  assert.deepEqual(
    validatePublishedContentInventory({
      manifest: { decks },
      publishedContent,
    }),
    []
  );

  const onlyOne = { [decks[0].id]: publishedContent[decks[0].id] };
  const missing = validatePublishedContentInventory({
    manifest: { decks },
    publishedContent: onlyOne,
  }).join("\n");
  assert.match(missing, /need 14; found 1/);
  assert.match(missing, /P1 deck bodies need 7; missing 6/);

  assert.match(
    validatePublishedContentInventory({
      manifest: { decks: decks.slice(0, 13) },
      publishedContent,
    }).join("\n"),
    /manifest must contain 14/
  );

  assert.match(
    validatePublishedContentInventory({
      manifest: {
        decks: decks.map((deck, index) => ({
          ...deck,
          priority: index < 6 ? "P1" : "P2",
        })),
      },
      publishedContent,
    }).join("\n"),
    /manifest must contain 7 P1 decks/
  );

  assert.match(
    validatePublishedContentInventory({
      manifest: { decks },
      publishedContent: {
        ...publishedContent,
        "outside-v1": { deckId: "outside-v1" },
      },
    }).join("\n"),
    /outside the v1 manifest/
  );

  const unapprovedDecks = structuredClone(decks);
  unapprovedDecks[0].status = "planned";
  unapprovedDecks[0].reviewer = {
    status: "pending",
    name: null,
    reviewedAt: null,
    evidence: null,
  };
  unapprovedDecks[0].provenance.inputDigest = null;
  assert.match(
    validatePublishedContentInventory({
      manifest: { decks: unapprovedDecks },
      publishedContent,
    }).join("\n"),
    /not release-publishable:.*requires status=published.*requires reviewer.status=approved.*requires reviewer.reviewedAt UTC ISO.*requires reviewer.evidence.*requires provenance.inputDigest sha256/
  );

  const mutableSource = structuredClone(decks);
  mutableSource[0].source.commit = "master";
  assert.match(
    validatePublishedContentInventory({
      manifest: { decks: mutableSource },
      publishedContent,
    }).join("\n"),
    /requires source.commit immutable 40-hex pin/
  );

  const badChecksumContent = structuredClone(publishedContent);
  badChecksumContent[decks[0].id].chunks[0].checksum = "sha256:invalid";
  assert.match(
    validatePublishedContentInventory({
      manifest: { decks },
      publishedContent: badChecksumContent,
    }).join("\n"),
    /chunk 0 checksum must be sha256/
  );
});

test("Release Inventory passes configured markers instead of raw App Store secrets", () => {
  const workflow = fs.readFileSync(
    ".github/workflows/release-inventory.yml",
    "utf8"
  );
  const checker = fs.readFileSync("scripts/check_release_readiness.sh", "utf8");
  assert.doesNotMatch(workflow, /^\s*APP_STORE_IAP_PRIVATE_KEY_BASE64:\s/m);
  assert.doesNotMatch(
    workflow,
    /^\s*APP_STORE_ROOT_CA_CERTIFICATES_BASE64_JSON:\s/m
  );
  assert.match(workflow, /APP_STORE_IAP_PRIVATE_KEY_CONFIGURED:/);
  assert.match(workflow, /APP_STORE_ROOT_CA_CERTIFICATES_CONFIGURED:/);
  assert.match(checker, /APP_STORE_IAP_PRIVATE_KEY_CONFIGURED/);
  assert.match(checker, /APP_STORE_ROOT_CA_CERTIFICATES_CONFIGURED/);
  assert.match(checker, /generate-catalog\.mjs --check/);
  assert.match(checker, /plistlib\.load/);
  assert.doesNotMatch(checker, /privacyManifest\.includes/);
});

function appStoreMetadataFixture() {
  return {
    subtitle: { "ko-KR": "무엇이든 외우기" },
    promotionalText: { "ko-KR": "오늘 분량을 외워요." },
    description: { "ko-KR": "간결한 설명" },
    keywords: { "ko-KR": "암기,플래시카드" },
    contentRights: "licensed-and-reviewed-curated-content",
    privacy: {
      tracking: false,
      collected: [
        "name-email-and-user-id-for-federated-account",
        "coarse-location-from-sign-in-ip-for-fraud-prevention",
        "native-crash-state-and-other-diagnostics",
        "fcm-installation-token-and-device-metadata",
      ],
      dataTypes: appStorePrivacyDataTypesFixture(),
    },
  };
}

function appStorePrivacyDataTypesFixture() {
  return Object.fromEntries(
    Object.entries(APP_PRIVACY_DATA_CONTRACT).map(([dataType, contract]) => [
      dataType,
      {
        linked: contract.linked,
        tracking: contract.tracking,
        purposes: [...contract.purposes],
      },
    ])
  );
}

function privacyInfoFixture() {
  return {
    NSPrivacyTracking: false,
    NSPrivacyCollectedDataTypes: Object.entries(APP_PRIVACY_DATA_CONTRACT).map(
      ([dataType, contract]) => ({
        NSPrivacyCollectedDataType: dataType,
        NSPrivacyCollectedDataTypeLinked: contract.linked,
        NSPrivacyCollectedDataTypeTracking: contract.tracking,
        NSPrivacyCollectedDataTypePurposes: [...contract.purposes],
      })
    ),
  };
}

function findPrivacyType(manifest, dataType) {
  return manifest.NSPrivacyCollectedDataTypes.find(
    (entry) => entry.NSPrivacyCollectedDataType === dataType
  );
}

function approvedSourceDeckFixture(index) {
  return {
    id: `deck-${index + 1}`,
    priority: index < 7 ? "P1" : "P2",
    status: "published",
    version: 1,
    reviewer: {
      status: "approved",
      name: "콘텐츠 검수자",
      reviewedAt: "2026-07-13T00:00:00.000Z",
      evidence: `review-ticket://DAOEWO-${index + 1}`,
    },
    provenance: {
      inputDigest: `sha256:${index.toString(16).padStart(64, "0")}`,
    },
    source: {
      external: true,
      revision: `immutable-revision-${index + 1}`,
      commit: index.toString(16).padStart(40, "0"),
    },
  };
}

function publishedDeckArtifactFixture(deck) {
  return {
    deckId: deck.id,
    version: deck.version,
    chunkSize: 200,
    cardCount: 1,
    publishedAt: "2026-07-13T00:10:00.000Z",
    publicationDigest: `sha256:${"a".repeat(64)}`,
    chunks: [
      {
        chunkIndex: 0,
        checksum: `sha256:${"b".repeat(64)}`,
        cards: [{ id: `${deck.id}-card-1` }],
      },
    ],
  };
}

function screenshotFixture() {
  const items = [];
  const add = (path, width, height) => {
    items.push({ path, width, height, kind: "screenshot", transparent: false });
    return path;
  };
  return {
    registrationManifest: { items },
    play: {
      assets: {
        phoneScreenshots: [
          add("play-store/screenshots/phone/1.png", 1_080, 1_920),
          add("play-store/screenshots/phone/2.png", 1_080, 1_920),
        ],
        sevenInchTabletScreenshots: [
          add("play-store/screenshots/tablet-7/1.png", 1_080, 1_920),
          add("play-store/screenshots/tablet-7/2.png", 1_080, 1_920),
        ],
        tenInchTabletScreenshots: [
          add("play-store/screenshots/tablet-10/1.png", 1_080, 1_920),
          add("play-store/screenshots/tablet-10/2.png", 1_080, 1_920),
        ],
      },
    },
    appStore: {
      assets: {
        iphone69Screenshots: [
          add("app-store/screenshots/iphone-69/1.png", 1_290, 2_796),
        ],
        ipad13Screenshots: [
          add("app-store/screenshots/ipad-13/1.png", 2_048, 2_732),
        ],
      },
    },
    toss: {
      assets: {
        screenshots636x1048: [
          add("apps-in-toss/screenshots/1.png", 636, 1_048),
          add("apps-in-toss/screenshots/2.png", 636, 1_048),
          add("apps-in-toss/screenshots/3.png", 636, 1_048),
        ],
      },
    },
  };
}
