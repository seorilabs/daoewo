import { isEntitled } from "@daoewo/product-core";
import type { CatalogDeck, Clock } from "../domain/types.js";
import type {
  CatalogFilter,
  CatalogRepository,
  EntitlementRepository,
} from "../repositories/contracts.js";

export class CatalogService {
  constructor(
    private readonly catalog: CatalogRepository,
    private readonly entitlements: EntitlementRepository,
    private readonly clock: Clock,
  ) {}

  async list(uid: string, filter: CatalogFilter): Promise<CatalogDeck[]> {
    const [decks, entitlement] = await Promise.all([
      this.catalog.listPublishedDecks(filter),
      this.entitlements.getEntitlement(uid),
    ]);
    const pro = entitlement !== null && isEntitled(entitlement, this.clock.now());

    return decks.map((deck) => ({
      ...deck,
      locked: deck.tier === "pro" && !pro,
    }));
  }
}
