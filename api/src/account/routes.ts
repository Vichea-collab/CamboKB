import type { Address } from '@prisma/client';
import { updateProfileSchema, type UpdateProfileInput } from '@cambo/shared';
import { Router } from 'express';
import type { AppDeps } from '../app';
import { toPublicUser } from '../auth/sessions';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';

const toAddress = (a: Address | null) =>
  a ? { region: a.region, addressLine: a.addressLine, lat: a.lat, lng: a.lng } : null;

export function accountRouter({ prisma }: AppDeps): Router {
  const r = Router();

  const view = async (userId: string) => {
    const [user, address] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      prisma.address.findFirst({ where: { userId, isDefault: true } }),
    ]);
    return { user: toPublicUser(user), defaultAddress: toAddress(address) };
  };

  r.get('/me', requireAuth, async (req, res) => {
    res.json(await view(req.user!.id));
  });

  r.patch('/me', requireAuth, validate({ body: updateProfileSchema }), async (req, res) => {
    const { name, defaultAddress } = req.valid.body as UpdateProfileInput;
    const userId = req.user!.id;
    await prisma.$transaction(async (tx) => {
      if (name) await tx.user.update({ where: { id: userId }, data: { name } });
      if (defaultAddress === null) await tx.address.deleteMany({ where: { userId, isDefault: true } });
      if (defaultAddress) {
        const data = {
          region: defaultAddress.region,
          addressLine: defaultAddress.addressLine,
          lat: defaultAddress.lat ?? null,
          lng: defaultAddress.lng ?? null,
        };
        const existing = await tx.address.findFirst({ where: { userId, isDefault: true } });
        if (existing) await tx.address.update({ where: { id: existing.id }, data });
        else await tx.address.create({ data: { ...data, userId, isDefault: true } });
      }
    });
    res.json(await view(userId));
  });

  return r;
}
