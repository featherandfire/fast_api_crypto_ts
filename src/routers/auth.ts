import type { FastifyInstance } from 'fastify';

import { getCurrentUser } from '../auth.ts';

export async function authRouter(app: FastifyInstance) {
  app.get('/api/auth/me', async () => {
    const user = await getCurrentUser();
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      created_at: user.created_at,
      is_verified: user.is_verified,
    };
  });
}
