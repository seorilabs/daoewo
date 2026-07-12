import AsyncStorage from '@react-native-async-storage/async-storage';
import {listPublicCatalog} from '@daoewo/product-catalog';
import {
  createBundledFreeContentAdapter,
  type PublishedDeckContent,
} from '@daoewo/product-catalog/bundled-free-content';
import {
  type DaoewoCardView,
  type DaoewoDeckRequestInput,
  type DaoewoEntitlementState,
  type DaoewoRuntime,
  type DaoewoUser,
} from '@daoewo/product-ui';
import {AccessibilityInfo, Linking} from 'react-native';

const GUEST_KEY = 'daoewo:auth:offline-guest';
const DECK_REQUESTS_KEY = 'daoewo:content:offline-deck-requests';
const FREE_ENTITLEMENT: DaoewoEntitlementState = {
  plan: 'free',
  source: 'mobile-local',
  validUntil: null,
};

export function createOfflineMobileRuntime(legalUrls?: {
  readonly terms: string;
  readonly privacy: string;
}, bundledFreeContent?: Readonly<Record<string, PublishedDeckContent>>): DaoewoRuntime {
  const externalLinks = createExternalLinks(legalUrls);
  const storage = createStorage();
  const bundledFree = createBundledFreeContentAdapter({
    storage,
    async getOwnerId() {
      const user = await storage.getItem<DaoewoUser>(GUEST_KEY);
      return user?.isGuest === true ? user.id : null;
    },
    ...(bundledFreeContent === undefined ? {} : {content: bundledFreeContent}),
  });
  return {
    analytics: {
      async track() {
        // Firebase가 구성되지 않은 local build에서는 외부 전송을 하지 않는다.
      },
    },
    storage,
    auth: {
      async getCurrentUser() {
        const value = await AsyncStorage.getItem(GUEST_KEY);
        return value === null ? null : (JSON.parse(value) as DaoewoUser);
      },
      async continueAsGuest() {
        const guest: DaoewoUser = {
          id: 'mobile-local-guest',
          displayName: '게스트',
          isGuest: true,
        };
        await AsyncStorage.setItem(GUEST_KEY, JSON.stringify(guest));
        return guest;
      },
      async signIn() {
        throw new Error('Firebase 로그인이 아직 설정되지 않았어요.');
      },
      async signOut() {
        const user = await storage.getItem<DaoewoUser>(GUEST_KEY);
        if (user?.isGuest === true) {
          await bundledFree.removeOwnerState(user.id);
        }
        await Promise.all([
          AsyncStorage.removeItem(GUEST_KEY),
          AsyncStorage.removeItem(DECK_REQUESTS_KEY),
        ]);
      },
      async deleteAccount() {
        const daoewoKeys = (await AsyncStorage.getAllKeys()).filter(key =>
          key.startsWith('daoewo:'),
        );
        if (daoewoKeys.length > 0) {
          await Promise.all(
            daoewoKeys.map(key => AsyncStorage.removeItem(key)),
          );
        }
      },
    },
    purchase: {
      async getEntitlement() {
        return FREE_ENTITLEMENT;
      },
      async purchase() {
        throw new Error('스토어 구독 상품이 아직 설정되지 않았어요.');
      },
      async restore() {
        throw new Error('스토어 구독 상품이 아직 설정되지 않았어요.');
      },
    },
    tts: {
      async speak(text) {
        AccessibilityInfo.announceForAccessibility(text);
      },
      async stop() {},
    },
    content: {
      async listCatalog() {
        return Promise.all(
          listPublicCatalog('free').map(async deck => {
            const base = mapPublicDeck(deck);
            if (!bundledFree.hasDeck(deck.id)) {
              return base;
            }
            const summary = await bundledFree.getDeckSummary(deck.id).catch(() => null);
            return summary === null || !summary.active
              ? base
              : {...base, progress: summary.progress, daysLeft: summary.daysLeft};
          }),
        );
      },
      async getDeck(deckId) {
        const decks = await this.listCatalog();
        return decks.find(deck => deck.id === deckId) ?? null;
      },
      async createGoal(input) {
        return bundledFree.createGoal(input);
      },
      async getCardWindow(input) {
        const window = await bundledFree.getCardWindow(input);
        const deck = listPublicCatalog('free').find(item => item.id === input.deckId);
        const locale = deck === undefined ? '한국어' : mapLocale(deck.contentLanguage);
        return {
          id: window.id,
          deckId: window.deckId,
          goalKey: window.goalKey,
          cards: window.cards.map(card => mapBundledCard(card, locale)),
          targetCount: window.targetCount,
        };
      },
      async commitProgressBatch(batch) {
        await bundledFree.commitProgressBatch(batch);
      },
      async submitDeckRequest(request: DaoewoDeckRequestInput) {
        const raw = await AsyncStorage.getItem(DECK_REQUESTS_KEY);
        const requests =
          raw === null ? [] : (JSON.parse(raw) as readonly DaoewoDeckRequestInput[]);
        await AsyncStorage.setItem(
          DECK_REQUESTS_KEY,
          JSON.stringify([...requests, request]),
        );
      },
    },
    ...(externalLinks === undefined ? {} : {externalLinks}),
    now: () => new Date(),
  };
}

function createStorage(): DaoewoRuntime['storage'] {
  return {
    async getItem<T>(key: string) {
      const value = await AsyncStorage.getItem(key);
      if (value === null) {
        return null;
      }
      try {
        return JSON.parse(value) as T;
      } catch {
        await AsyncStorage.removeItem(key);
        return null;
      }
    },
    async setItem<T>(key: string, value: T) {
      await AsyncStorage.setItem(key, JSON.stringify(value));
    },
    async removeItem(key: string) {
      await AsyncStorage.removeItem(key);
    },
  };
}

function mapPublicDeck(
  deck: ReturnType<typeof listPublicCatalog>[number],
) {
  return {
    id: deck.id,
    title: deck.title,
    subtitle: deck.description,
    category: mapCategory(deck.category),
    locale: mapLocale(deck.contentLanguage),
    tier: deck.tier,
    source: deck.sourceType === 'curated-import' ? 'official' as const : 'ai-batch' as const,
    cardCount: deck.cardCount,
    tags: deck.tags,
    availability: deck.availability,
    isNew: deck.priority === 'P1',
  };
}

function mapBundledCard(
  card: PublishedDeckContent['chunks'][number]['cards'][number],
  locale: string,
): DaoewoCardView {
  return {
    id: card.id,
    deckId: card.deckId,
    front: card.front,
    back: card.back,
    ...(card.hint === undefined ? {} : {hint: card.hint}),
    ...(card.reading === undefined ? {} : {reading: card.reading}),
    ...(card.example === undefined ? {} : {example: card.example}),
    ...(card.exampleMeaning === undefined
      ? {}
      : {exampleMeaning: card.exampleMeaning}),
    tags: card.tags,
    locale,
  };
}

function createExternalLinks(
  legalUrls:
    | {readonly terms: string; readonly privacy: string}
    | undefined,
): DaoewoRuntime['externalLinks'] | undefined {
  if (
    legalUrls === undefined ||
    !isPublishedHttpsUrl(legalUrls.terms) ||
    !isPublishedHttpsUrl(legalUrls.privacy)
  ) {
    return undefined;
  }
  return {
    termsUrl: legalUrls.terms,
    privacyUrl: legalUrls.privacy,
    async open(url) {
      if (!isPublishedHttpsUrl(url)) {
        throw new Error('공개된 HTTPS 문서만 열 수 있어요.');
      }
      await Linking.openURL(url);
    },
  };
}

function isPublishedHttpsUrl(value: string): boolean {
  const normalized = value.trim();
  return (
    /^https:\/\/[^/\s]+(?:\/|$)/i.test(normalized) &&
    !/(?:example\.com|placeholder|localhost|127\.0\.0\.1)/i.test(normalized)
  );
}

function mapCategory(
  category:
    | 'language'
    | 'certification'
    | 'career'
    | 'general-knowledge'
    | 'k12-secondary',
): '언어' | '자격증' | '직무' | '교양' | 'K-12' {
  switch (category) {
    case 'language':
      return '언어';
    case 'certification':
      return '자격증';
    case 'career':
      return '직무';
    case 'general-knowledge':
      return '교양';
    case 'k12-secondary':
      return 'K-12';
  }
}

function mapLocale(language: 'ko' | 'en' | 'ja'): string {
  switch (language) {
    case 'ko':
      return '한국어';
    case 'en':
      return '영어';
    case 'ja':
      return '일본어';
  }
}
