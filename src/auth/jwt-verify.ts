import { jwtVerify, createRemoteJWKSet } from 'jose';

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS(authkitDomain: string) {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://${authkitDomain}/oauth2/jwks`));
  }
  return jwks;
}

export interface JwtVerifyResult {
  workosUserId: string;
}

export async function verifyJwt(
  token: string,
  authkitDomain: string
): Promise<JwtVerifyResult | null> {
  try {
    const { payload } = await jwtVerify(token, getJWKS(authkitDomain), {
      issuer: `https://${authkitDomain}`,
    });
    if (!payload.sub) return null;
    return { workosUserId: payload.sub };
  } catch {
    return null;
  }
}
