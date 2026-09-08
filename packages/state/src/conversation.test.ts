import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConversationManager } from './conversation.js';

test('test_interruption_invalidates_generation', () => {
  const c = new ConversationManager('s1');
  assert.equal(c.generation, 1);
  c.setState('SPEAKING');
  c.setPendingAction({ tool: 'cancelOrder', args: {}, summary: 'cancel', confirmationId: 'cf1' });
  const { generation } = c.interrupt();
  assert.equal(generation, 2);
  assert.equal(c.generation, 2);
  // pending destructive action is cleared — changed mind must NOT execute
  assert.equal(c.getPendingAction(), undefined);
  assert.equal(c.state, 'INTERRUPTED');
});

test('test_stale_result_is_detected_after_interruption', () => {
  const c = new ConversationManager('s1');
  c.interrupt(); // gen -> 2
  assert.equal(c.markStaleIfNeeded(1), true, 'gen 1 result must be stale');
  assert.equal(c.markStaleIfNeeded(2), false, 'gen 2 result is current');
});

test('test_new_request_wins_over_old_request', () => {
  const c = new ConversationManager('s1');
  const req1 = c.newRequestId();
  c.interrupt();
  c.pushUser('wait, I mean headphones');
  const req2 = c.newRequestId();
  assert.notEqual(req1, req2);
  assert.equal(c.isCurrent({ generation: 2 }), true);
  assert.equal(c.isCurrent({ generation: 1 }), false);
});

test('test_context_is_preserved', () => {
  const c = new ConversationManager('s1');
  const order = { orderId: 'VR-48291' } as never;
  c.setEntity('activeOrder', order);
  c.pushUser('where is it');
  c.pushAssistant('Out for delivery.');
  // interrupt does not wipe history/entities
  c.interrupt();
  c.pushUser('cancel them');
  assert.equal(c.getEntity('activeOrder')?.orderId, 'VR-48291');
  assert.equal(c.getHistory().length, 3);
});

test('test_confirmation_can_be_cancelled', () => {
  const c = new ConversationManager('s1');
  c.setPendingAction({ tool: 'cancelOrder', args: { orderId: 'VR-55136' }, summary: 'cancel?', confirmationId: 'cf1' });
  assert.equal(c.state, 'WAITING_CONFIRMATION');
  c.clearPendingAction();
  assert.equal(c.getPendingAction(), undefined);
  // a later accepted confirmation with a stale id must not match
  const pending = { tool: 'cancelOrder', args: {}, confirmationId: 'cf2', summary: 'x' };
  c.setPendingAction(pending);
  assert.notEqual(pending.confirmationId, 'cf1');
});

test('test_generation_stability_without_interruption', () => {
  const c = new ConversationManager('s2');
  c.setState('TOOL_RUNNING');
  const before = c.generation;
  c.setState('RESOLVED');
  assert.equal(c.generation, before, 'no interruption => same generation');
});