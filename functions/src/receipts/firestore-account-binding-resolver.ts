import {
  Timestamp,
  type DocumentData,
  type Firestore,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { assertBackend } from "../errors.js";
import type { ReceiptAccountBindingResolver } from "./providers.js";

const MAX_HISTORICAL_BINDINGS = 50;

/**
 * 클라이언트가 만들 수 없는 accountMerges marker만 과거 billing principal로 인정한다.
 * source marker는 Auth source 삭제 뒤에도 store account binding 복구에 필요하다.
 */
export class FirestoreReceiptAccountBindingResolver
  implements ReceiptAccountBindingResolver
{
  constructor(private readonly db: Firestore) {}

  async resolveBindingUids(uid: string): Promise<readonly string[]> {
    const merges = this.db
      .collection("accountMerges")
      .where("targetUid", "==", uid)
      .limit(MAX_HISTORICAL_BINDINGS + 1);
    const [currentMarker, deletionMarker, historicalMarkers] = await Promise.all([
      this.db.collection("accountMerges").doc(uid).get(),
      this.db.collection("accountDeletions").doc(uid).get(),
      merges.get(),
    ]);
    assertBackend(
      !currentMarker.exists,
      "failed-precondition",
      "This account was merged into another Firebase account.",
      { kind: "account-merged" },
    );
    assertBackend(
      !deletionMarker.exists,
      "failed-precondition",
      "This account is being deleted.",
      { kind: "account-deleting" },
    );
    assertBackend(
      historicalMarkers.size <= MAX_HISTORICAL_BINDINGS,
      "resource-exhausted",
      "Receipt account has too many historical bindings.",
      { kind: "receipt-binding-limit" },
    );

    const sourceUids = historicalMarkers.docs.map((marker) =>
      validateHistoricalMarker(marker, uid),
    );
    const bindings = [uid, ...sourceUids];
    assertBackend(
      new Set(bindings).size === bindings.length,
      "failed-precondition",
      "Receipt account binding history is inconsistent.",
      { kind: "receipt-binding-conflict" },
    );
    return bindings;
  }
}

function validateHistoricalMarker(
  marker: QueryDocumentSnapshot<DocumentData>,
  targetUid: string,
): string {
  const data = marker.data();
  assertBackend(
    data.sourceUid === marker.id &&
      data.targetUid === targetUid &&
      data.billingBindingRetained === true &&
      data.mergedAt instanceof Timestamp,
    "failed-precondition",
    "Receipt account binding history is invalid.",
    { kind: "receipt-binding-conflict" },
  );
  return marker.id;
}
