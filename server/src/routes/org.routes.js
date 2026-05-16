import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { requireEmpresaPortal } from '../middleware/empresaPortal.middleware.js';
import { assertEmpresaAdmin, createCandidateForOrg, listCandidates } from '../services/candidate.service.js';
import { createAssignment, listAssignmentsForOrg } from '../services/assignment.service.js';
import { listDefinitionsForOrg } from '../services/assessmentDefinition.service.js';
import {
  listAspenAdminsInOrganization,
  provisionAspenAdminPeer,
  isPioneerAspenAdminEmail,
} from '../services/aspenAdmin.service.js';

const router = Router();

router.use(requireAuth, requireRole('empresa_admin'), requireEmpresaPortal);

router.get('/candidates', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const candidates = await listCandidates(u.organizationId);
    res.json({ candidates });
  } catch (e) {
    next(e);
  }
});

router.post('/candidates', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const { email, fullName, password, curp } = z
      .object({
        email: z.string().email(),
        fullName: z.string().min(2).max(200),
        password: z.string().min(8).max(200),
        curp: z.string().length(18).regex(/^[A-Za-z0-9]+$/).optional().nullable(),
      })
      .parse(req.body);
    const { user, candidate } = await createCandidateForOrg({
      organizationId: u.organizationId,
      email,
      fullName,
      password,
      createdByUserId: u.id,
      curp: curp ?? null,
    });
    res.status(201).json({
      candidate: { id: candidate.id, userId: user.id, email: user.email, fullName: user.fullName },
    });
  } catch (e) {
    next(e);
  }
});

router.get('/assessment-definitions', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const definitions = await listDefinitionsForOrg(u.organizationId);
    res.json({
      definitions: definitions.map((d) => ({
        id: d.id,
        key: d.key,
        name: d.name,
        version: d.version,
      })),
    });
  } catch (e) {
    next(e);
  }
});

router.get('/assignments', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const assignments = await listAssignmentsForOrg(u.organizationId);
    res.json({ assignments });
  } catch (e) {
    next(e);
  }
});

router.post('/assignments', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    const { candidateId, assessmentDefinitionId, selectedModules } = z
      .object({
        candidateId: z.string().min(1),
        assessmentDefinitionId: z.string().min(1),
        selectedModules: z.array(z.string().min(1)).max(32).optional(),
      })
      .parse(req.body);
    const assignment = await createAssignment({
      organizationId: u.organizationId,
      candidateId,
      assessmentDefinitionId,
      assignedByUserId: u.id,
      selectedModules,
    });
    res.status(201).json({ assignment });
  } catch (e) {
    next(e);
  }
});

/** Lista admins Aspen de la org (solo cuenta pionera admin@demo.mind24.com). */
router.get('/aspen-admins', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    if (!isPioneerAspenAdminEmail(u.email)) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'No autorizado.' });
    }
    const administrators = await listAspenAdminsInOrganization(u.organizationId);
    res.json({ administrators });
  } catch (e) {
    next(e);
  }
});

/** Alta de otro admin Aspen + créditos iniciales en su correo (solo cuenta pionera). */
router.post('/aspen-admins', async (req, res, next) => {
  try {
    const u = await assertEmpresaAdmin(req.session.userId);
    if (!isPioneerAspenAdminEmail(u.email)) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'No autorizado.' });
    }
    const { email, fullName, credits } = z
      .object({
        email: z.string().email(),
        fullName: z.string().min(2).max(200),
        credits: z.number().int().min(1).max(1_000_000),
      })
      .parse(req.body);
    const out = await provisionAspenAdminPeer({
      pioneerUserId: u.id,
      email,
      fullName,
      credits,
    });
    res.status(201).json(out);
  } catch (e) {
    next(e);
  }
});

export default router;
