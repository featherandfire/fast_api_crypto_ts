import { asc, eq } from 'drizzle-orm';

import { db } from './db/client.ts';
import { users } from './db/schema.ts';

export type User = typeof users.$inferSelect;

// DEV_BYPASS: auth disabled for local dev — mirrors app/auth.py::get_current_user.
// Returns the first user in the DB, creating a dev user if the table is empty.
// To re-enable real auth, replace the body with JWT decode + user lookup.
export async function getCurrentUser(): Promise<User> {
  const existing = db
    .select()
    .from(users)
    .orderBy(asc(users.id))
    .limit(1)
    .get();
  if (existing) return existing;

  db.insert(users)
    .values({
      username: 'dev',
      email: 'dev@local',
      hashed_password: '',
      is_verified: true,
    })
    .run();

  return db.select().from(users).where(eq(users.username, 'dev')).get()!;
}
