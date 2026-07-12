import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { FirestoreReceiptAccountBindingResolver } from "../../src/receipts/firestore-account-binding-resolver.js";

describe("FirestoreReceiptAccountBindingResolver", () => {
  it("returns current uid plus only verified merge sources targeting it", async () => {
    const resolver = resolverWith([
      marker("anonymous-source", "google-target"),
      marker("other-source", "other-target"),
    ]);

    await expect(resolver.resolveBindingUids("google-target")).resolves.toEqual([
      "google-target",
      "anonymous-source",
    ]);
    await expect(resolver.resolveBindingUids("unrelated-target")).resolves.toEqual([
      "unrelated-target",
    ]);
  });

  it("rejects access by a source uid that was already merged", async () => {
    const resolver = resolverWith([marker("anonymous-source", "google-target")]);
    await expect(
      resolver.resolveBindingUids("anonymous-source"),
    ).rejects.toMatchObject({
      code: "failed-precondition",
      details: { kind: "account-merged" },
    });
  });

  it("fails closed for markers without the explicit billing retention contract", async () => {
    const invalid = marker("anonymous-source", "google-target");
    invalid.data.billingBindingRetained = false;
    await expect(
      resolverWith([invalid]).resolveBindingUids("google-target"),
    ).rejects.toMatchObject({
      code: "failed-precondition",
      details: { kind: "receipt-binding-conflict" },
    });
  });

  it("rejects binding resolution after account deletion starts", async () => {
    await expect(
      resolverWith([], ["google-target"]).resolveBindingUids("google-target"),
    ).rejects.toMatchObject({
      code: "failed-precondition",
      details: { kind: "account-deleting" },
    });
  });
});

interface Marker {
  id: string;
  data: Record<string, unknown>;
}

function marker(sourceUid: string, targetUid: string): Marker {
  return {
    id: sourceUid,
    data: {
      sourceUid,
      targetUid,
      billingBindingRetained: true,
      mergedAt: Timestamp.fromDate(new Date("2026-07-12T00:00:00.000Z")),
    },
  };
}

function resolverWith(
  markers: readonly Marker[],
  deletingUids: readonly string[] = [],
) {
  const mergeCollection = {
    doc: (id: string) => ({
      get: async () => ({ exists: markers.some((entry) => entry.id === id) }),
    }),
    where: (_field: string, _operator: string, targetUid: string) => ({
      limit: (_limit: number) => ({
        get: async () => {
          const matching = markers.filter(
            (entry) => entry.data.targetUid === targetUid,
          );
          return {
            size: matching.length,
            docs: matching.map((entry) => ({
              id: entry.id,
              data: () => entry.data,
            })),
          };
        },
      }),
    }),
  };
  return new FirestoreReceiptAccountBindingResolver(
    {
      collection: (name: string) =>
        name === "accountMerges"
          ? mergeCollection
          : {
              doc: (id: string) => ({
                get: async () => ({ exists: deletingUids.includes(id) }),
              }),
            },
    } as never,
  );
}
