import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  ApiUnavailableError,
  apiUrl,
  getApiBaseUrl,
  getApiBaseUrlState,
  isApiUnavailableError,
} from "./api";

describe("api URL helpers", () => {
  const originalWindow = global.window;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    global.window = originalWindow;
  });

  const env = (values: Record<string, string>): ImportMetaEnv =>
    ({
      BASE_URL: "/",
      MODE: "test",
      DEV: false,
      PROD: false,
      SSR: false,
      ...values,
    }) as ImportMetaEnv;

  it("uses the local backend by default when on localhost", () => {
    global.window = { location: { hostname: "localhost" } } as any;
    expect(getApiBaseUrl(env({}))).toBe("http://localhost:3001");
  });

  it("uses the local backend by default for IPv4 and IPv6 local hosts", () => {
    global.window = { location: { hostname: "127.0.0.1" } } as any;
    expect(getApiBaseUrl(env({}))).toBe("http://localhost:3001");

    global.window = { location: { hostname: "::1" } } as any;
    expect(getApiBaseUrl(env({}))).toBe("http://localhost:3001");
  });

  it("prefers VITE_API_BASE_URL and trims trailing slashes", () => {
    expect(
      getApiBaseUrl(env({
        VITE_API_BASE_URL: "https://api.example.com///",
        VITE_API_URL: "https://ignored.example.com",
      })),
    ).toBe("https://api.example.com");
  });

  it("falls back to VITE_API_URL", () => {
    expect(
      getApiBaseUrl(env({
        VITE_API_URL: "https://staging.example.com/",
      })),
    ).toBe("https://staging.example.com");
  });

  it("builds normalized API paths", () => {
    const configuredEnv = env({ VITE_API_BASE_URL: "https://api.example.com/" });
    expect(apiUrl("api/yields", configuredEnv)).toBe("https://api.example.com/api/yields");
    expect(apiUrl("/api/yields", configuredEnv)).toBe("https://api.example.com/api/yields");
  });

  it("returns an unavailable state when preview env vars are missing", () => {
    global.window = { location: { hostname: "stellar-yield-preview.vercel.app" } } as any;

    expect(getApiBaseUrlState(env({}))).toEqual({
      available: false,
      reason:
        "Backend URL is not configured for this preview. Set VITE_API_BASE_URL or VITE_API_URL in Vercel preview environment variables.",
    });
  });

  it("throws a typed unavailable error instead of falling back to localhost in previews", () => {
    global.window = { location: { hostname: "stellar-yield-preview.vercel.app" } } as any;

    try {
      getApiBaseUrl(env({}));
      throw new Error("expected getApiBaseUrl to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiUnavailableError);
      expect(isApiUnavailableError(error)).toBe(true);
      expect((error as Error).message).toContain("VITE_API_BASE_URL");
      expect((error as Error).message).toContain("VITE_API_URL");
    }
  });
});
