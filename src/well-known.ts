export function handleProtectedResource(baseUrl: string, authkitDomain: string): Response {
  return Response.json({
    resource: baseUrl,
    authorization_servers: [`https://${authkitDomain}`],
    bearer_methods_supported: ['header'],
  });
}

export function handleAuthorizationServer(authkitDomain: string): Response {
  return Response.json({
    issuer: `https://${authkitDomain}`,
    authorization_endpoint: `https://${authkitDomain}/oauth2/authorize`,
    token_endpoint: `https://${authkitDomain}/oauth2/token`,
    registration_endpoint: `https://${authkitDomain}/oauth2/register`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
  });
}

export function buildWWWAuthenticateHeader(baseUrl: string): string {
  return [
    'Bearer error="unauthorized"',
    'error_description="Authorization needed"',
    `resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`,
  ].join(', ');
}
