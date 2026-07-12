import { describe, expect, it } from "vitest";
import { parseDeleteAccount, parseReceipt } from "../../src/input.js";

describe("receipt input", () => {
  it("accepts AppsInToss pending orders with orderId and sku only", () => {
    expect(
      parseReceipt({
        platform: "apps-in-toss",
        orderId: "pending-order-id",
        sku: "daoewo.pro.monthly",
      }),
    ).toEqual({
      platform: "apps-in-toss",
      productId: "daoewo.pro.monthly",
      orderId: "pending-order-id",
      sku: "daoewo.pro.monthly",
    });
  });

  it("still rejects an AppsInToss client claim without orderId", () => {
    expect(() =>
      parseReceipt({
        platform: "apps-in-toss",
        sku: "daoewo.pro.monthly",
        processProductGrant: true,
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid-argument" }));
  });
});

describe("account deletion input", () => {
  it("requires an explicit destructive confirmation", () => {
    expect(parseDeleteAccount({ confirmation: "DELETE" })).toBeUndefined();
    expect(() => parseDeleteAccount({ confirmation: "delete" })).toThrowError(
      expect.objectContaining({ code: "invalid-argument" }),
    );
  });
});
