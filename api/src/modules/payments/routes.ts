import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../../http/app';
import { AppError, notFound } from '../../http/errors';
import { requireAuth } from '../../http/middleware/auth';
import { limiter } from '../../http/middleware/rate-limit';
import { validate } from '../../http/middleware/validate';
import { checkKhqrPayment, issueKhqr, paymentView } from './khqr';

const numberParams = z.object({ number: z.string().max(20) });

/** Customer side: watch a payment (checks Bakong, throttled) and ask for a fresh QR. */
export function paymentRouter(deps: AppDeps): Router {
  const { prisma } = deps;
  const r = Router();

  const load = async (number: string, userId: string) => {
    const order = await prisma.order.findFirst({ where: { number, userId }, include: { payment: { include: { khqrCodes: true } } } });
    if (!order?.payment) throw notFound('Order');
    return { order, payment: order.payment };
  };

  r.get('/orders/:number/payment', requireAuth, validate({ params: numberParams }), async (req, res) => {
    const { number } = req.valid.params as { number: string };
    let { payment } = await load(number, req.user!.id);
    if (payment.method === 'KHQR' && payment.status === 'PENDING') {
      const outcome = await checkKhqrPayment(deps, payment.id);
      if (outcome === 'paid') ({ payment } = await load(number, req.user!.id));
    }
    res.set('Cache-Control', 'no-store').json(paymentView(payment));
  });

  r.post('/orders/:number/payment/khqr', requireAuth, limiter(deps, 10, 10 * 60_000, { name: 'khqr' }), validate({ params: numberParams }), async (req, res) => {
    const { number } = req.valid.params as { number: string };
    const { order, payment } = await load(number, req.user!.id);
    if (payment.method !== 'KHQR' || payment.status !== 'PENDING') {
      throw new AppError(409, 'PAYMENT_NOT_PENDING', 'This order is not waiting for a KHQR payment');
    }
    await issueKhqr(deps, prisma, { ...payment, order });
    const { payment: fresh } = await load(number, req.user!.id);
    res.set('Cache-Control', 'no-store').json(paymentView(fresh));
  });

  return r;
}
