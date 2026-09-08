import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConversationManager } from '@vaaniresolve/state';
import { decideDeterministic, parseDecisionText } from './agent.js';

function rt(c: ConversationManager) {
  return { conversation: c };
}

test('deterministic: "where is my laptop?" → track laptop (VR-11360 via productName)', () => {
  const c = new ConversationManager('a');
  const d = decideDeterministic(rt(c), 'Where is my laptop?', false);
  assert.equal(d.tool, 'trackOrder');
  assert.equal(d.args['productName'], 'MacBook Pro 14"');
});

test('deterministic: "my blue headphones" → track headphones order, never stale entity', () => {
  const c = new ConversationManager('a');
  // seed a WRONG active order (the laptop) — the explicit product mention must win
  c.setEntity('activeOrder', { orderId: 'VR-11360' } as never);
  const d = decideDeterministic(rt(c), 'Wait, I mean my blue headphones.', false);
  assert.equal(d.tool, 'trackOrder');
  assert.equal(d.args['productName'], 'Sony WH-1000XM5 Headphones');
});

test('deterministic: destructive action requires confirmation', () => {
  const c = new ConversationManager('a');
  const d = decideDeterministic(rt(c), 'Cancel my laptop order.', false);
  assert.equal(d.needsConfirmation, true);
  assert.equal(d.tool, 'cancelOrder');
  assert.match(d.confirmSummary ?? '', /cancelled/i);
});

test('deterministic: changed mind cancels the pending action', () => {
  const c = new ConversationManager('a');
  c.setPendingAction({ tool: 'cancelOrder', args: { orderId: 'VR-11360' }, confirmationId: 'cf1', summary: 'cancel?' });
  const d = decideDeterministic(rt(c), "Actually don't cancel them.", false);
  assert.equal(d.intent, 'cancel');
  assert.equal(c.getPendingAction(), undefined);
});

test('deterministic: explicit VR order id parsed', () => {
  const c = new ConversationManager('a');
  const d = decideDeterministic(rt(c), 'Where is order VR-77108?', false);
  assert.ok(String(d.args['orderId']).includes('VR-77108'));
});

test('parseDecisionText tolerates markdown-wrapped JSON', () => {
  const d = parseDecisionText('```json\n{"tool":"getOrder","args":{"orderId":"VR-1"},"intent":"x","speech":"ok"}\n```');
  assert.equal(d.tool, 'getOrder');
  assert.equal(d.args['orderId'], 'VR-1');
});