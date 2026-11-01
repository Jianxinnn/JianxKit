import assert from 'node:assert/strict';
import test from 'node:test';
import { createProteinWorkspace, isViewOperation } from '../protein-workspace.js';

const command = (id, residue = '48') => ({ type: 'view', id, assetId: '1UBQ', assetVersion: 'v1', chain: 'A', residue, mode: 'stick', palette: 'uniform', focus: true });
const applied = op => ({ type: 'receipt', id: op.id, assetId: op.assetId, assetVersion: op.assetVersion, status: 'applied', state: { chain: op.chain, residue: op.residue, mode: op.mode, palette: op.palette, atoms: 9 } });

test('pin holds every suggestion; applying one keeps the pin; dismissal resolves the caller', async () => {
  const sent = [], core = createProteinWorkspace({ send: value => sent.push(value) });
  try {
    core.setPinned(true);
    const first = core.request(command('first')), second = core.request(command('second', '63'));
    assert.equal(sent.length, 0);
    assert.equal(core.getSnapshot().pending.length, 2);
    core.applyPending('first');
    assert.equal(core.getSnapshot().pinned, true);
    assert.equal(sent.length, 1);
    core.receive(applied(sent[0]));
    assert.equal((await first).status, 'applied');
    assert.equal(sent.length, 1);
    core.dismiss('second');
    assert.equal((await second).status, 'cancelled');
  } finally { core.dispose(); }
});

test('only matching command ID, asset version, target and actual representation confirm an operation', async () => {
  const sent = [], core = createProteinWorkspace({ send: value => sent.push(value) });
  try {
    const first = core.request(command('one')), second = core.request(command('two', '63'));
    for (const bad of [ { id: 'old' }, { assetId: 'other' }, { assetVersion: 'v0' }, { state: { ...applied(sent[0]).state, residue: '63' } }, { state: { ...applied(sent[0]).state, mode: 'surface' } }, { state: { ...applied(sent[0]).state, atoms: 0 } } ]) core.receive({ ...applied(sent[0]), ...bad });
    assert.equal(core.getSnapshot().confirmed, null);
    assert.equal(sent.length, 1);
    core.receive(applied(sent[0]));
    assert.equal((await first).state.residue, '48');
    assert.equal(sent.length, 2);
    core.receive(applied(sent[0])); // late duplicate cannot finish the next request
    assert.equal(core.getSnapshot().active.id, 'two');
    core.receive(applied(sent[1]));
    assert.equal((await second).state.residue, '63');
  } finally { core.dispose(); }
});

test('duplicates are idempotent, conflicting IDs fail, missing targets do not replace confirmed state', async () => {
  const sent = [], core = createProteinWorkspace({ send: value => sent.push(value) });
  try {
    const first = core.request(command('one'));
    assert.equal(core.request(command('one')), first);
    const { id, ...rest } = command('one');
    assert.equal(core.request({ ...rest, id }), first);
    assert.throws(() => core.request(command('one', '63')), /already belongs/);
    core.receive(applied(sent[0])); await first;
    const next = core.request(command('missing', '999'));
    core.receive({ ...applied(sent[1]), status: 'not-found', state: undefined });
    assert.equal((await next).status, 'not-found');
    assert.equal(core.getSnapshot().confirmed.id, 'one');
  } finally { core.dispose(); }
});

test('timeout freezes further dispatch and ignores a late success', async () => {
  const sent = [], core = createProteinWorkspace({ send: value => sent.push(value), timeoutMs: 10 });
  try {
    const first = core.request(command('timeout'));
    const next = core.request(command('next'));
    assert.equal((await first).status, 'failed');
    assert.equal(core.getSnapshot().pinned, true);
    assert.equal(sent.length, 1);
    core.receive(applied(sent[0]));
    assert.equal(core.getSnapshot().confirmed, null);
    core.dispose();
    assert.equal((await next).status, 'cancelled');
  } finally { core.dispose(); }
});

test('scope disposal resolves active and pending callers and rejects further operations', async () => {
  const core = createProteinWorkspace({ send() {} });
  const active = core.request(command('active')), pending = core.request(command('pending'));
  core.dispose();
  assert.equal((await active).status, 'cancelled');
  assert.equal((await pending).status, 'cancelled');
  assert.throws(() => core.request(command('late')), /disposed/);
});

test('branch reset cancels previous work without applying a late receipt into the next branch', async () => {
  const sent = [], core = createProteinWorkspace({ send: value => sent.push(value) });
  try {
    const previous = core.request(command('previous')), queued = core.request(command('queued'));
    core.clear();
    assert.equal((await previous).status, 'cancelled');
    assert.equal((await queued).status, 'cancelled');
    const next = core.request(command('next'));
    core.receive(applied(sent[0]));
    assert.equal(core.getSnapshot().confirmed, null);
    core.setPinned(false);
    core.receive(applied(sent[1]));
    assert.equal((await next).status, 'applied');
  } finally { core.dispose(); }
});

test('author residue numbers accept insertion codes and negative numbers, never sequence indices implicitly', () => {
  assert.equal(isViewOperation(command('insert', '48A')), true);
  assert.equal(isViewOperation(command('negative', '-1')), true);
  for (const residue of [48, '1.2', '<script>']) assert.equal(isViewOperation(command('invalid', residue)), false);
  assert.equal(isViewOperation({ ...command('invalid'), residue: undefined }), false);
  assert.equal(isViewOperation({ ...command('x'), assetVersion: '' }), false);
});
