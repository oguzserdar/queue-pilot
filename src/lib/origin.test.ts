import { describe, expect, it } from "vitest";
import { publicOrigin } from "./origin";

describe("publicOrigin", () => {
  it("uses the forwarded host and protocol when a proxy sets them", () => {
    expect(publicOrigin(new Headers({ host: "internal:3000", "x-forwarded-host": "qp.example", "x-forwarded-proto": "https" }))).toBe("https://qp.example");
  });
  it("takes the first value of a comma list", () => {
    expect(publicOrigin(new Headers({ host: "a", "x-forwarded-host": "qp.example, edge", "x-forwarded-proto": "https, http" }))).toBe("https://qp.example");
  });
  it("falls back to the host header and https", () => {
    expect(publicOrigin(new Headers({ host: "qp.example" }))).toBe("https://qp.example");
  });
});
