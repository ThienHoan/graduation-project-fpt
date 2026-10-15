import { describe, expect, it } from "vitest";
import {
  DELIVERY_ADDRESS_SNAPSHOT_VERSION,
  readBookingDeliverySnapshot,
  serializeAddressSnapshot,
  type DeliveryAddressSnapshot,
} from "./booking-delivery";

const address = {
  receiverName: " Nguyễn An ",
  phone: " 0901234567 ",
  line1: " 12 Nguyễn Huệ ",
  ward: " Bến Nghé ",
  district: " Quận 1 ",
  city: " Hồ Chí Minh ",
  latitude: 10.775,
  longitude: 106.703,
};

function snapshot(overrides: Partial<DeliveryAddressSnapshot> = {}): DeliveryAddressSnapshot {
  return {
    version: DELIVERY_ADDRESS_SNAPSHOT_VERSION,
    receiverName: "Nguyễn An",
    phone: "0901234567",
    line1: "12 Nguyễn Huệ",
    ward: "Bến Nghé",
    district: "Quận 1",
    city: "Hồ Chí Minh",
    latitude: 10.775,
    longitude: 106.703,
    ...overrides,
  };
}

describe("serializeAddressSnapshot", () => {
  it("serializes a normalized, versioned address without copying unknown fields", () => {
    const serialized = serializeAddressSnapshot({
      ...address,
      customerId: "must-not-leak",
      isDefault: true,
    });

    expect(JSON.parse(serialized)).toEqual(snapshot());
    expect(serialized).not.toContain("customerId");
    expect(serialized).not.toContain("isDefault");
  });

  it("normalizes optional, blank, and unsafe values", () => {
    const serialized = serializeAddressSnapshot({
      receiverName: null,
      phone: 123,
      line1: "   ",
      ward: "",
      district: undefined,
      city: { unexpected: true },
      latitude: Number.POSITIVE_INFINITY,
      longitude: "106.7",
    });

    expect(JSON.parse(serialized)).toEqual(
      snapshot({
        receiverName: "",
        phone: "",
        line1: "",
        ward: null,
        district: null,
        city: null,
        latitude: null,
        longitude: null,
      }),
    );
  });
});

describe("readBookingDeliverySnapshot", () => {
  it("reads a typed snapshot from a booking delivery record", () => {
    const expected = snapshot();

    expect(
      readBookingDeliverySnapshot({
        deliveryRecords: [{ addressSnapshot: JSON.stringify(expected) }],
      }),
    ).toEqual(expected);
  });

  it("also accepts delivery records directly", () => {
    expect(readBookingDeliverySnapshot([{ addressSnapshot: JSON.stringify(snapshot()) }])).toEqual(snapshot());
  });

  it("chooses the newest valid snapshot without mutating or returning source data", () => {
    const older = snapshot({ receiverName: "Older" });
    const newer = snapshot({ receiverName: "Newer" });
    const records = [
      { addressSnapshot: JSON.stringify(older), createdAt: new Date("2026-01-01T00:00:00Z") },
      { addressSnapshot: JSON.stringify(newer), createdAt: new Date("2026-02-01T00:00:00Z") },
    ];
    const originalOrder = [...records];

    const result = readBookingDeliverySnapshot({ deliveryRecords: records });

    expect(result).toEqual(newer);
    expect(records).toEqual(originalOrder);
    result!.receiverName = "Changed by caller";
    expect(JSON.parse(records[1].addressSnapshot).receiverName).toBe("Newer");
  });

  it("skips a malformed newest record and reads the newest valid record", () => {
    const expected = snapshot({ receiverName: "Valid" });

    expect(
      readBookingDeliverySnapshot({
        deliveryRecords: [
          { addressSnapshot: JSON.stringify(expected), createdAt: "2026-01-01T00:00:00Z" },
          { addressSnapshot: "{bad json", createdAt: "2026-02-01T00:00:00Z" },
        ],
      }),
    ).toEqual(expected);
  });

  it.each([
    undefined,
    null,
    {},
    { deliveryRecords: null },
    { deliveryRecords: [] },
    { deliveryRecords: [{ addressSnapshot: null }] },
    { deliveryRecords: [{ addressSnapshot: "Legacy receiver - 0901234567\n12 Nguyễn Huệ" }] },
    { deliveryRecords: [{ addressSnapshot: "{}" }] },
    { deliveryRecords: [{ addressSnapshot: JSON.stringify({ ...snapshot(), version: 2 }) }] },
  ])("returns null for absent, legacy, or unsupported records", (source) => {
    expect(readBookingDeliverySnapshot(source)).toBeNull();
  });

  it("does not use the mutable live address relation as a snapshot fallback", () => {
    const liveAddress = { ...address, receiverName: "Changed after booking" };

    const bookingWithLiveAddress = {
      deliveryRecords: [],
      deliveryAddress: liveAddress,
    };

    expect(readBookingDeliverySnapshot(bookingWithLiveAddress)).toBeNull();
  });

  it("normalizes invalid optional fields in otherwise supported persisted JSON", () => {
    const persisted = {
      ...snapshot(),
      ward: 123,
      city: false,
      latitude: "10.775",
      longitude: Number.POSITIVE_INFINITY,
    };

    expect(
      readBookingDeliverySnapshot([{ addressSnapshot: JSON.stringify(persisted) }]),
    ).toEqual(snapshot({ ward: null, city: null, latitude: null, longitude: null }));
  });
});
