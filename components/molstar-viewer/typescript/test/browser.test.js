// Adapted from Evo-Platform frontend/tests/protein-viewer/standalone.test.cjs: ESM, MyKit paths, local fixtures.
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { exportProteinViewer } from '../export-assets.mjs';
import { serveStatic } from '../serve.mjs';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

test('example page opens ?structure= from its own directory and refuses other paths', { timeout: 60000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mykit-preset-viewer-'));
  await exportProteinViewer(directory, dirname(createRequire(import.meta.url).resolve('molstar/package.json')));
  await copyFile(join(fixtures, '1UBQ.pdb'), join(directory, '1UBQ.pdb'));
  const server = serveStatic(directory);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage();
    await page.goto(`${origin}/protein-viewer-example.html?structure=1UBQ.pdb`);
    await expect(page.locator('#status')).toContainText('660 个原子');
    const requests = [];
    page.on('request', req => requests.push(req.url()));
    await page.goto(`${origin}/protein-viewer-example.html?structure=${encodeURIComponent('https://example.com/x.pdb')}`);
    await expect(page.locator('#status')).toContainText('打开本地结构文件');
    assert.ok(requests.every(url => url.startsWith(origin)), requests.join('\n'));
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test('portable viewer works from a nested static directory without a host app', { timeout: 120000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'mykit-portable-viewer-'));
  await exportProteinViewer(join(directory, 'portable'), dirname(createRequire(import.meta.url).resolve('molstar/package.json')));
  const server = serveStatic(directory);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    const external = [], errors = [], warnings = [];
    page.on('request', req => { if (!req.url().startsWith(origin)) external.push(req.url()); });
    page.on('pageerror', error => errors.push(error.message));
    // The viewer is offline under a strict policy; start-up must not trip it or ask for VR/AR.
    page.on('console', message => { if (/Content Security Policy|xr-spatial-tracking|sourceMappingURL/i.test(message.text())) warnings.push(message.text()); });
    await page.addInitScript(() => {
      window.__violations = [];
      document.addEventListener('securitypolicyviolation', event => window.__violations.push(`${event.violatedDirective} ${event.blockedURI}`));
    });
    await page.goto(`${origin}/portable/protein-viewer-example.html`);
    await page.getByLabel('打开本地 PDB 或 CIF').setInputFiles(join(fixtures, '1UBQ.pdb'));
    await expect(page.locator('#status')).toContainText('660 个原子');
    const frame = page.frames().find(frame => frame.url().endsWith('/protein-viewer.html'));
    assert.equal(await frame.evaluate(() => { try { return !!parent.document; } catch { return false; } }), false);
    assert.deepEqual(await frame.evaluate('window.__violations'), []);
    assert.equal(await frame.evaluate('navigator.xr'), undefined);
    const vendored = await readFile(join(directory, 'portable/vendor/molstar/molstar.js'), 'utf8');
    assert.equal(/sourceMappingURL/.test(vendored.slice(-400)), false);
    await t.test('3D picking selects without a second focus representation or camera jump', async () => {
      const result = await frame.evaluate(async () => {
        const before = plugin.state.data.cells.size;
        const camera = plugin.canvas3d.camera.getSnapshot();
        plugin.behaviors.interaction.click.next({ current: { loci: lociFor({ chain: 'A', residue: '10' }) }, button: 1, modifiers: { alt: false, shift: false, control: false, meta: false } });
        await new Promise(resolve => setTimeout(resolve, 650));
        await queue;
        return { selection: sceneState().selection, before, after: plugin.state.data.cells.size, camera, afterCamera: plugin.canvas3d.camera.getSnapshot() };
      });
      assert.deepEqual(result.selection, { kind: 'residue', chain: 'A', residue: '10', atoms: 4 });
      assert.equal(result.after, result.before, 'picking must not create hidden focus geometry');
      assert.deepEqual(result.afterCamera, result.camera, 'pick only; focus is an explicit action');
    });
    await t.test('pointer release without a camera change does not invalidate scene revisions', async () => {
      const revisions = await frame.evaluate(async () => {
        const before = sceneRevision;
        window.dispatchEvent(new PointerEvent('pointerup'));
        await new Promise(resolve => setTimeout(resolve, 650));
        await queue;
        return [before, sceneRevision];
      });
      assert.equal(revisions[0], revisions[1]);
    });
    await t.test('editing layer color and opacity reuses its component and mesh', async () => {
      const result = await frame.evaluate(async () => {
        const op = { id: 'layer', op: 'representation.upsert', layer_id: 'regression', selection: { kind: 'range', chain: 'A', start: '10', end: '20' }, mode: 'surface', palette: 'uniform', color: '#cc8844', opacity: 1 };
        await executeSceneOperation(op);
        const layer = sceneLayers.get('regression');
        const before = { component: layer.component.ref, rep: layer.rep.ref, geometry: layer.rep.obj.data.repr.geometryVersion };
        let created = 0, removed = 0;
        const subscriptions = [plugin.state.data.events.object.created.subscribe(() => created++), plugin.state.data.events.object.removed.subscribe(() => removed++)];
        for (let i = 0; i < 4; i++) await executeSceneOperation({ ...op, color: i % 2 ? '#aabbcc' : '#ccbbaa', opacity: i % 2 ? 0.4 : 0.8 });
        const updated = sceneLayers.get('regression');
        const after = { component: updated.component.ref, rep: updated.rep.ref, geometry: updated.rep.obj.data.repr.geometryVersion };
        subscriptions.forEach(s => s.unsubscribe());
        await removeSceneLayer('regression');
        return { before, after, created, removed };
      });
      assert.deepEqual(result.before, result.after);
      assert.equal(result.created, 0);
      assert.equal(result.removed, 0);
    });
    await frame.evaluate(() => execute({ type: 'select', chain: '', residue: null }));
    await page.locator('#residue').fill('A:25');
    await page.getByRole('button', { name: '定位', exact: true }).click();
    await expect(page.locator('#status')).toContainText('选中 A:25');
    await page.getByRole('button', { name: '表面', exact: true }).click();
    await expect(page.locator('#status')).toContainText('surface');
    const updateResult = await frame.evaluate(async () => {
      const before = styledRepresentations.map(rep => ({ ref: rep.ref, geometry: rep.obj.data.repr.geometryVersion }));
      let created = 0, removed = 0;
      const createdSub = plugin.state.data.events.object.created.subscribe(() => created++);
      const removedSub = plugin.state.data.events.object.removed.subscribe(() => removed++);
      for (let i = 0; i < 6; i++) await execute({ type: 'theme', background: i % 2 ? 0xf7f7f8 : 0x151515, dark: i % 2 === 0 });
      for (let i = 0; i < 6; i++) await execute({ type: 'style', mode: 'surface', palette: 'uniform', chain: 'A', residue: '25' });
      const after = styledRepresentations.map(rep => ({ ref: rep.ref, geometry: rep.obj.data.repr.geometryVersion }));
      createdSub.unsubscribe(); removedSub.unsubscribe();
      return { before, after, created, removed, atoms: styledComponents.reduce((n, c) => n + c.obj.data.elementCount, 0), polymerAtoms: polymer.obj.data.elementCount };
    });
    assert.deepEqual(updateResult.before, updateResult.after, 'theme and repeated style preserve references AND mesh geometry');
    assert.equal(updateResult.created, 0);
    assert.equal(updateResult.removed, 0);
    assert.equal(updateResult.atoms, updateResult.polymerAtoms);
    const queueResult = await frame.evaluate(async () => {
      const original = execute, calls = [];
      execute = async command => { calls.push(command.type + ':' + (command.residue ?? '')); return original(command); };
      try {
        for (let i = 1; i <= 76; i++) schedule({ type: 'select', chain: 'A', residue: String(i) });
        schedule({ type: 'reset' });
        for (const mode of ['cartoon', 'stick', 'surface']) schedule({ type: 'style', mode, palette: 'uniform', chain: 'A', residue: '25' });
        schedule({ type: 'style', mode: 'stick', palette: 'uniform', chain: 'A', residue: '30' });
        await new Promise(resolve => setTimeout(resolve, 0));
        await queue;
        return { calls, selected: selectedRequest.residue, local25: localStyles.get('A:25').mode, local30: localStyles.get('A:30').mode };
      } finally { execute = original; }
    });
    assert.deepEqual(queueResult.calls, ['select:76', 'reset:', 'style:25', 'style:30']);
    assert.deepEqual([queueResult.selected, queueResult.local25, queueResult.local30], ['76', 'surface', 'stick']);
    await page.getByRole('button', { name: '取消选择' }).click();
    await expect(page.locator('#status')).toContainText('未选择');
    await page.getByRole('button', { name: '棍状', exact: true }).click();
    await expect.poll(() => frame.evaluate('baseStyle.mode + ":" + localStyles.size')).toBe('stick:0');
    await page.getByRole('button', { name: '切换主题' }).click();
    await expect.poll(() => frame.evaluate('dark')).toBe(true);
    const beforeSpoof = await page.locator('#status').textContent();
    await page.evaluate(() => window.postMessage({ channel: 'evo-protein', type: 'error', message: 'spoofed' }, '*'));
    await page.waitForTimeout(50);
    assert.equal(await page.locator('#status').textContent(), beforeSpoof);
    await page.getByRole('button', { name: '卡通', exact: true }).click();
    await expect.poll(() => frame.evaluate('baseStyle.mode')).toBe('cartoon');
    await page.locator('#pin').click();
    await page.locator('#agent').click();
    await page.locator('#agent63').click();
    await expect(page.locator('#pending > div')).toHaveCount(2);
    assert.equal(await frame.evaluate('selectedRequest'), null);
    await page.locator('#pending').getByRole('button', { name: '应用', exact: true }).first().click();
    await expect(page.locator('#receipt')).toContainText('applied');
    await expect(page.locator('#pending > div')).toHaveCount(1);
    await expect(page.locator('#pin')).toHaveAttribute('aria-pressed', 'true');
    assert.deepEqual(await frame.evaluate("[selectedRequest.residue, localStyles.get('A:48').mode, baseStyle.mode]"), ['48', 'stick', 'cartoon']);
    await page.locator('#pin').click();
    await expect.poll(() => frame.evaluate('selectedRequest.residue')).toBe('63');
    await expect(page.locator('#pending > div')).toHaveCount(0);
    const receipts = await page.evaluate(async () => {
      const { sendViewerCommand, subscribeViewer } = await import('./protein-viewer-client.js');
      const frame = document.querySelector('iframe');
      async function request(command) {
        return new Promise(resolve => {
          const off = subscribeViewer(frame, event => { if (event.type === 'receipt' && event.id === command.id) { off(); resolve(event); } });
          sendViewerCommand(frame, command);
        });
      }
      const base = { type: 'view', assetId: 'local', assetVersion: '1', chain: 'A', mode: 'stick', palette: 'uniform', focus: true };
      const absent = await request({ ...base, id: 'missing', residue: '999' });
      const stale = await request({ ...base, id: 'stale', residue: '48', assetVersion: 'old' });
      const valid = { ...base, id: 'dedup', residue: '48' };
      const first = await request(valid), duplicate = await request(valid);
      const conflict = await request({ ...valid, residue: '63' });
      return { absent, stale, first, duplicate, conflict };
    });
    assert.equal(receipts.absent.status, 'not-found');
    assert.equal(receipts.stale.status, 'failed');
    assert.equal(receipts.first.status, 'applied');
    assert.equal(receipts.first.state.residue, '48');
    assert.ok(receipts.first.state.atoms > 0);
    assert.deepEqual(receipts.first, receipts.duplicate);
    assert.equal(receipts.conflict.status, 'failed');
    assert.equal(await frame.evaluate('selectedRequest.residue'), '48');
    const scene = await page.evaluate(async () => {
      const { sendViewerCommand, subscribeViewer } = await import('./protein-viewer-client.js');
      const frame = document.querySelector('iframe');
      async function request(command) {
        return new Promise(resolve => {
          const off = subscribeViewer(frame, event => { if (event.type === 'scene-receipt' && event.id === command.id) { off(); resolve(event); } });
          sendViewerCommand(frame, command);
        });
      }
      const before = await request({ type: 'get-state', id: 'before-scene', assetId: 'local', assetVersion: '1' });
      const batch = {
        type: 'scene', id: 'scene-1', assetId: 'local', assetVersion: '1', expectedRevision: before.state.revision, onError: 'stop',
        operations: [
          { id: 'hide-default', op: 'visibility.set', layer_id: 'builtin', visible: false },
          { id: 'range-layer', op: 'representation.upsert', layer_id: 'range', selection: { kind: 'range', chain: 'A', start: '20', end: '30' }, mode: 'surface', palette: 'uniform', color: '#d946ef', opacity: 0.4 },
          { id: 'select-25', op: 'selection.set', selection: { kind: 'residue', chain: 'A', residue: '25' }, focus: true },
          { id: 'distance', op: 'measurement.add', layer_id: 'distance-25-30', kind: 'distance', points: [{ kind: 'atom', chain: 'A', residue: '25', atom: 'CA' }, { kind: 'atom', chain: 'A', residue: '30', atom: 'CA' }] },
          { id: 'zoom', op: 'camera.zoom', factor: 1.25 },
        ],
      };
      const first = await request(batch);
      const duplicate = await request(batch);
      const state = await request({ type: 'get-state', id: 'scene-state', assetId: 'local', assetVersion: '1' });
      const conflict = await request({ ...batch, id: 'scene-conflict', expectedRevision: 0 });
      // A view read before the zoom goes back exactly; a malformed one is refused.
      const back = await request({ type: 'scene', id: 'camera-back', assetId: 'local', assetVersion: '1', onError: 'stop', operations: [{ id: 'back', op: 'camera.set', camera: before.state.camera }] });
      const bad = await request({ type: 'scene', id: 'camera-bad', assetId: 'local', assetVersion: '1', onError: 'stop', operations: [{ id: 'bad', op: 'camera.set', camera: { position: [0, 0], target: [0, 0, 0], up: [0, 1, 0], radius: 1 } }] });
      return { first, duplicate, state, conflict, before, back, bad };
    });
    assert.equal(scene.back.status, 'success', JSON.stringify(scene.back));
    scene.back.state.camera.position.forEach((value, index) => { assert.ok(Math.abs(value - scene.before.state.camera.position[index]) < 1e-3); });
    assert.notEqual(scene.bad.status, 'success');
    assert.equal(scene.first.status, 'success', JSON.stringify(scene.first));
    assert.equal(scene.first.state.revision, scene.before.state.revision + 1);
    assert.equal(scene.first.state.builtin_visible, false);
    assert.equal(scene.first.state.representations[0].layer_id, 'range');
    assert.equal(scene.first.state.representations[0].color, '#d946ef');
    assert.equal(scene.first.state.selection.residue, '25');
    assert.equal(scene.first.state.measurements[0].kind, 'distance');
    assert.deepEqual(scene.first, scene.duplicate);
    assert.equal(scene.state.state.revision, scene.before.state.revision + 1);
    assert.equal(scene.conflict.status, 'conflict');
    assert.equal(scene.conflict.state.revision, scene.before.state.revision + 1);
    await page.getByRole('button', { name: '取消选择' }).click();
    await expect.poll(() => frame.evaluate('selection')).toBe(null);
    assert.equal(await frame.evaluate("localStyles.has('A:48')"), true);
    await frame.evaluate(() => execute({ type: 'clear-local-styles' }));
    assert.equal(await frame.evaluate('localStyles.size'), 0);
    const molecular = await frame.evaluate(async ({ cif, sdf }) => {
      await execute({ type: 'scene', id: 'audit-distance', assetId: 'local', assetVersion: '1', expectedRevision: sceneRevision, onError: 'stop', operations: [{ id: 'distance', op: 'measurement.add', layer_id: 'audit', kind: 'distance', points: [{ kind: 'atom', chain: 'A', residue: '10', atom: 'CA' }, { kind: 'atom', chain: 'A', residue: '20', atom: 'CA' }] }] });
      await execute({ type: 'select', chain: 'A', residue: '10' });
      await execute({ type: 'style', chain: 'A', residue: '10', mode: 'surface', palette: 'uniform' });
      const saved = sceneState();
      await execute({ type: 'select', chain: 'A', residue: '20' });
      await execute({ type: 'restore-state', id: 'restore-audit', expectedRevision: sceneRevision, state: saved });
      const restored = sceneState();
      await execute({ type: 'load', append: true, content: cif, format: 'cif', assetId: 'crambin', assetVersion: '1', background: 0x242424, dark: true });
      await execute({ type: 'load', append: true, content: sdf, format: 'sdf', assetId: 'ethanol', assetVersion: '1', background: 0x242424, dark: true });
      const molecule = sceneState();
      await execute({ type: 'asset-activate', assetId: 'local' });
      const activeBefore = styledRepresentations.map(rep => plugin.state.data.cells.get(rep.ref).state.isHidden);
      await execute({ type: 'asset-visibility', assetId: 'crambin', visible: false });
      const crambinHidden = loadedAssets.get('crambin').styledRepresentations.every(rep => plugin.state.data.cells.get(rep.ref).state.isHidden);
      const activePreserved = JSON.stringify(activeBefore) === JSON.stringify(styledRepresentations.map(rep => plugin.state.data.cells.get(rep.ref).state.isHidden));
      await execute({ type: 'asset-visibility', assetId: 'crambin', visible: true });
      const beforeFailure = sceneState();
      let invalidRejected = false;
      try { await execute({ type: 'load', append: true, content: 'data_empty\n#\n', format: 'cif', assetId: 'invalid', assetVersion: '1' }); } catch { invalidRejected = true; }
      return { saved, restored, molecule, switched: sceneState(), beforeFailure, invalidRejected, crambinHidden, activePreserved };

    }, { cif: await readFile(join(fixtures, '1CRN.cif'), 'utf8'), sdf: await readFile(join(fixtures, 'ethanol.sdf'), 'utf8') });
    assert.ok(Math.abs(molecular.saved.measurements.find(m => m.layer_id === 'audit').value - 27.686069150386807) < 0.00001);
    assert.equal(molecular.restored.selection.residue, '10');
    assert.equal(molecular.restored.selection.atoms, 4);
    assert.equal(molecular.restored.local_styles.find(s => s.residue === '10').mode, 'surface');
    assert.equal(molecular.molecule.atoms, 9);
    assert.equal(molecular.molecule.assets.length, 3);
    assert.equal(molecular.crambinHidden, true);
    assert.equal(molecular.activePreserved, true);
    assert.equal(molecular.invalidRejected, true);
    assert.equal(molecular.switched.asset_id, molecular.beforeFailure.asset_id);
    assert.equal(molecular.switched.assets.length, 3);
    assert.equal(molecular.switched.selection.residue, '10');
    assert.equal(molecular.switched.measurements.find(m => m.layer_id === 'audit').unit, 'Å');
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    assert.deepEqual(await frame.evaluate('window.__violations'), []);
    assert.deepEqual(warnings, []);
    console.log(JSON.stringify({ portable: true, themeGeometryPreserved: true, themeObjectsCreated: updateResult.created, coalescedSelections: 76, selectionExecutions: 1, externalRequests: external.length }));
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
