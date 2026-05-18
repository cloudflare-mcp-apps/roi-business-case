/**
 * ROI Business Case MCP Server — Cloudflare canonical pattern (createMcpHandler)
 *
 * Architecture:
 * - JWT pre-handler verifies WorkOS AuthKit tokens via JWKS, then looks up the
 *   user in shared D1 (`mcp-oauth`) by `workos_user_id`.
 * - createMcpHandler from agents/mcp wraps a fresh McpServer per request,
 *   handles Streamable HTTP transport, GHSA-345p-7cg4-v4c7 safe.
 * - Auth context (userId, email) flows to tool handlers via authContext option
 *   → tools call getMcpAuthContext() to retrieve.
 */

import type { Env } from "./types";
import { verifyJwt } from "./auth/jwt-verify";
import { getUserByWorkosId } from "./auth/auth-utils";
import { handleProtectedResource, handleAuthorizationServer, buildWWWAuthenticateHeader } from "./well-known";
import { createMcpHandler } from "agents/mcp";
import { createServer } from "./server";

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    const baseUrl = `${url.protocol}//${url.host}`;

    try {
      if (url.pathname === '/.well-known/oauth-protected-resource') {
        return handleProtectedResource(baseUrl, env.AUTHKIT_DOMAIN);
      }

      if (url.pathname === '/.well-known/oauth-authorization-server') {
        return handleAuthorizationServer(env.AUTHKIT_DOMAIN);
      }

      if (url.pathname === '/mcp' && request.method === 'POST') {
        return await handleAuthenticatedMcp(request, env, ctx, baseUrl);
      }

      return new Response('Not found', { status: 404 });
    } catch (_error) {
      return Response.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  },
};

async function handleAuthenticatedMcp(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  baseUrl: string
): Promise<Response> {
  const token = request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];

  if (!token) {
    return unauthorizedResponse(baseUrl);
  }

  const jwtResult = await verifyJwt(token, env.AUTHKIT_DOMAIN);
  if (!jwtResult) return unauthorizedResponse(baseUrl);

  const dbUser = await getUserByWorkosId(env.DB, jwtResult.workosUserId);
  if (!dbUser) return unauthorizedResponse(baseUrl);
  const userId = dbUser.user_id;
  const email = dbUser.email ?? '';

  const server = createServer(env);
  return createMcpHandler(server, {
    authContext: { props: { userId, email } }
  })(request, env, ctx);
}

function unauthorizedResponse(baseUrl: string): Response {
  return Response.json(
    { error: 'Unauthorized' },
    {
      status: 401,
      headers: { 'WWW-Authenticate': buildWWWAuthenticateHeader(baseUrl) },
    }
  );
}
