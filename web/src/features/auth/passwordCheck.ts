import { passwordSchema } from '@cambo/shared';
import { t } from '../../shared/lib/strings';

/** Same rules as the server; returns a message or null. */
export function passwordProblem(pw: string): string | null {
  const r = passwordSchema.safeParse(pw);
  if (r.success) return null;
  return pw.length < 8 ? t.auth.passwordShort : t.auth.passwordCommon;
}
