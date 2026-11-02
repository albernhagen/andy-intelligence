import { describe, expect, it } from "vitest";
import { ApiError, createApi, errorText, unwrap } from "./api";

describe("createApi", () => {
  it("GivenASignedInUser_WhenCallingTheApi_ThenTheIdTokenIsSentAsBearer", async () => {
    let seen: string | null = null;
    const api = createApi({
      baseUrl: "http://localhost",
      getToken: async () => "tok",
      fetch: async (req) => {
        seen = req.headers.get("authorization");
        return Response.json([]);
      },
    });
    await api.GET("/api/projects");
    expect(seen).toBe("Bearer tok");
  });

  it("GivenNoUser_WhenCallingTheApi_ThenNoAuthorizationHeaderIsSent", async () => {
    let seen: string | null = "unset";
    const api = createApi({
      baseUrl: "http://localhost",
      getToken: async () => null,
      fetch: async (req) => {
        seen = req.headers.get("authorization");
        return Response.json([]);
      },
    });
    await api.GET("/api/projects");
    expect(seen).toBeNull();
  });
});

describe("unwrap", () => {
  it("GivenARuleViolation_WhenUnwrapped_ThenAnApiErrorCarriesMessageAndDetails", () => {
    const response = new Response(null, { status: 422 });
    const err = (() => {
      try {
        unwrap({ error: { error: "Definition of Ready not met", details: ["size"] }, response });
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 422, details: ["size"] });
    expect(errorText(err)).toBe("Definition of Ready not met: size");
  });

  it("GivenANonJsonError_WhenUnwrapped_ThenTheStatusIsInTheMessage", () => {
    const response = new Response(null, { status: 502 });
    expect(() => unwrap({ error: "Bad gateway", response })).toThrow("request failed (502)");
  });

  it("GivenData_WhenUnwrapped_ThenItIsReturned", () => {
    expect(unwrap({ data: [1], response: new Response(null, { status: 200 }) })).toEqual([1]);
  });
});
