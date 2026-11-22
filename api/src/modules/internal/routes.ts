import {
  loginConfirmRequestSchema,
  orderButtonRequestSchema,
  telegramUpdateSchema,
  uuidSchema,
} from '@cambo/shared';
import { requireServiceSecret } from '@cambo/service-kit';
import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../../http/app';
import { AppError } from '../../http/errors';
import { validate } from '../../http/middleware/validate';
import { confirmLogin } from '../bot/login-confirm';
import { handleTelegramUpdate } from '../bot/updates';
import { changeOrderStatus } from '../orders/status';

/**
 * What the notification service asks of the api. Mounted at /internal (not under /api/v1), never routed
 * by nginx, and guarded by the shared secret on top of the private network.
 */
export function internalRouter(deps: AppDeps): Router {
  const r = Router();
  r.use(
    requireServiceSecret(
      deps.config.services.internalSecret,
      () => new AppError(401, 'UNAUTHORIZED', 'Missing or invalid service credentials'),
    ),
  );

  // A chat message someone sent the bot. The answer says what to send back.
  r.post(
    '/telegram/updates',
    validate({ body: z.object({ update: telegramUpdateSchema }) }),
    async (req, res) => {
      const { update } = req.valid.body as { update: z.infer<typeof telegramUpdateSchema> };
      res.json({ actions: await handleTelegramUpdate(deps, update) });
    },
  );

  // Someone tapped "Log me in" / "Not me" under a login message. Telegram's id of the person is checked
  // against the Telegram account the request was opened by.
  r.post('/telegram/login-confirm', validate({ body: loginConfirmRequestSchema }), async (req, res) => {
    res.json(await confirmLogin(deps, req.valid.body as z.infer<typeof loginConfirmRequestSchema>));
  });

  // The owner pressed an order button in Telegram. The notification service has already checked the chat;
  // here the order rules apply, and in a group the person must be a linked admin account.
  r.post(
    '/orders/:id/status',
    validate({ params: z.object({ id: uuidSchema }), body: orderButtonRequestSchema }),
    async (req, res) => {
      const { id } = req.valid.params as { id: string };
      const { status, telegramUserId, requireLinkedAdmin } = req.valid.body as z.infer<
        typeof orderButtonRequestSchema
      >;
      const admin = await deps.prisma.user.findFirst({
        where: { telegramUserId: BigInt(telegramUserId), role: 'ADMIN', disabledAt: null },
        select: { id: true },
      });
      if (requireLinkedAdmin && !admin)
        throw new AppError(403, 'FORBIDDEN', 'Only a linked admin can change orders from Telegram');
      const { number } = await changeOrderStatus(
        deps,
        id,
        status,
        admin?.id ?? null,
        'via Telegram',
      );
      res.json({ number, status });
    },
  );

  return r;
}
