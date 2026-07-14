import { describe, expect, it } from "vitest";
import { isAuthorized } from "./auth";

describe("cron-route guard", () => {
  it("accepts exactly the Vercel Cron bearer header", () => {
    expect(isAuthorized("Bearer s3cret", "s3cret")).toBe(true);
  });

  it("rejects a missing header", () => {
    expect(isAuthorized(null, "s3cret")).toBe(false);
  });

  it("rejects a wrong secret", () => {
    expect(isAuthorized("Bearer nope", "s3cret")).toBe(false);
  });

  it("rejects a bare secret without the Bearer scheme", () => {
    expect(isAuthorized("s3cret", "s3cret")).toBe(false);
  });

  it("would match a bare 'Bearer ' header against an empty secret — which is exactly why the handler 500s on an unset/empty secret BEFORE calling this guard", () => {
    expect(isAuthorized("Bearer ", "")).toBe(true);
  });
});
