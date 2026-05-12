import test from 'node:test';
import assert from 'node:assert/strict';
import { findMatchingSelfHistoryMessage, hasReadyMessageId } from './self-message-matcher.mjs';

test('findMatchingSelfHistoryMessage returns the newest matching self message after baseline', () => {
  const history = [
    {
      local_id: 12,
      msgid: 'newest',
      is_self: true,
      timestamp: 1710000010,
      chat_wxid: 'wxid_target',
      type: 1,
      content: 'hello',
      raw_content: 'hello',
      media: null,
    },
    {
      local_id: 11,
      msgid: 'wrong-content',
      is_self: true,
      timestamp: 1710000009,
      chat_wxid: 'wxid_target',
      type: 1,
      content: 'different',
      raw_content: 'different',
      media: null,
    },
    {
      local_id: 10,
      msgid: 'baseline',
      is_self: true,
      timestamp: 1710000008,
      chat_wxid: 'wxid_target',
      type: 1,
      content: 'hello',
      raw_content: 'hello',
      media: null,
    },
  ];

  const match = findMatchingSelfHistoryMessage(history, {
    afterLocalId: 10,
    minTimestamp: 1710000009,
    expectedChatWxid: 'wxid_target',
    expectedType: 1,
    expectedContent: 'hello',
  });

  assert.equal(match?.msgid, 'newest');
});

test('findMatchingSelfHistoryMessage matches media messages by kind without content', () => {
  const history = [
    {
      local_id: 21,
      msgid: 'file-msg',
      is_self: true,
      timestamp: 1710000100,
      chat_wxid: 'wxid_target',
      type: 2004,
      content: '[received a file]',
      raw_content: '',
      media: {
        kind: 'file',
      },
    },
    {
      local_id: 20,
      msgid: 'image-msg',
      is_self: true,
      timestamp: 1710000099,
      chat_wxid: 'wxid_target',
      type: 3,
      content: '[received an image]',
      raw_content: '',
      media: {
        kind: 'image',
      },
    },
  ];

  const match = findMatchingSelfHistoryMessage(history, {
    afterLocalId: 19,
    expectedChatWxid: 'wxid_target',
    expectedType: 2004,
    expectedMediaKind: 'file',
  });

  assert.equal(match?.msgid, 'file-msg');
});

test('findMatchingSelfHistoryMessage ignores non-self and stale messages', () => {
  const history = [
    {
      local_id: 31,
      msgid: 'other-user',
      is_self: false,
      timestamp: 1710000200,
      chat_wxid: 'wxid_target',
      type: 1,
      content: 'hello',
      raw_content: 'hello',
      media: null,
    },
    {
      local_id: 30,
      msgid: 'too-old',
      is_self: true,
      timestamp: 1710000100,
      chat_wxid: 'wxid_target',
      type: 1,
      content: 'hello',
      raw_content: 'hello',
      media: null,
    },
  ];

  const match = findMatchingSelfHistoryMessage(history, {
    afterLocalId: 30,
    minTimestamp: 1710000150,
    expectedChatWxid: 'wxid_target',
    expectedType: 1,
    expectedContent: 'hello',
  });

  assert.equal(match, null);
});

test('findMatchingSelfHistoryMessage can return a local record before msgid is ready', () => {
  const history = [
    {
      local_id: 41,
      msgid: '',
      is_self: true,
      timestamp: 1710000300,
      chat_wxid: 'wxid_target',
      type: 1,
      content: 'pending',
      raw_content: 'pending',
      media: null,
    },
  ];

  const match = findMatchingSelfHistoryMessage(history, {
    afterLocalId: 40,
    expectedChatWxid: 'wxid_target',
    expectedType: 1,
    expectedContent: 'pending',
    requireMessageId: false,
  });

  assert.equal(match?.local_id, 41);
  assert.equal(match?.msgid, '');
});

test('findMatchingSelfHistoryMessage treats msgid "0" as not ready', () => {
  const history = [
    {
      local_id: 51,
      msgid: '0',
      is_self: true,
      timestamp: 1710000400,
      chat_wxid: 'wxid_target',
      type: 1,
      content: 'pending',
      raw_content: 'pending',
      media: null,
    },
    {
      local_id: 50,
      msgid: '888',
      is_self: true,
      timestamp: 1710000399,
      chat_wxid: 'wxid_target',
      type: 1,
      content: 'older',
      raw_content: 'older',
      media: null,
    },
  ];

  const requireReady = findMatchingSelfHistoryMessage(history, {
    afterLocalId: 49,
    expectedChatWxid: 'wxid_target',
    expectedType: 1,
    expectedContent: 'pending',
  });
  const allowPending = findMatchingSelfHistoryMessage(history, {
    afterLocalId: 49,
    expectedChatWxid: 'wxid_target',
    expectedType: 1,
    expectedContent: 'pending',
    requireMessageId: false,
  });

  assert.equal(requireReady, null);
  assert.equal(allowPending?.local_id, 51);
});

test('hasReadyMessageId rejects empty and zero placeholders', () => {
  assert.equal(hasReadyMessageId(''), false);
  assert.equal(hasReadyMessageId('0'), false);
  assert.equal(hasReadyMessageId('123'), true);
});
