import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHistoryMessage } from './contract.mjs';

test('normalizeHistoryMessage prefers exact msgSvrIdStr over rounded numeric msgSvrId', () => {
  const message = normalizeHistoryMessage({
    localId: 923,
    msgSvrId: 3381940270338203600,
    msgSvrIdStr: '3381940270338203721',
    type: 1,
    subType: 0,
    isSender: 1,
    createTime: 1773650389,
    strTalker: 'wxid_target',
    strContent: 'hello',
    parsedBytesExtra: {},
  });

  assert.equal(message.local_id, 923);
  assert.equal(message.msgid, '3381940270338203721');
});

test('normalizeHistoryMessage falls back to msgSvrId when exact string is absent', () => {
  const message = normalizeHistoryMessage({
    localId: 924,
    msgSvrId: 1234567890,
    type: 1,
    subType: 0,
    isSender: 1,
    createTime: 1773650390,
    strTalker: 'wxid_target',
    strContent: 'hello',
    parsedBytesExtra: {},
  });

  assert.equal(message.msgid, '1234567890');
});
