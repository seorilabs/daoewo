import {
  FieldValue,
  Timestamp,
  type DocumentData,
  type Firestore,
} from "firebase-admin/firestore";
import { assertBackend } from "../errors.js";
import type {
  ReconciliationCursorRepository,
  ReconciliationWindow,
} from "./reconciliation.js";

export class FirestoreReconciliationCursorRepository
  implements ReconciliationCursorRepository
{
  constructor(private readonly db: Firestore) {}

  async acquireWindow(input: {
    key: string;
    now: Date;
    lookbackMs: number;
    overlapMs: number;
    staleWindowGraceMs: number;
  }): Promise<ReconciliationWindow> {
    assertWindowInput(input);
    const ref = this.db.collection("storeReconciliationCursors").doc(input.key);
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const data = snapshot.data() ?? {};
      const existingStart = timestampDate(data.windowStart);
      const existingEnd = timestampDate(data.windowEnd);
      const existingPageToken = optionalPageToken(data.pageToken);
      const floor = input.now.getTime() - input.lookbackMs;
      const oldestRestartableStart = floor - input.staleWindowGraceMs;
      if (
        existingStart !== null &&
        existingEnd !== null &&
        existingStart.getTime() < existingEnd.getTime() &&
        (existingPageToken !== null ||
          existingStart.getTime() >= oldestRestartableStart)
      ) {
        return {
          key: input.key,
          startTime: existingStart,
          endTime: existingEnd,
          pageToken: existingPageToken,
        };
      }

      const completedThrough = timestampDate(data.completedThrough);
      const startMs = Math.max(
        floor,
        (completedThrough?.getTime() ?? floor) - input.overlapMs,
      );
      const window: ReconciliationWindow = {
        key: input.key,
        startTime: new Date(startMs),
        endTime: new Date(input.now),
        pageToken: null,
      };
      const abandonedWindow =
        existingStart !== null &&
        existingEnd !== null &&
        existingStart.getTime() < existingEnd.getTime();
      transaction.set(
        ref,
        {
          key: input.key,
          windowStart: Timestamp.fromDate(window.startTime),
          windowEnd: Timestamp.fromDate(window.endTime),
          pageToken: FieldValue.delete(),
          updatedAt: Timestamp.fromDate(input.now),
          ...(abandonedWindow
            ? {
                abandonedWindowCount: FieldValue.increment(1),
                lastAbandonedAt: Timestamp.fromDate(input.now),
                lastAbandonedWindowStart: Timestamp.fromDate(existingStart),
                lastAbandonedWindowEnd: Timestamp.fromDate(existingEnd),
              }
            : {}),
        },
        { merge: true },
      );
      return window;
    });
  }

  async advanceWindow(input: {
    window: ReconciliationWindow;
    nextPageToken: string | null;
    now: Date;
  }): Promise<void> {
    const ref = this.db
      .collection("storeReconciliationCursors")
      .doc(input.window.key);
    await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const data = snapshot.data() ?? {};
      const storedStart = timestampDate(data.windowStart);
      const storedEnd = timestampDate(data.windowEnd);
      assertBackend(
        storedStart?.getTime() === input.window.startTime.getTime() &&
          storedEnd?.getTime() === input.window.endTime.getTime() &&
          optionalPageToken(data.pageToken) === input.window.pageToken,
        "aborted",
        "Store reconciliation cursor changed during page processing.",
        { kind: "store-reconciliation-cursor-race" },
      );
      if (input.nextPageToken !== null) {
        assertBackend(
          input.nextPageToken.length > 0 && input.nextPageToken.length <= 4_096,
          "internal",
          "Store reconciliation returned an invalid pagination token.",
        );
        transaction.set(
          ref,
          {
            pageToken: input.nextPageToken,
            updatedAt: Timestamp.fromDate(input.now),
          },
          { merge: true },
        );
        return;
      }
      transaction.set(
        ref,
        {
          completedThrough: Timestamp.fromDate(input.window.endTime),
          windowStart: FieldValue.delete(),
          windowEnd: FieldValue.delete(),
          pageToken: FieldValue.delete(),
          updatedAt: Timestamp.fromDate(input.now),
        },
        { merge: true },
      );
    });
  }

  async restartWindow(input: {
    window: ReconciliationWindow;
    now: Date;
  }): Promise<void> {
    const ref = this.db
      .collection("storeReconciliationCursors")
      .doc(input.window.key);
    await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const data = snapshot.data() ?? {};
      const storedStart = timestampDate(data.windowStart);
      const storedEnd = timestampDate(data.windowEnd);
      assertBackend(
        input.window.pageToken !== null &&
          storedStart?.getTime() === input.window.startTime.getTime() &&
          storedEnd?.getTime() === input.window.endTime.getTime() &&
          optionalPageToken(data.pageToken) === input.window.pageToken,
        "aborted",
        "Store reconciliation cursor changed before pagination restart.",
        { kind: "store-reconciliation-cursor-race" },
      );
      transaction.set(
        ref,
        {
          pageToken: FieldValue.delete(),
          updatedAt: Timestamp.fromDate(input.now),
        },
        { merge: true },
      );
    });
  }
}

function assertWindowInput(input: {
  key: string;
  now: Date;
  lookbackMs: number;
  overlapMs: number;
  staleWindowGraceMs: number;
}): void {
  assertBackend(
    /^[a-z0-9-]{3,80}$/.test(input.key) &&
      Number.isFinite(input.now.getTime()) &&
      Number.isSafeInteger(input.lookbackMs) &&
      input.lookbackMs > 0 &&
      Number.isSafeInteger(input.overlapMs) &&
      input.overlapMs >= 0 &&
      input.overlapMs < input.lookbackMs &&
      Number.isSafeInteger(input.staleWindowGraceMs) &&
      input.staleWindowGraceMs > 0 &&
      input.staleWindowGraceMs < input.lookbackMs,
    "internal",
    "Store reconciliation cursor configuration is invalid.",
  );
}

function timestampDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    const date = (value as { toDate(): Date }).toDate();
    return Number.isFinite(date.getTime()) ? date : null;
  }
  return null;
}

function optionalPageToken(value: DocumentData[string]): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
