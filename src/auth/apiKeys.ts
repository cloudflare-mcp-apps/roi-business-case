export interface ApiKeyEnv {
  DB: D1Database;
}

export interface ApiKeyValidationResult {
  userId: string;
  email: string;
}

export async function validateApiKey(
  apiKey: string,
  env: ApiKeyEnv
): Promise<ApiKeyValidationResult | null> {
  if (!apiKey.startsWith('wtyk_') || apiKey.length !== 69) {
    return null;
  }

  const apiKeyHash = await hashApiKey(apiKey);

  const keyRecord = await env.DB.prepare(`
    SELECT api_key_id, user_id, api_key_hash, expires_at, is_active
    FROM api_keys WHERE api_key_hash = ?
  `).bind(apiKeyHash).first<{
    api_key_id: string;
    user_id: string;
    api_key_hash: string;
    expires_at?: number;
    is_active: number;
  }>();

  if (!keyRecord || keyRecord.is_active !== 1) {
    return null;
  }

  if (keyRecord.expires_at && keyRecord.expires_at < Date.now()) {
    return null;
  }

  const user = await env.DB.prepare(`
    SELECT email, is_deleted FROM users WHERE user_id = ?
  `).bind(keyRecord.user_id).first<{ email: string; is_deleted: number }>();

  if (!user || user.is_deleted === 1) {
    return null;
  }

  try {
    await env.DB.prepare(`
      UPDATE api_keys SET last_used_at = ? WHERE api_key_id = ?
    `).bind(Date.now(), keyRecord.api_key_id).run();
  } catch {
    // Non-critical
  }

  return { userId: keyRecord.user_id, email: user.email };
}

async function hashApiKey(apiKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(apiKey);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(byte => byte.toString(16).padStart(2, '0')).join('');
}
