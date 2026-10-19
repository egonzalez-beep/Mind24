import { Router } from 'express';
import { z } from 'zod';
import { assertEmpresaAdmin } from '../services/candidate.service.js';
import {
  countUnreadOrgNotifications,
  listOrgNotificationsForUser,
  markAllOrgNotificationsRead,
  markOrgNotificationRead,
} from '../services/orgNotification.service.js';

const router = Router();

router.get('/notifications', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(30).optional(),
        cursor: z.string().optional(),
      })
      .parse(req.query);
    const out = await listOrgNotificationsForUser({
      organizationId: u.organizationId,
      userId: u.id,
      limit: q.limit,
      cursor: q.cursor,
    });
    res.json(out);
  } catch (e) {
    next(e);
  }
});

router.get('/notifications/unread-count', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const unreadCount = await countUnreadOrgNotifications(u.organizationId, u.id);
    res.json({ unreadCount });
  } catch (e) {
    next(e);
  }
});

router.post('/notifications/:id/read', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    await markOrgNotificationRead(u.organizationId, u.id, req.params.id);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.post('/notifications/read-all', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const out = await markAllOrgNotificationsRead(u.organizationId, u.id);
    res.json(out);
  } catch (e) {
    next(e);
  }
});

export default router;
