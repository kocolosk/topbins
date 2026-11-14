import { expect, it } from "vitest";
import { endpointCredentials } from "../cli/import.ts";

const shared = { TOPBINS_PUBLISH_TOKEN: "synthetic-shared-token" };
const access = {
  TOPBINS_ACCESS_CLIENT_ID: "synthetic-id.access",
  TOPBINS_ACCESS_CLIENT_SECRET: "synthetic-secret",
};

it("uses the shared bearer token only for loopback HTTP", () => {
  const { credentials } = endpointCredentials("http://127.0.0.1:8787", {
    ...shared,
    ...access,
  });
  expect(credentials.headers).toEqual({
    Authorization: "Bearer synthetic-shared-token",
  });
  expect(() => endpointCredentials("http://127.0.0.1:8787", access)).toThrow(
    "TOPBINS_PUBLISH_TOKEN",
  );
});

it("uses only Access service-token headers for remote HTTPS", () => {
  const { origin, credentials } = endpointCredentials(
    "https://photos.example.test",
    { ...shared, ...access },
  );
  expect(origin.origin).toBe("https://photos.example.test");
  expect(credentials.headers).toEqual({
    "CF-Access-Client-Id": "synthetic-id.access",
    "CF-Access-Client-Secret": "synthetic-secret",
  });
  expect(JSON.stringify(credentials.headers)).not.toContain("shared");
  expect(() =>
    endpointCredentials("https://photos.example.test", shared),
  ).toThrow("TOPBINS_ACCESS_CLIENT_ID");
  expect(() =>
    endpointCredentials("https://photos.example.test", {
      TOPBINS_ACCESS_CLIENT_ID: "id",
    }),
  ).toThrow("TOPBINS_ACCESS_CLIENT_SECRET");
});

it("rejects remote plain HTTP and ambiguous endpoints", () => {
  for (const endpoint of [
    "http://photos.example.test",
    "ftp://photos.example.test",
    "https://user:pass@photos.example.test",
    "https://photos.example.test/api",
    "https://photos.example.test/?q=1",
    "https://photos.example.test/#x",
  ])
    expect(() =>
      endpointCredentials(endpoint, { ...shared, ...access }),
    ).toThrow("loopback");
});
