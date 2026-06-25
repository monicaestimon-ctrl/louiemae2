import { describe, expect, it } from "vitest";
import {
  getTrackNumberFromOrderDetail,
  normalizeCjOrderStatus,
  normalizeCjTrackingStatus,
  reconcileCjTracking,
} from "./cjTracking";

describe("CJ tracking reconciliation", () => {
  it("maps documented CJ order statuses to local statuses", () => {
    expect(normalizeCjOrderStatus("UNSHIPPED")).toBe("processing");
    expect(normalizeCjOrderStatus("SHIPPED")).toBe("shipped");
    expect(normalizeCjOrderStatus("DELIVERED")).toBe("delivered");
    expect(normalizeCjOrderStatus("CANCELLED")).toBe("cancelled");
  });

  it("extracts a track number from order detail before querying logistic trackInfo", () => {
    expect(getTrackNumberFromOrderDetail({ trackNumber: "CJPKL7160102171YQ" })).toBe("CJPKL7160102171YQ");
  });

  it("maps dynamic CJ carrier tracking strings conservatively", () => {
    expect(normalizeCjTrackingStatus("Delivery exception")).toBe("failed");
    expect(normalizeCjTrackingStatus("In transit")).toBe("shipped");
    expect(normalizeCjTrackingStatus("Info Received")).toBeUndefined();
  });

  it("prefers last-mile tracking details for customer-facing updates", () => {
    expect(reconcileCjTracking(
      {
        orderStatus: "SHIPPED",
        trackNumber: "CJPKL7160102171YQ",
        trackingProvider: "CJPacket",
      },
      [{
        trackingNumber: "CJPKL7160102171YQ",
        trackingStatus: "In transit",
        logisticName: "CJPacket Sensitive",
        lastMileCarrier: "USPS",
        lastTrackNumber: "926112903032124",
        deliveryDay: "7-12 days",
        deliveryTime: "2026-06-18 10:15:00",
      }],
    )).toMatchObject({
      trackingNumber: "926112903032124",
      carrier: "USPS",
      cjTrackingStatus: "In transit",
      cjStatus: "shipped",
      orderStatus: "shipped",
      estimatedDelivery: "7-12 days",
      trackingUrl: "https://tools.usps.com/go/TrackConfirmAction?tLabels=926112903032124",
    });
  });

  it("marks delivered tracking as delivered for both CJ and local order status", () => {
    expect(reconcileCjTracking(
      { orderStatus: "SHIPPED", trackNumber: "CJPKL7160102171YQ" },
      [{ trackingNumber: "CJPKL7160102171YQ", trackingStatus: "Delivered" }],
    )).toMatchObject({
      cjStatus: "delivered",
      orderStatus: "delivered",
    });
  });

  it("handles webhook-first tracking when logistic rows arrive before order detail has tracking", () => {
    expect(reconcileCjTracking(
      { orderStatus: "SHIPPED" },
      [{
        trackingNumber: "CJPKL7160102171YQ",
        trackingStatus: "In transit",
        logisticName: "CJPacket",
        lastMileCarrier: "USPS",
        lastTrackNumber: "926112903032125",
      }],
    )).toMatchObject({
      trackingNumber: "926112903032125",
      carrier: "USPS",
      cjStatus: "shipped",
      orderStatus: "shipped",
    });
  });

  it("handles cron-first tracking when order detail has tracking before trackInfo rows are available", () => {
    expect(reconcileCjTracking({
      orderStatus: "SHIPPED",
      trackNumber: "CJPKL7160102171YQ",
      trackingProvider: "CJPacket",
      trackingUrl: "https://cj.example/track/CJPKL7160102171YQ",
    })).toMatchObject({
      trackingNumber: "CJPKL7160102171YQ",
      carrier: "CJPacket",
      cjStatus: "shipped",
      orderStatus: "shipped",
      trackingUrl: "https://cj.example/track/CJPKL7160102171YQ",
    });
  });

  it("handles delayed tracking by progressing from processing to shipped once CJ returns a track number", () => {
    expect(reconcileCjTracking({ orderStatus: "UNSHIPPED" })).toMatchObject({
      cjStatus: "processing",
      orderStatus: "processing",
      trackingNumber: undefined,
    });

    expect(reconcileCjTracking({
      orderStatus: "SHIPPED",
      trackNumber: "CJPKL7160102171YQ",
      trackingProvider: "CJPacket",
    })).toMatchObject({
      trackingNumber: "CJPKL7160102171YQ",
      carrier: "CJPacket",
      cjStatus: "shipped",
      orderStatus: "shipped",
      trackingUrl: "https://t.17track.net/en#nums=CJPKL7160102171YQ",
    });
  });
});
