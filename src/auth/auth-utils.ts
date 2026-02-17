export async function getUserByWorkosId(
  db: D1Database,
  workosUserId: string
): Promise<{ user_id: string; email: string; is_deleted: number } | null> {
  try {
    const result = await db
      .prepare('SELECT user_id, email, is_deleted FROM users WHERE workos_user_id = ? AND is_deleted = 0')
      .bind(workosUserId)
      .first<{ user_id: string; email: string; is_deleted: number }>();
    return result || null;
  } catch {
    return null;
  }
}
