import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeTool, validateArgs, TOOL_DEFINITIONS, getMutationLog } from './registry.js';

const ctx = { sessionId: 's1', turnId: 1, generation: 1, requestId: 'r1' };

test('lookup: headphones product resolves to order VR-48291 (out for delivery)', async () => {
  const r = await executeTool('trackOrder', { productName: 'Sony WH-1000XM5 Headphones', orderId: '' }, ctx, { overrides: { latency: {} } });
  assert.equal(r.ok, true);
  assert.equal((r.data as { orderId: string }).orderId, 'VR-48291');
});

test('lookup: laptop product resolves to order VR-11360 (shipped)', async () => {
  const r = await executeTool('trackOrder', { productName: 'MacBook Pro 14"', orderId: '' }, ctx, { overrides: { latency: {} } });
  assert.equal(r.ok, true);
  assert.equal((r.data as { orderId: string }).orderId, 'VR-11360');
});

test('lookup: order id wins over product args', async () => {
  const r = await executeTool('getOrder', { orderId: 'VR-77108' }, ctx, { overrides: { latency: {} } });
  assert.equal(r.ok, true);
  assert.equal((r.data as { orderId: string }).orderId, 'VR-77108');
});

test('validation: unknown order id returns graceful failure', async () => {
  const r = await executeTool('getOrder', { orderId: 'VR-99999' }, ctx, { overrides: { latency: {} } });
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /not found/i);
});

test('validation: destructive tools reject missing required args', async () => {
  const def = TOOL_DEFINITIONS.find((d) => d.name === 'cancelOrder')!;
  const err = validateArgs(def, {});
  assert.ok(err, 'expected validation error when orderId missing');
});

test('latency override is deterministic (near-zero when short-circuited)', async () => {
  const t0 = Date.now();
  const r = await executeTool('getOrders', {}, ctx, { overrides: { latency: { getOrders: 5 } } });
  assert.equal(r.ok, true);
  assert.ok(Date.now() - t0 < 200, 'latency override should keep the test fast');
});

test('timeout: hung upstream produces graceful timeout error', async () => {
  const t0 = Date.now();
  const r = await executeTool('getOrders', {}, ctx, { overrides: { latency: { getOrders: 60_000 }, timeout: 300 } });
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /timed out/i);
  assert.ok(Date.now() - t0 < 10_000, 'timeout must not hang');
});

test('cancellation mutates state only via destructive tools', async () => {
  const before = getMutationLog().length;
  const r = await executeTool('cancelOrder', { orderId: 'VR-55136' }, ctx, { overrides: { latency: {}, fail: [] } });
  assert.equal(r.ok, true);
  assert.equal((r.data as { status: string }).status, 'CANCELLED');
  assert.equal(getMutationLog().length, before + 1);
});