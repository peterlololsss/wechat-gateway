import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAtList,
  normalizeConversationId,
  normalizeWxidList,
} from './validators.mjs';

test('normalizeConversationId strips supported channel prefixes', () => {
  assert.equal(normalizeConversationId('wxid_plain'), 'wxid_plain');
  assert.equal(normalizeConversationId('ntchat:wxid_plain'), 'wxid_plain');
  assert.equal(normalizeConversationId('wechatferry:123456@chatroom'), '123456@chatroom');
});

test('normalizeConversationId leaves unknown prefixes untouched', () => {
  assert.equal(normalizeConversationId('custom:wxid_plain'), 'custom:wxid_plain');
});

test('normalizeAtList and normalizeWxidList dedupe normalized ids', () => {
  assert.deepEqual(normalizeAtList([' ntchat:wxid_a ', 'wxid_a', '', null]), ['wxid_a']);
  assert.deepEqual(
    normalizeWxidList(['ntchat:wxid_a', 'wechatferry:wxid_b', 'wxid_a']),
    ['wxid_a', 'wxid_b'],
  );
});
