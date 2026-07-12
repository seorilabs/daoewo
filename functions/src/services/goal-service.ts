import { buildDailyAssignment, isEntitled } from "@daoewo/product-core";
import { BACKEND_CONFIG } from "../config.js";
import type { Clock, StudyGoal } from "../domain/types.js";
import { BackendError, assertBackend } from "../errors.js";
import type {
  CatalogRepository,
  EntitlementRepository,
  GoalRepository,
  StudyRepository,
} from "../repositories/contracts.js";
import { assertLocalDate, assertValidTimezone } from "../utils/time.js";
import { sha256 } from "../utils/hash.js";

export interface CreateGoalInput {
  deckId: string;
  targetCount: number;
  startDate: string;
  endDate?: string;
  dailyTarget?: number;
  timezone: string;
  deviceId: string;
}

export class GoalService {
  constructor(
    private readonly catalog: CatalogRepository,
    private readonly goals: GoalRepository,
    private readonly entitlements: EntitlementRepository,
    private readonly devices: Pick<StudyRepository, "ensureDeviceAccess">,
    private readonly clock: Clock,
  ) {}

  async createOrReset(uid: string, input: CreateGoalInput): Promise<StudyGoal> {
    assertLocalDate(input.startDate, "startDate");
    if (input.endDate !== undefined) {
      assertLocalDate(input.endDate, "endDate");
      assertBackend(
        input.endDate >= input.startDate,
        "invalid-argument",
        "endDate must not precede startDate.",
      );
    }
    assertValidTimezone(input.timezone);

    const [deck, entitlement] = await Promise.all([
      this.catalog.getDeck(input.deckId),
      this.entitlements.getEntitlement(uid),
    ]);
    assertBackend(deck !== null && deck.status === "published", "not-found", "Deck not found.");
    const now = this.clock.now();
    const pro = entitlement !== null && isEntitled(entitlement, now);
    assertBackend(
      deck.tier === "free" || pro,
      "permission-denied",
      "An active Pro entitlement is required for this deck.",
    );
    await this.devices.ensureDeviceAccess(uid, sha256(input.deviceId), pro, now);
    assertBackend(
      Number.isSafeInteger(input.targetCount) &&
        input.targetCount > 0 &&
        input.targetCount <= deck.cardCount,
      "invalid-argument",
      "targetCount must be within the published deck range.",
    );
    if (input.dailyTarget !== undefined) {
      assertBackend(
        Number.isSafeInteger(input.dailyTarget) &&
          input.dailyTarget > 0 &&
          input.dailyTarget <= input.targetCount,
        "invalid-argument",
        "dailyTarget must be within the goal range.",
      );
      assertBackend(
        pro || input.dailyTarget <= BACKEND_CONFIG.freeDailyCardLimit,
        "failed-precondition",
        `Free plans can schedule at most ${BACKEND_CONFIG.freeDailyCardLimit} cards per day.`,
      );
    }
    assertBackend(
      input.endDate !== undefined || input.dailyTarget !== undefined,
      "invalid-argument",
      "Either endDate or dailyTarget is required.",
    );

    const indexIds = Array.from({ length: input.targetCount }, (_, index) => String(index));
    const assignmentInput = {
      cardCount: input.targetCount,
      cardIds: indexIds,
      startDate: input.startDate,
      ...(input.endDate === undefined ? {} : { endDate: input.endDate }),
      ...(input.dailyTarget === undefined ? {} : { dailyTarget: input.dailyTarget }),
    };
    const rawAssignments = buildDailyAssignment(assignmentInput);
    assertBackend(
      pro ||
        Object.values(rawAssignments).every(
          (ids) => ids.length <= BACKEND_CONFIG.freeDailyCardLimit,
        ),
      "failed-precondition",
      `Free plans can schedule at most ${BACKEND_CONFIG.freeDailyCardLimit} cards per day.`,
    );
    const assignments = Object.fromEntries(
      Object.entries(rawAssignments).map(([date, ids]) => [
        date,
        ids.map((id) => {
          const index = Number(id);
          if (!Number.isSafeInteger(index) || index < 0 || index >= input.targetCount) {
            throw new BackendError(
              "internal",
              "product-core returned an invalid assignment index.",
            );
          }
          return index;
        }),
      ]),
    );

    const isoNow = now.toISOString();
    const goal: StudyGoal = {
      id: input.deckId,
      uid,
      deckId: deck.id,
      deckVersion: deck.version,
      active: true,
      targetCount: input.targetCount,
      startDate: input.startDate,
      timezone: input.timezone,
      assignments,
      createdAt: isoNow,
      updatedAt: isoNow,
      revision: 1,
      ...(input.endDate === undefined ? {} : { endDate: input.endDate }),
      ...(input.dailyTarget === undefined ? {} : { dailyTarget: input.dailyTarget }),
    };

    return this.goals.createOrResetGoal({
      uid,
      goal,
      maxActiveGoals: pro ? null : BACKEND_CONFIG.freeActiveGoalLimit,
      resetCooldownMs: BACKEND_CONFIG.goalResetCooldownHours * 60 * 60 * 1_000,
      now,
    });
  }

  async deactivate(uid: string, goalId: string, deviceId: string): Promise<void> {
    const now = this.clock.now();
    const entitlement = await this.entitlements.getEntitlement(uid);
    const pro = entitlement !== null && isEntitled(entitlement, now);
    await this.devices.ensureDeviceAccess(uid, sha256(deviceId), pro, now);
    await this.goals.deactivateGoal(uid, goalId, now);
  }
}
