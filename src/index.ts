import type { Env } from "./types";
import { validateApiKey } from "./auth/apiKeys";
import { verifyJwt } from "./auth/jwt-verify";
import { getUserByWorkosId } from "./auth/auth-utils";
import { getOrCreateServer, handleMcpRequest } from "./mcp-handler";
import { handleProtectedResource, handleAuthorizationServer, buildWWWAuthenticateHeader } from "./well-known";

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
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
        return await handleAuthenticatedMcp(request, env, baseUrl);
      }

      return new Response('Not found', { status: 404 });
    } catch (error) {
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
  baseUrl: string
): Promise<Response> {
  const token = request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];

  if (!token) {
    return unauthorizedResponse(baseUrl);
  }

  // Path 1: API Key (wtyk_ prefix)
  if (token.startsWith('wtyk_')) {
    const result = await validateApiKey(token, env);
    if (!result) return unauthorizedResponse(baseUrl);
    const server = getOrCreateServer(env, result.userId, result.email);
    return handleMcpRequest(server, request, env, result.userId, result.email);
  }

  // Path 2: JWT (WorkOS AuthKit)
  const jwtResult = await verifyJwt(token, env.AUTHKIT_DOMAIN);
  if (!jwtResult) return unauthorizedResponse(baseUrl);

  const dbUser = await getUserByWorkosId(env.DB, jwtResult.workosUserId);
  if (!dbUser) return unauthorizedResponse(baseUrl);

  const server = getOrCreateServer(env, dbUser.user_id, dbUser.email);
  return handleMcpRequest(server, request, env, dbUser.user_id, dbUser.email);
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
