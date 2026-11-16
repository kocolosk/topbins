import { describe, expect, it } from "vitest";
import { publicCamera } from "../src/camera";

describe("public camera details", () => {
  it("formats the approved exposure fields", () => {
    expect(
      publicCamera({
        Make: "Canon",
        Model: "Canon EOS R6m2",
        LensModel: "RF70-200mm F2.8 L IS USM",
        FocalLength: 200,
        FocalLengthIn35mmFormat: 200,
        FNumber: 2.8,
        ExposureTime: 0.001,
        ISO: 1600,
        ExposureCompensation: 0.67,
        ExposureProgram: 3,
        MeteringMode: 5,
        Flash: 16,
        WhiteBalance: 0,
      }),
    ).toEqual([
      { label: "Camera", value: "Canon EOS R6m2" },
      { label: "Lens", value: "RF70-200mm F2.8 L IS USM" },
      { label: "Focal length", value: "200 mm" },
      { label: "Aperture", value: "f/2.8" },
      { label: "Shutter", value: "1/1000 s" },
      { label: "ISO", value: "1600" },
      { label: "Exposure compensation", value: "+0.67 EV" },
      { label: "Exposure program", value: "Aperture priority" },
      { label: "Metering", value: "Multi-segment" },
      { label: "Flash", value: "Did not fire" },
      { label: "White balance", value: "Auto" },
    ]);
  });

  it("joins make and model, shows crop-factor equivalents and long exposures", () => {
    const details = publicCamera({
      Make: "Fuji",
      Model: "X-T5",
      FocalLength: 56,
      FocalLengthIn35mmFormat: 84,
      ExposureTime: 2,
    });
    expect(details?.[0]?.value).toBe("Fuji X-T5");
    expect(details).toContainEqual({
      label: "Focal length",
      value: "56 mm (84 mm equivalent)",
    });
    expect(details).toContainEqual({ label: "Shutter", value: "2 s" });
  });

  it("drops unknown keys, serial numbers, wrong types and unsafe strings", () => {
    expect(
      publicCamera({
        SerialNumber: "123456",
        BodySerialNumber: "123456",
        Model: "bad\nmodel",
        LensModel: "x".repeat(101),
        FNumber: "2.8",
        ISO: Number.POSITIVE_INFINITY,
        Flash: -1,
      }),
    ).toBeNull();
    expect(publicCamera(null)).toBeNull();
    expect(publicCamera([])).toBeNull();
    expect(publicCamera({})).toBeNull();
  });
});
