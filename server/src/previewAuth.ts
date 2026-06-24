import type { IncomingMessage } from "node:http";
import type { NextFunction, Request, Response } from "express";

// Private preview gate. When ARBOR_PREVIEW_TOKEN is set (Fly PR preview apps), every
// request must carry the token — either as `?token=<t>` (first visit, browser address
// bar) or the `arbor_preview` cookie we set on a successful query-param visit. The
// cookie lets the SPA's same-origin /api and /ws calls authenticate automatically
// after the initial page load. When the env var is unset (normal local dev), the gate
// is a no-op so nothing changes for developers.

const COOKIE_NAME = "arbor_preview";

export function previewToken(): string | undefined {
  return process.env.ARBOR_PREVIEW_TOKEN || undefined;
}

function tokenFromCookie(req: IncomingMessage): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE_NAME) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function tokenFromQuery(req: IncomingMessage): string | undefined {
  const url = new URL(req.url ?? "", "http://localhost");
  return url.searchParams.get("token") ?? undefined;
}

// True if the request presents the configured token by either mechanism. Shared by the
// Express middleware and the WebSocket `verifyClient` hook so both doors use one lock.
export function isAuthorized(req: IncomingMessage): boolean {
  const expected = previewToken();
  if (!expected) return true;
  return tokenFromCookie(req) === expected || tokenFromQuery(req) === expected;
}

export function previewAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const expected = previewToken();
  if (!expected) return next();

  // Health checks and GitHub's post-install redirect must stay reachable without
  // the preview cookie. The callback still carries an unguessable state token.
  if (req.path === "/api/health" || req.path === "/api/repos/github-app/callback") return next();

  if (tokenFromCookie(req) === expected) return next();

  if (tokenFromQuery(req) === expected) {
    // Persist the token so subsequent same-origin requests (assets, /api, /ws) pass
    // without the query string. Session cookie; HttpOnly is intentionally omitted so
    // it survives as a normal browser cookie for the preview's lifetime.
    res.setHeader("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(expected)}; Path=/; SameSite=Lax`);
    return next();
  }

  res.status(401).type("text/plain").send("Unauthorized: append ?token=<preview-token> to the URL.");
}
