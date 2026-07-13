import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Switch, View } from "react-native";

import {
  AppText,
  Badge,
  BottomNavigation,
  PrimaryButton,
  Screen,
  TextButton,
  TopBar,
} from "../components";
import type { DaoewoScreen, SubscriptionPlan } from "../navigation";
import type { DaoewoSettingsState } from "../product-state";
import type {
  DaoewoAuthOption,
  DaoewoAuthProvider,
  DaoewoDeckReadyNotificationAvailability,
  DaoewoEntitlementState,
  DaoewoExternalLinks,
  DaoewoPurchaseOffer,
  DaoewoTts,
  DaoewoUser,
} from "../runtime";
import { useDaoewoTheme } from "../theme";
import { LogoMark } from "./home";

interface PaywallScreenProps {
  readonly isPro: boolean;
  readonly isGuest: boolean;
  readonly authOptions: readonly DaoewoAuthOption[];
  readonly busyProvider: DaoewoAuthProvider | "guest" | null;
  readonly authError: string | null;
  readonly onBack: () => void;
  readonly getOffers?: () => Promise<readonly DaoewoPurchaseOffer[]>;
  readonly externalLinks?: DaoewoExternalLinks;
  readonly onPurchase: (
    plan: SubscriptionPlan,
    trial: boolean
  ) => Promise<void>;
  readonly onRestore: () => Promise<void>;
  readonly onSignIn: (provider: DaoewoAuthProvider) => Promise<void>;
}

const benefits = [
  "전 분야 큐레이션 덱 전체",
  "활성 덱 · 일일 카드 무제한",
  "약점 분석 · 예상 완료일",
  "다기기 동기화 · 백업",
  "신규 덱 우선 접근 · 요청 우선",
] as const;

export function PaywallScreen({
  isPro,
  isGuest,
  authOptions,
  busyProvider,
  authError,
  onBack,
  getOffers,
  externalLinks,
  onPurchase,
  onRestore,
  onSignIn,
}: PaywallScreenProps) {
  const { colors } = useDaoewoTheme();
  const [plan, setPlan] = useState<SubscriptionPlan | null>(null);
  const [offers, setOffers] = useState<readonly DaoewoPurchaseOffer[]>([]);
  const [offersStatus, setOffersStatus] = useState<
    "loading" | "ready" | "unavailable" | "error"
  >("loading");
  const [busy, setBusy] = useState<"purchase" | "restore" | null>(null);
  const [message, setMessage] = useState<{
    readonly text: string;
    readonly error: boolean;
  } | null>(null);

  useEffect(() => {
    let active = true;
    if (getOffers === undefined) {
      setOffersStatus("unavailable");
      return () => {
        active = false;
      };
    }
    getOffers()
      .then((items) => {
        if (!active) {
          return;
        }
        const valid = items.filter(isUsableOffer);
        setOffers(valid);
        if (valid.length === 0) {
          setPlan(null);
          setOffersStatus("unavailable");
          return;
        }
        setPlan(
          valid.find((offer) => offer.plan === "annual")?.plan ??
            valid[0]?.plan ??
            null
        );
        setOffersStatus("ready");
      })
      .catch(() => {
        if (active) {
          setPlan(null);
          setOffers([]);
          setOffersStatus("error");
        }
      });
    return () => {
      active = false;
    };
  }, [getOffers]);

  const purchase = async () => {
    const offer = offers.find((item) => item.plan === plan);
    if (offer === undefined) {
      setMessage({
        text: "스토어 상품 정보를 확인할 수 없어 현재 구매할 수 없어요.",
        error: true,
      });
      return;
    }
    setBusy("purchase");
    setMessage(null);
    try {
      await onPurchase(offer.plan, (offer.trialDays ?? 0) > 0);
      setMessage({
        text: "Pro가 활성화됐어요. 모든 큐레이션 덱을 이용할 수 있습니다.",
        error: false,
      });
    } catch {
      setMessage({
        text: "구독을 시작하지 못했어요. 현재 환경에서 사용할 수 없거나 설정이 준비되지 않았을 수 있어요.",
        error: true,
      });
    } finally {
      setBusy(null);
    }
  };

  const openExternalLink = async (url: string | undefined) => {
    if (externalLinks === undefined || !isPublishedUrl(url)) {
      setMessage({
        text: "해당 문서 링크가 아직 게시되지 않았어요.",
        error: true,
      });
      return;
    }
    setMessage(null);
    try {
      await externalLinks.open(url);
    } catch {
      setMessage({
        text: "문서를 열지 못했어요. 잠시 후 다시 시도해 주세요.",
        error: true,
      });
    }
  };

  const restore = async () => {
    setBusy("restore");
    setMessage(null);
    try {
      await onRestore();
      setMessage({ text: "구매 내역 확인을 마쳤어요.", error: false });
    } catch {
      setMessage({
        text: "구매 내역을 복원하지 못했어요. 현재 환경에서 사용할 수 없거나 설정이 준비되지 않았을 수 있어요.",
        error: true,
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen accessibilityLabel="다외워 Pro 구독 안내 화면">
      <TopBar title="" onBack={onBack} backLabel="구독 안내 닫기" />
      <View style={styles.paywallHero}>
        <LogoMark />
        <Badge label="DAOEWO PRO" tone="accent" />
        <AppText accessibilityRole="header" style={styles.paywallTitle}>
          Pro로 더 외우기
        </AppText>
        <AppText style={[styles.paywallSubtitle, { color: colors.textMuted }]}>
          계속 늘어나는 큐레이션 덱과 깊이 있는 학습 인사이트를 만나세요.
        </AppText>
      </View>

      <View
        style={[
          styles.benefitList,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        {benefits.map((benefit) => (
          <View key={benefit} style={styles.benefitRow}>
            <View
              style={[
                styles.benefitCheck,
                { backgroundColor: colors.successSoft },
              ]}
            >
              <AppText
                style={[styles.benefitCheckText, { color: colors.success }]}
              >
                ✓
              </AppText>
            </View>
            <AppText style={styles.benefitText}>{benefit}</AppText>
          </View>
        ))}
      </View>

      {isGuest ? (
        <AccountLinkActions
          authOptions={authOptions}
          busyProvider={busyProvider}
          error={authError}
          onSignIn={onSignIn}
          description="구독과 구매 복원을 사용하려면 먼저 계정을 연결해 주세요. 현재 게스트 학습 기록은 연결된 계정으로 옮겨집니다."
        />
      ) : null}

      {offersStatus === "ready" ? (
        <View accessibilityRole="radiogroup" style={styles.planList}>
          {offers.map((offer) => (
            <PlanOption
              key={offer.plan}
              description={
                offer.description ?? "세부 조건은 스토어 결제 화면에서 확인"
              }
              label={offer.plan === "annual" ? "연간" : "월간"}
              price={`${offer.displayPrice} / ${offer.periodLabel}`}
              selected={plan === offer.plan}
              trialDays={offer.trialDays}
              onPress={() => setPlan(offer.plan)}
            />
          ))}
        </View>
      ) : (
        <View
          accessibilityLiveRegion="polite"
          style={[
            styles.offerUnavailable,
            { backgroundColor: colors.warningSoft },
          ]}
        >
          <AppText
            style={[styles.offerUnavailableText, { color: colors.warning }]}
          >
            {offersStatus === "loading"
              ? "스토어 상품 확인 중…"
              : offersStatus === "error"
              ? "스토어 상품을 불러오지 못했어요."
              : "스토어 상품 확인이 필요해요."}
          </AppText>
        </View>
      )}

      {isPro ? (
        <View
          accessibilityLiveRegion="polite"
          style={[styles.activePlan, { backgroundColor: colors.successSoft }]}
        >
          <AppText style={[styles.activePlanText, { color: colors.success }]}>
            현재 Pro 구독이 활성화되어 있어요.
          </AppText>
        </View>
      ) : (
        <PrimaryButton
          label={
            isGuest
              ? "계정 연결 후 구독 가능"
              : purchaseButtonLabel(offers, plan)
          }
          onPress={purchase}
          loading={busy === "purchase"}
          disabled={busy !== null || plan === null || isGuest}
          accessibilityHint="선택한 스토어 구독 상품의 결제 화면을 엽니다"
        />
      )}

      {message ? (
        <AppText
          accessibilityLiveRegion={message.error ? "assertive" : "polite"}
          style={[
            styles.purchaseMessage,
            { color: message.error ? colors.danger : colors.textMuted },
          ]}
        >
          {message.text}
        </AppText>
      ) : null}
      <View style={styles.paywallLinks}>
        <TextButton
          label={
            isGuest
              ? "계정 연결 후 구매 복원"
              : busy === "restore"
              ? "복원 중…"
              : "구매 복원"
          }
          onPress={restore}
          disabled={busy !== null || isGuest}
          tone="muted"
        />
        <AppText style={[styles.linkDivider, { color: colors.textMuted }]}>
          ·
        </AppText>
        <TextButton
          label="이용약관"
          onPress={() => void openExternalLink(externalLinks?.termsUrl)}
          disabled={!isPublishedUrl(externalLinks?.termsUrl)}
          tone="muted"
        />
        <AppText style={[styles.linkDivider, { color: colors.textMuted }]}>
          ·
        </AppText>
        <TextButton
          label="개인정보"
          onPress={() => void openExternalLink(externalLinks?.privacyUrl)}
          disabled={!isPublishedUrl(externalLinks?.privacyUrl)}
          tone="muted"
        />
      </View>
      {!isPublishedUrl(externalLinks?.termsUrl) ||
      !isPublishedUrl(externalLinks?.privacyUrl) ? (
        <AppText style={[styles.unpublishedLinks, { color: colors.textMuted }]}>
          게시된 이용약관·개인정보처리방침 링크를 확인할 수 없어 링크를
          비활성화했습니다.
        </AppText>
      ) : null}
      <AppText style={[styles.billingNotice, { color: colors.textMuted }]}>
        실제 가격, 체험, 갱신 조건은 각 스토어 결제 화면에서 최종 확인하세요.
      </AppText>
    </Screen>
  );
}

interface PlanOptionProps {
  readonly label: string;
  readonly price: string;
  readonly description: string;
  readonly trialDays?: number;
  readonly selected: boolean;
  readonly onPress: () => void;
}

function PlanOption({
  label,
  price,
  description,
  trialDays,
  selected,
  onPress,
}: PlanOptionProps) {
  const { colors } = useDaoewoTheme();

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`${label} 구독, ${price}, ${description}`}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.planOption,
        {
          backgroundColor: selected ? colors.accentSoft : colors.surface,
          borderColor: selected ? colors.accent : colors.border,
        },
        pressed ? styles.pressed : undefined,
      ]}
    >
      <View
        style={[
          styles.planRadio,
          { borderColor: selected ? colors.accent : colors.textMuted },
        ]}
      >
        {selected ? (
          <View
            style={[styles.planRadioInner, { backgroundColor: colors.accent }]}
          />
        ) : null}
      </View>
      <View style={styles.planCopy}>
        <View style={styles.planLabelRow}>
          <AppText style={styles.planLabel}>{label}</AppText>
          {trialDays !== undefined && trialDays > 0 ? (
            <Badge label={`${trialDays}일 체험`} tone="accent" />
          ) : null}
        </View>
        <AppText style={[styles.planDescription, { color: colors.textMuted }]}>
          {description}
        </AppText>
      </View>
      <AppText style={styles.planPrice}>{price}</AppText>
    </Pressable>
  );
}

function isUsableOffer(offer: DaoewoPurchaseOffer): boolean {
  return (
    (offer.plan === "annual" || offer.plan === "monthly") &&
    offer.displayPrice.trim().length > 0 &&
    offer.periodLabel.trim().length > 0 &&
    (offer.trialDays === undefined ||
      (Number.isInteger(offer.trialDays) && offer.trialDays >= 0))
  );
}

function purchaseButtonLabel(
  offers: readonly DaoewoPurchaseOffer[],
  plan: SubscriptionPlan | null
): string {
  const offer = offers.find((item) => item.plan === plan);
  if (offer === undefined) {
    return "스토어 상품 확인 필요";
  }
  return offer.trialDays !== undefined && offer.trialDays > 0
    ? `${offer.trialDays}일 무료로 시작하기`
    : "구독 시작하기";
}

function isPublishedUrl(url: string | undefined): url is string {
  return url !== undefined && /^https:\/\/[^/\s]+(?:\/|$)/i.test(url);
}

interface AccountLinkActionsProps {
  readonly authOptions: readonly DaoewoAuthOption[];
  readonly busyProvider: DaoewoAuthProvider | "guest" | null;
  readonly error: string | null;
  readonly description: string;
  readonly onSignIn: (provider: DaoewoAuthProvider) => Promise<void>;
}

function AccountLinkActions({
  authOptions,
  busyProvider,
  error,
  description,
  onSignIn,
}: AccountLinkActionsProps) {
  const { colors } = useDaoewoTheme();
  const busy = busyProvider !== null;

  return (
    <View
      accessibilityLabel="게스트 계정 연결 안내"
      style={[
        styles.accountLinkPanel,
        { backgroundColor: colors.accentSoft, borderColor: colors.accent },
      ]}
    >
      <AppText style={styles.accountLinkTitle}>계정을 연결해 주세요</AppText>
      <AppText
        style={[styles.accountLinkDescription, { color: colors.textMuted }]}
      >
        {description}
      </AppText>
      <View style={styles.accountLinkButtons}>
        {authOptions.map((option) => (
          <PrimaryButton
            key={option.provider}
            label={
              busyProvider === option.provider
                ? `${accountLinkLabel(option.provider)} 중…`
                : accountLinkLabel(option.provider)
            }
            onPress={() => onSignIn(option.provider)}
            disabled={busy}
            loading={busyProvider === option.provider}
            accessibilityHint={`${option.label} 계정에 현재 게스트 학습 기록을 연결합니다`}
          />
        ))}
      </View>
      {error ? (
        <AppText
          accessibilityLiveRegion="assertive"
          style={[styles.accountLinkError, { color: colors.danger }]}
        >
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

function accountLinkLabel(provider: DaoewoAuthProvider): string {
  switch (provider) {
    case "google":
      return "Google 계정 연결";
    case "apple":
      return "Apple 계정 연결";
    case "toss":
      return "토스 계정 연결";
  }
}

interface SettingsScreenProps {
  readonly user: DaoewoUser;
  readonly authOptions: readonly DaoewoAuthOption[];
  readonly busyProvider: DaoewoAuthProvider | "guest" | null;
  readonly authError: string | null;
  readonly entitlement: DaoewoEntitlementState;
  readonly isPro: boolean;
  readonly navigate: (screen: DaoewoScreen) => void;
  readonly onSignOut: () => Promise<void>;
  readonly onDeleteAccount: () => Promise<void>;
  readonly onSignIn: (provider: DaoewoAuthProvider) => Promise<void>;
  readonly settings: DaoewoSettingsState;
  readonly notificationAvailability: "available" | "unsupported";
  readonly deckReadyNotificationAvailability: DaoewoDeckReadyNotificationAvailability;
  readonly sharingAvailability: "available" | "unsupported";
  readonly ttsAvailability: DaoewoTts["availability"];
  readonly onUpdateSetting: (
    key: keyof DaoewoSettingsState,
    value: boolean
  ) => Promise<void>;
  readonly onExportData: () => Promise<void>;
  readonly syncAvailability: "cloud" | "local-only";
}

export function SettingsScreen({
  user,
  authOptions,
  busyProvider,
  authError,
  entitlement,
  isPro,
  navigate,
  onSignOut,
  onDeleteAccount,
  onSignIn,
  settings,
  notificationAvailability,
  deckReadyNotificationAvailability,
  sharingAvailability,
  ttsAvailability,
  onUpdateSetting,
  onExportData,
  syncAvailability,
}: SettingsScreenProps) {
  const { colors } = useDaoewoTheme();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<"signout" | "delete" | "export" | null>(
    null
  );
  const [settingBusy, setSettingBusy] = useState<
    keyof DaoewoSettingsState | null
  >(null);
  const [message, setMessage] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);

  const updateSetting = async (
    key: keyof DaoewoSettingsState,
    value: boolean
  ) => {
    if (settingBusy !== null) {
      return;
    }
    setSettingBusy(key);
    setAccountError(null);
    setMessage(null);
    try {
      await onUpdateSetting(key, value);
      setMessage("설정을 이 계정의 기기 환경에 저장했어요.");
    } catch {
      setAccountError(
        key === "dailyReminder" || key === "reviewReminder"
          ? "알림 권한 또는 예약을 적용하지 못해 설정을 변경하지 않았어요."
          : key === "deckReadyNotification"
          ? "신규·요청 덱 알림을 연결하지 못해 설정을 변경하지 않았어요."
          : "설정을 저장하지 못했어요. 저장 공간을 확인한 뒤 다시 시도해 주세요."
      );
    } finally {
      setSettingBusy(null);
    }
  };

  const exportData = async () => {
    if (busy !== null || sharingAvailability !== "available") {
      return;
    }
    setBusy("export");
    setMessage(null);
    setAccountError(null);
    try {
      await onExportData();
      setMessage(
        "카드 본문과 계정 식별자를 제외한 학습 데이터 공유 창을 열었어요."
      );
    } catch {
      setAccountError(
        "학습 데이터를 내보내지 못했어요. 잠시 후 다시 시도해 주세요."
      );
    } finally {
      setBusy(null);
    }
  };

  const signOut = async () => {
    setBusy("signout");
    setAccountError(null);
    try {
      await onSignOut();
    } catch {
      setAccountError(
        "로그아웃을 완료하지 못했어요. 잠시 후 다시 시도해 주세요."
      );
    } finally {
      setBusy(null);
    }
  };

  const deleteAccount = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy("delete");
    setAccountError(null);
    try {
      await onDeleteAccount();
    } catch {
      setAccountError(
        "회원탈퇴를 완료하지 못했어요. 잠시 후 다시 시도해 주세요."
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen
      accessibilityLabel="다외워 설정 화면"
      footer={<BottomNavigation current="settings" navigate={navigate} />}
    >
      <View style={styles.settingsHeader}>
        <AppText accessibilityRole="header" style={styles.settingsTitle}>
          설정
        </AppText>
      </View>

      <AppText accessibilityRole="header" style={styles.settingSectionTitle}>
        계정
      </AppText>
      <View
        style={[
          styles.settingGroup,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <View style={styles.profileRow}>
          <View style={[styles.avatar, { backgroundColor: colors.accentSoft }]}>
            <AppText style={[styles.avatarText, { color: colors.accent }]}>
              {user.displayName.slice(0, 1)}
            </AppText>
          </View>
          <View style={styles.profileCopy}>
            <AppText style={styles.profileName}>{user.displayName}</AppText>
            <AppText style={[styles.profileEmail, { color: colors.textMuted }]}>
              {user.isGuest ? "게스트로 사용 중" : user.email ?? "로그인됨"}
            </AppText>
          </View>
          <Badge
            label={isPro ? "Pro" : "Free"}
            tone={isPro ? "accent" : "neutral"}
          />
        </View>
        <SettingActionRow
          label="구독 상태"
          value={
            isPro
              ? `활성 · ${
                  entitlement.billingPlan === "annual" ? "연간" : "월간"
                }`
              : "Free"
          }
          onPress={() => navigate("paywall")}
        />
      </View>
      {user.isGuest ? (
        <AccountLinkActions
          authOptions={authOptions}
          busyProvider={busyProvider}
          error={authError}
          onSignIn={onSignIn}
          description="계정을 연결하면 현재 게스트 학습 기록을 유지하면서 구독과 동기화를 사용할 수 있어요."
        />
      ) : null}

      <AppText accessibilityRole="header" style={styles.settingSectionTitle}>
        학습
      </AppText>
      <View
        style={[
          styles.settingGroup,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <SettingSwitchRow
          label="일일 학습 알림"
          value={
            notificationAvailability === "available"
              ? settings.dailyReminder
              : false
          }
          onValueChange={(value) => void updateSetting("dailyReminder", value)}
          description={
            notificationAvailability === "available"
              ? "매일 오전 9:00에 이 기기로 알림"
              : "이 앱 환경에서는 아직 알림을 지원하지 않아요"
          }
          disabled={
            notificationAvailability !== "available" || settingBusy !== null
          }
        />
        <SettingSwitchRow
          label="복습 알림"
          value={
            notificationAvailability === "available"
              ? settings.reviewReminder
              : false
          }
          onValueChange={(value) => void updateSetting("reviewReminder", value)}
          description={
            notificationAvailability === "available"
              ? "가장 이른 복습 카드가 준비되면 이 기기로 알림"
              : "이 앱 환경에서는 아직 알림을 지원하지 않아요"
          }
          disabled={
            notificationAvailability !== "available" || settingBusy !== null
          }
        />
        <SettingSwitchRow
          label="신규·요청 덱 알림"
          value={
            deckReadyNotificationAvailability === "unsupported"
              ? false
              : settings.deckReadyNotification
          }
          onValueChange={(value) =>
            void updateSetting("deckReadyNotification", value)
          }
          description={
            deckReadyNotificationAvailability === "available"
              ? "새 덱이 공개되거나 요청한 덱이 준비되면 이 기기로 알림"
              : deckReadyNotificationAvailability === "resolving"
              ? "신규·요청 덱 알림 사용 가능 여부를 확인하고 있어요"
              : deckReadyNotificationAvailability === "disabled-by-config"
              ? "현재 운영 설정에서 신규·요청 덱 알림을 제공하지 않아요"
              : "이 앱 환경에서는 신규·요청 덱 알림을 지원하지 않아요"
          }
          disabled={
            deckReadyNotificationAvailability !== "available" ||
            settingBusy !== null
          }
        />
        <SettingSwitchRow
          label="카드 음성(TTS)"
          value={ttsAvailability === "available" ? settings.ttsEnabled : false}
          onValueChange={(value) => void updateSetting("ttsEnabled", value)}
          description={
            ttsAvailability === "available"
              ? "학습 카드의 발음 듣기 버튼 사용"
              : "이 앱 환경에서는 카드 음성을 지원하지 않아요"
          }
          disabled={ttsAvailability !== "available" || settingBusy !== null}
        />
        <SettingSwitchRow
          label="접근성 음성 안내"
          value={settings.voiceGuide}
          onValueChange={(value) => void updateSetting("voiceGuide", value)}
          description="제스처와 학습 결과를 음성으로 안내"
          disabled={settingBusy !== null}
          last
        />
      </View>

      <AppText accessibilityRole="header" style={styles.settingSectionTitle}>
        화면
      </AppText>
      <View
        style={[
          styles.settingGroup,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <SettingInfoRow label="색상 모드" value="기기 설정 사용" />
        <SettingInfoRow label="글자 크기" value="기기 설정 사용" last />
      </View>

      <AppText accessibilityRole="header" style={styles.settingSectionTitle}>
        데이터
      </AppText>
      <View
        style={[
          styles.settingGroup,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <SettingActionRow
          label="클라우드 백업·동기화"
          value={syncAvailability === "cloud" ? "자동" : "이 기기에만"}
          onPress={() =>
            setMessage(
              syncAvailability === "cloud"
                ? "로그인 후 학습 기록은 네트워크 연결 시 자동으로 동기화돼요."
                : "현재 앱 환경에서는 학습 기록을 이 기기에만 저장해요."
            )
          }
        />
        <SettingActionRow
          label="학습 데이터 내보내기"
          value={
            sharingAvailability === "available"
              ? busy === "export"
                ? "준비 중…"
                : "JSON 공유"
              : "이 환경에서 미지원"
          }
          disabled={sharingAvailability !== "available" || busy !== null}
          onPress={() => void exportData()}
          last
        />
      </View>

      {message ? (
        <AppText
          accessibilityLiveRegion="polite"
          style={[styles.settingsMessage, { color: colors.textMuted }]}
        >
          {message}
        </AppText>
      ) : null}
      {accountError ? (
        <AppText
          accessibilityLiveRegion="assertive"
          style={[styles.settingsMessage, { color: colors.danger }]}
        >
          {accountError}
        </AppText>
      ) : null}

      <View style={styles.accountActions}>
        <TextButton
          label={busy === "signout" ? "로그아웃 중…" : "로그아웃"}
          onPress={signOut}
          disabled={busy !== null}
          tone="muted"
        />
        <AppText style={[styles.linkDivider, { color: colors.textMuted }]}>
          ·
        </AppText>
        <TextButton
          label={
            busy === "delete"
              ? "처리 중…"
              : confirmDelete
              ? "정말 탈퇴하기"
              : "회원탈퇴"
          }
          onPress={deleteAccount}
          disabled={busy !== null}
          tone="danger"
        />
      </View>
      {confirmDelete ? (
        <View
          accessibilityLiveRegion="assertive"
          style={[styles.deleteWarning, { backgroundColor: colors.dangerSoft }]}
        >
          <AppText style={[styles.deleteWarningText, { color: colors.danger }]}>
            한 번 더 누르면 계정과 동기화된 학습 기록이 삭제됩니다. 스토어
            구독은 자동 해지되지 않으므로 구독 관리에서 별도로 해지해야 합니다.
          </AppText>
          <TextButton
            label="취소"
            onPress={() => setConfirmDelete(false)}
            tone="muted"
          />
        </View>
      ) : null}
      <AppText style={[styles.version, { color: colors.textMuted }]}>
        다외워 0.1.0
      </AppText>
    </Screen>
  );
}

interface SettingSwitchRowProps {
  readonly label: string;
  readonly description: string;
  readonly value: boolean;
  readonly onValueChange: (value: boolean) => void;
  readonly disabled?: boolean;
  readonly last?: boolean;
}

function SettingSwitchRow({
  label,
  description,
  value,
  onValueChange,
  disabled = false,
  last = false,
}: SettingSwitchRowProps) {
  const { colors } = useDaoewoTheme();

  return (
    <View
      accessibilityLabel={`${label}, ${description}`}
      style={[
        styles.settingRow,
        !last
          ? {
              borderBottomColor: colors.border,
              borderBottomWidth: StyleSheet.hairlineWidth,
            }
          : undefined,
      ]}
    >
      <View style={styles.settingRowCopy}>
        <AppText style={styles.settingLabel}>{label}</AppText>
        <AppText
          style={[styles.settingDescription, { color: colors.textMuted }]}
        >
          {description}
        </AppText>
      </View>
      <Switch
        accessibilityLabel={label}
        accessibilityState={{ checked: value, disabled }}
        disabled={disabled}
        ios_backgroundColor={colors.border}
        onValueChange={onValueChange}
        thumbColor={colors.surface}
        trackColor={{ false: colors.border, true: colors.accent }}
        value={value}
      />
    </View>
  );
}

interface SettingInfoRowProps {
  readonly label: string;
  readonly value: string;
  readonly last?: boolean;
}

function SettingInfoRow({ label, value, last = false }: SettingInfoRowProps) {
  const { colors } = useDaoewoTheme();

  return (
    <View
      accessibilityLabel={`${label}, ${value}`}
      style={[
        styles.settingRow,
        !last
          ? {
              borderBottomColor: colors.border,
              borderBottomWidth: StyleSheet.hairlineWidth,
            }
          : undefined,
      ]}
    >
      <AppText style={styles.settingLabel}>{label}</AppText>
      <AppText style={[styles.settingValue, { color: colors.textMuted }]}>
        {value}
      </AppText>
    </View>
  );
}

interface SettingActionRowProps extends SettingInfoRowProps {
  readonly onPress: () => void;
  readonly disabled?: boolean;
}

function SettingActionRow({
  label,
  value,
  last = false,
  onPress,
  disabled = false,
}: SettingActionRowProps) {
  const { colors } = useDaoewoTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.settingRow,
        !last
          ? {
              borderBottomColor: colors.border,
              borderBottomWidth: StyleSheet.hairlineWidth,
            }
          : undefined,
        pressed && !disabled ? styles.pressed : undefined,
        disabled ? styles.disabled : undefined,
      ]}
    >
      <AppText style={styles.settingLabel}>{label}</AppText>
      <View style={styles.settingActionValue}>
        {value ? (
          <AppText style={[styles.settingValue, { color: colors.textMuted }]}>
            {value}
          </AppText>
        ) : null}
        <AppText style={[styles.settingChevron, { color: colors.textMuted }]}>
          ›
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.73 },
  disabled: { opacity: 0.48 },
  paywallHero: {
    alignItems: "center",
    paddingHorizontal: 12,
    paddingBottom: 24,
  },
  paywallTitle: {
    fontSize: 31,
    lineHeight: 40,
    fontWeight: "800",
    textAlign: "center",
    marginTop: 15,
  },
  paywallSubtitle: {
    fontSize: 14,
    lineHeight: 22,
    textAlign: "center",
    marginTop: 8,
  },
  benefitList: { borderRadius: 24, borderWidth: 1, padding: 19, gap: 14 },
  benefitRow: { flexDirection: "row", alignItems: "center" },
  benefitCheck: {
    width: 27,
    height: 27,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 11,
  },
  benefitCheckText: { fontSize: 14, lineHeight: 18, fontWeight: "800" },
  benefitText: { flex: 1, fontSize: 15, lineHeight: 21, fontWeight: "600" },
  planList: { gap: 10, marginVertical: 20 },
  planOption: {
    minHeight: 78,
    borderRadius: 20,
    borderWidth: 1.5,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
  },
  planRadio: {
    width: 21,
    height: 21,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  planRadioInner: { width: 11, height: 11, borderRadius: 6 },
  planCopy: { flex: 1 },
  planLabelRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  planLabel: { fontSize: 16, lineHeight: 22, fontWeight: "700" },
  planDescription: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  planPrice: { fontSize: 14, lineHeight: 20, fontWeight: "800", marginLeft: 8 },
  activePlan: { borderRadius: 18, padding: 17, alignItems: "center" },
  activePlanText: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "700",
    textAlign: "center",
  },
  offerUnavailable: {
    borderRadius: 18,
    padding: 17,
    alignItems: "center",
    marginVertical: 20,
  },
  offerUnavailableText: { fontSize: 14, lineHeight: 20, fontWeight: "700" },
  purchaseMessage: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    marginTop: 12,
  },
  paywallLinks: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
  },
  linkDivider: { fontSize: 13, lineHeight: 18 },
  billingNotice: {
    fontSize: 10,
    lineHeight: 16,
    textAlign: "center",
    paddingHorizontal: 12,
    marginTop: 6,
  },
  unpublishedLinks: {
    fontSize: 10,
    lineHeight: 16,
    textAlign: "center",
    paddingHorizontal: 12,
    marginTop: 5,
  },
  accountLinkPanel: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    marginTop: 18,
  },
  accountLinkTitle: { fontSize: 16, lineHeight: 22, fontWeight: "800" },
  accountLinkDescription: { fontSize: 12, lineHeight: 18, marginTop: 5 },
  accountLinkButtons: { gap: 9, marginTop: 14 },
  accountLinkError: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 10,
    textAlign: "center",
  },
  settingsHeader: { paddingTop: 20, paddingBottom: 18 },
  settingsTitle: { fontSize: 31, lineHeight: 40, fontWeight: "800" },
  settingSectionTitle: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
    marginTop: 22,
    marginBottom: 8,
    marginLeft: 4,
  },
  settingGroup: {
    borderRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 17,
    overflow: "hidden",
  },
  profileRow: { minHeight: 88, flexDirection: "row", alignItems: "center" },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  avatarText: { fontSize: 20, lineHeight: 26, fontWeight: "800" },
  profileCopy: { flex: 1 },
  profileName: { fontSize: 16, lineHeight: 22, fontWeight: "700" },
  profileEmail: { fontSize: 12, lineHeight: 18, marginTop: 2 },
  settingRow: {
    minHeight: 65,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
  },
  settingRowCopy: { flex: 1, paddingRight: 12 },
  settingLabel: { fontSize: 15, lineHeight: 21, fontWeight: "600" },
  settingDescription: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  settingValue: { fontSize: 13, lineHeight: 19 },
  settingActionValue: { flexDirection: "row", alignItems: "center" },
  settingChevron: { fontSize: 25, lineHeight: 28, marginLeft: 7 },
  settingsMessage: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    marginTop: 18,
  },
  accountActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 26,
  },
  deleteWarning: {
    borderRadius: 16,
    padding: 14,
    alignItems: "center",
    marginTop: 6,
  },
  deleteWarningText: { fontSize: 12, lineHeight: 18, textAlign: "center" },
  version: { fontSize: 11, lineHeight: 16, textAlign: "center", marginTop: 16 },
});
