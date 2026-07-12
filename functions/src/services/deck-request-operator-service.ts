import type { Clock } from "../domain/types.js";
import { assertBackend } from "../errors.js";
import type {
  DeckRequestCompletionResult,
  DeckRequestOperatorRepository,
} from "../repositories/contracts.js";

export interface CompleteDeckRequestInput {
  readonly requestId: string;
  readonly readyDeckId: string;
}

/** request.auth에서 Firebase가 검증한 uid와 custom claim만 전달해야 한다. */
export interface DeckRequestOperatorContext {
  readonly uid: string;
  readonly operatorClaim: unknown;
}

export class DeckRequestOperatorService {
  constructor(
    private readonly requests: DeckRequestOperatorRepository,
    private readonly clock: Clock,
  ) {}

  async complete(
    actor: DeckRequestOperatorContext,
    input: CompleteDeckRequestInput,
  ): Promise<DeckRequestCompletionResult> {
    assertBackend(
      typeof actor.uid === "string" &&
        actor.uid.length > 0 &&
        actor.operatorClaim === true,
      "permission-denied",
      "Operator claim is required.",
      { kind: "operator-claim-required" },
    );
    return this.requests.completeDeckRequest({
      requestId: input.requestId,
      readyDeckId: input.readyDeckId,
      now: this.clock.now(),
    });
  }
}
