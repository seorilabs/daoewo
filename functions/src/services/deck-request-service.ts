import { isEntitled } from "@daoewo/product-core";
import { BACKEND_CONFIG } from "../config.js";
import type { Clock, DeckRequestRecord } from "../domain/types.js";
import type {
  DeckRequestRepository,
  EntitlementRepository,
} from "../repositories/contracts.js";

export interface CreateDeckRequestInput {
  topic: string;
  category: string;
  language: string;
  note?: string;
}

export class DeckRequestService {
  constructor(
    private readonly requests: DeckRequestRepository,
    private readonly entitlements: EntitlementRepository,
    private readonly clock: Clock,
  ) {}

  async create(uid: string, input: CreateDeckRequestInput): Promise<DeckRequestRecord> {
    const now = this.clock.now();
    const entitlement = await this.entitlements.getEntitlement(uid);
    const pro = entitlement !== null && isEntitled(entitlement, now);
    const isoNow = now.toISOString();
    return this.requests.createDeckRequest(
      {
        uid,
        topic: input.topic,
        category: input.category,
        language: input.language,
        status: "queued",
        priority: pro ? "pro" : "normal",
        createdAt: isoNow,
        updatedAt: isoNow,
        ...(input.note === undefined ? {} : { note: input.note }),
      },
      BACKEND_CONFIG.maxDeckRequestsPerUtcDay,
    );
  }
}
