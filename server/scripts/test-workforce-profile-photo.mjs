/**
 * Fotos de perfil — colaboradores Gestión de equipo.
 * node server/scripts/test-workforce-profile-photo.mjs
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(rootDir, '.env') });

if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'workforce-photo-test-secret';
}
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://127.0.0.1:5432/mind24_timeclock_test';
}

const schema = fs.readFileSync(path.join(rootDir, 'prisma/schema.prisma'), 'utf8');
const orgRoutes = fs.readFileSync(path.join(rootDir, 'src/routes/timeclock.org.routes.js'), 'utf8');
const publicRoutes = fs.readFileSync(path.join(rootDir, 'src/routes/timeclock.public.routes.js'), 'utf8');
const uploadPaths = fs.readFileSync(path.join(rootDir, 'src/utils/uploadPaths.js'), 'utf8');
const evalRoutes = fs.readFileSync(path.join(rootDir, 'src/routes/evaluations.routes.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(rootDir, '..', 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(rootDir, 'src/app.js'), 'utf8');

const {
  isAllowedWorkforceAvatarFile,
  assertSafeWorkforceProfilePhotoPath,
  sniffWorkforceAvatarExt,
  WORKFORCE_AVATAR_MAX_BYTES,
  WORKFORCE_AVATAR_SUBDIR,
} = await import('../src/services/workforceAvatar.service.js');
const { resolveAudiosDirAbs, resolveWorkforceAvatarsDirAbs, resolveUploadsRootAbs } = await import(
  '../src/utils/uploadPaths.js'
);
const { prisma } = await import('../src/db/client.js');
const { createApp } = await import('../src/app.js');
const { hashPassword } = await import('../src/services/auth.service.js');

let failed = 0;
function check(cond, msg) {
  if (!cond) {
    console.error(`  FAIL  ${msg}`);
    failed += 1;
  } else {
    console.log(`  OK  ${msg}`);
  }
}

function parseSetCookie(res) {
  const raw = res.headers.getSetCookie?.() || [];
  if (raw.length) return raw;
  const single = res.headers.get('set-cookie');
  return single ? [single] : [];
}

function cookieHeaderFromResponse(res, name) {
  for (const line of parseSetCookie(res)) {
    const part = line.split(';')[0];
    if (part.startsWith(`${name}=`)) return part;
  }
  return '';
}

console.log('\n=== Profile photo — estático ===\n');

check(/profilePhotoPath/.test(schema), 'campo profilePhotoPath en Prisma');
check(!/Bytes|base64|Blob/.test(schema.match(/model WorkforceEmployee[\s\S]*?^}/m)?.[0] || ''), 'sin blob en WorkforceEmployee');
check(/resolveWorkforceAvatarsDirAbs/.test(uploadPaths), 'subdir workforce-avatars en uploadPaths');
check(/workforce-avatars/.test(appJs), 'mkdir workforce-avatars al arranque');
check(/\/uploads\/audios/.test(appJs) && !/\/uploads',\s*\n\s*express\.static\(uploadsRootAbs/.test(appJs), 'static solo audios, no avatars públicos');
check(/resolveAudiosDirAbs/.test(evalRoutes), 'audios sin cambios en evaluations');
check(/router\.get\('\/employees\/:id\/photo'/.test(orgRoutes), 'GET photo autenticado');
check(/router\.post\('\/employees\/:id\/photo'/.test(orgRoutes), 'POST photo multipart');
check(/router\.delete\('\/employees\/:id\/photo'/.test(orgRoutes), 'DELETE photo');
check(/WORKFORCE_AVATAR_MAX_BYTES/.test(orgRoutes), 'límite 3MB en ruta');
check(/tcEmpAvatarCellHtml/.test(indexHtml) && /tc-emp-avatar--initials/.test(indexHtml), 'avatar directorio + iniciales');
check(/tc-emp-edit-backdrop/.test(indexHtml) && /Quitar foto/.test(indexHtml), 'modal editar foto');
check(/tcEmpPhotoUrl/.test(indexHtml) && /\?v=/.test(indexHtml), 'cache bust updatedAt');
check(/router\.get\('\/photo'/.test(publicRoutes) && /requireTimeclockSession/.test(publicRoutes), 'GET photo público con sesión checador');
check(/streamWorkforceProfilePhoto/.test(publicRoutes) && !/\/employees\/:id\/photo/.test(publicRoutes), 'photo público sin id en URL');
check(/hasProfilePhoto/.test(publicRoutes) && /profilePhotoVersion/.test(publicRoutes), '/me metadata foto sin path');
const meReturnBody =
  publicRoutes.match(/function sessionToPublicMe[\s\S]*?return \{([\s\S]*?)\};\n\}/)?.[1] || '';
check(!/profilePhotoPath/.test(meReturnBody), '/me no expone profilePhotoPath');
check(/tcEmpPublicPhotoUrl/.test(indexHtml) && /\/api\/timeclock\/public\/photo/.test(indexHtml), 'avatar checador vía API pública');
check(/tc-emp-portal-avatar/.test(indexHtml) && /tc-emp-greet-row/.test(indexHtml), 'avatar portal junto al saludo');

console.log('\n=== Profile photo — unit ===\n');

check(isAllowedWorkforceAvatarFile('image/png', 'x.png'), 'PNG permitido');
check(isAllowedWorkforceAvatarFile('image/jpeg', 'x.jpg'), 'JPEG permitido');
check(!isAllowedWorkforceAvatarFile('application/pdf', 'x.pdf'), 'PDF rechazado');
check(WORKFORCE_AVATAR_MAX_BYTES === 3 * 1024 * 1024, 'límite 3MB');

const png1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
check(sniffWorkforceAvatarExt(png1x1) === '.png', 'magic bytes PNG');
check(sniffWorkforceAvatarExt(Buffer.from('%PDF-1.4 fake', 'utf8')) == null, 'magic bytes rechaza no-imagen');
check(/sniffWorkforceAvatarExt/.test(fs.readFileSync(path.join(rootDir, 'src/services/workforceAvatar.service.js'), 'utf8')), 'servicio usa sniff en save');
check(/unlink\(abs\)/.test(fs.readFileSync(path.join(rootDir, 'src/services/workforceAvatar.service.js'), 'utf8')), 'rollback archivo si falla BD');

const orgId = 'org_test_1';
const safe = assertSafeWorkforceProfilePhotoPath(`${WORKFORCE_AVATAR_SUBDIR}/${orgId}/abc.jpg`, orgId);
check(safe.includes(orgId), 'ruta segura org');
try {
  assertSafeWorkforceProfilePhotoPath(`${WORKFORCE_AVATAR_SUBDIR}/other_org/x.jpg`, orgId);
  check(false, 'rechaza path otra org');
} catch {
  check(true, 'rechaza path otra org');
}

const root = resolveUploadsRootAbs();
const avDir = resolveWorkforceAvatarsDirAbs();
const audDir = resolveAudiosDirAbs();
check(avDir.startsWith(root) && avDir.includes('workforce-avatars'), 'avatars bajo mismo uploads root');
check(audDir.startsWith(root) && audDir.includes('audios'), 'audios bajo mismo uploads root');

console.log('\n=== Profile photo — integration (DB) ===\n');

let dbOk = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbOk = true;
} catch (e) {
  console.log('  SKIP integration:', e.message);
}

if (dbOk) {
  const suffix = crypto.randomBytes(4).toString('hex');
  const orgA = await prisma.organization.create({
    data: { name: `Photo A ${suffix}`, empresaPortalEnabled: true, credits: 0 },
  });
  const orgB = await prisma.organization.create({
    data: { name: `Photo B ${suffix}`, empresaPortalEnabled: true, credits: 0 },
  });
  const adminPass = 'TestAdmin1!';
  const adminA = await prisma.user.create({
    data: {
      email: `photo-admin-${suffix}@example.com`,
      passwordHash: await hashPassword(adminPass),
      fullName: 'Admin Photo',
      role: 'empresa_admin',
      organizationId: orgA.id,
    },
  });
  const empA = await prisma.workforceEmployee.create({
    data: {
      organizationId: orgA.id,
      fullName: 'Colab Foto',
      timezone: 'America/Mexico_City',
      accessTokenHash: crypto.randomBytes(32).toString('hex'),
      isActive: true,
      tokenVersion: 1,
    },
  });
  const empB = await prisma.workforceEmployee.create({
    data: {
      organizationId: orgB.id,
      fullName: 'Otra Org',
      timezone: 'America/Mexico_City',
      accessTokenHash: crypto.randomBytes(32).toString('hex'),
      isActive: true,
      tokenVersion: 1,
    },
  });

  const app = createApp();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminA.email, password: adminPass }),
    });
    const cookie = cookieHeaderFromResponse(login, 'mind24.sid');
    check(login.ok && cookie, 'admin login');

    const png1x1 = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    check(sniffWorkforceAvatarExt(png1x1) === '.png', 'integración usa PNG real');
    const fd = new FormData();
    fd.append('photo', new Blob([png1x1], { type: 'image/png' }), 'avatar.png');

    const up = await fetch(`${base}/api/org/timeclock/employees/${empA.id}/photo`, {
      method: 'POST',
      headers: { Cookie: cookie },
      body: fd,
    });
    const upJson = await up.json();
    check(up.status === 200 && upJson.employee?.profilePhotoPath, 'upload PNG');

    const getPhoto = await fetch(`${base}/api/org/timeclock/employees/${empA.id}/photo`, {
      headers: { Cookie: cookie },
    });
    check(getPhoto.status === 200 && getPhoto.headers.get('content-type')?.includes('image'), 'GET photo bytes');

    const foreign = await fetch(`${base}/api/org/timeclock/employees/${empB.id}/photo`, {
      headers: { Cookie: cookie },
    });
    check(foreign.status === 404, 'aislamiento multi-org GET');

    const badFd = new FormData();
    badFd.append('photo', new Blob(['not-image'], { type: 'application/pdf' }), 'x.pdf');
    const badUp = await fetch(`${base}/api/org/timeclock/employees/${empA.id}/photo`, {
      method: 'POST',
      headers: { Cookie: cookie },
      body: badFd,
    });
    check(badUp.status === 400, 'MIME inválido rechazado');

    const del = await fetch(`${base}/api/org/timeclock/employees/${empA.id}/photo`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    const delBody = await del.json();
    check(del.status === 200 && delBody.employee?.profilePhotoPath == null, 'quitar foto');

    const after = await fetch(`${base}/api/org/timeclock/employees/${empA.id}/photo`, {
      headers: { Cookie: cookie },
    });
    check(after.status === 404, 'GET 404 tras quitar');
  } finally {
    server.close();
    const paths = (
      await prisma.workforceEmployee.findMany({
        where: { organizationId: { in: [orgA.id, orgB.id] } },
        select: { profilePhotoPath: true },
      })
    )
      .map((e) => e.profilePhotoPath)
      .filter(Boolean);
    for (const rel of paths) {
      try {
        const abs = path.join(resolveUploadsRootAbs(), rel.replace(/\\/g, '/'));
        await fs.promises.unlink(abs);
      } catch (_) {}
    }
    await prisma.workforceEmployee.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await prisma.user.deleteMany({ where: { organizationId: orgA.id } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  }
}

console.log(failed === 0 ? '\n✓ Workforce profile photo tests OK.\n' : `\n✗ ${failed} fallo(s).\n`);
process.exit(failed === 0 ? 0 : 1);
