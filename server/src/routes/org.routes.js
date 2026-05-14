import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { requireEmpresaPortal } from '../middleware/empresaPortal.middleware.js';
import { assertEmpresaAdmin, createCandidateForOrg, listCandidates } from '../services/candidate.service.js';
import { createAssignment, listAssignmentsForOrg } from '../services/assignment.service.js';
import { listDefinitionsForOrg } from '../services/assessmentDefinition.service.js';

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
    const { email, fullName, password } = z
      .object({
        email: z.string().email(),
        fullName: z.string().min(2).max(200),
        password: z.string().min(8).max(200),
      })
      .parse(req.body);
    const { user, candidate } = await createCandidateForOrg({
      organizationId: u.organizationId,
      email,
      fullName,
      password,
      createdByUserId: u.id,
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
    const { candidateId, assessmentDefinitionId } = z
      .object({
        candidateId: z.string().min(1),
        assessmentDefinitionId: z.string().min(1),
      })
      .parse(req.body);
    const assignment = await createAssignment({
      organizationId: u.organizationId,
      candidateId,
      assessmentDefinitionId,
      assignedByUserId: u.id,
    });
    res.status(201).json({ assignment });
  } catch (e) {
    next(e);
  }
});

export default router;
