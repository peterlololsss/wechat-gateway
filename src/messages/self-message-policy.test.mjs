import test from 'node:test';
import assert from 'node:assert/strict';
import { WechatMessageType } from 'wechatferry';
import { shouldAllowSelfInboundMessage } from './self-message-policy.mjs';

const recalledText = '\u4f60\u64a4\u56de\u4e86\u4e00\u6761\u6d88\u606f';

test('blocks ordinary self text messages to avoid echo loops', () => {
  assert.equal(shouldAllowSelfInboundMessage(
    {
      is_self: true,
      type: WechatMessageType.Text,
      content: 'hello',
      xml: '',
    },
    {
      msg_type: WechatMessageType.Text,
      data: {
        content: 'hello',
        raw_content: 'hello',
        raw_xml: '',
      },
    },
  ), false);
});

test('allows explicit self recalled messages', () => {
  assert.equal(shouldAllowSelfInboundMessage(
    {
      is_self: true,
      type: WechatMessageType.Recalled,
      content: '',
      xml: '',
    },
    {
      msg_type: WechatMessageType.Recalled,
      data: {
        content: '[a message was recalled]',
        raw_content: '',
        raw_xml: '',
      },
    },
  ), true);
});

test('allows self system messages with revokemsg xml markers', () => {
  const revokeXml = `<?xml version="1.0"?><sysmsg><revokemsg><replacemsg><![CDATA[${recalledText}]]></replacemsg></revokemsg></sysmsg>`;

  assert.equal(shouldAllowSelfInboundMessage(
    {
      is_self: true,
      type: WechatMessageType.Sys,
      content: revokeXml,
      xml: '',
    },
    {
      msg_type: WechatMessageType.Sys,
      data: {
        content: recalledText,
        raw_content: revokeXml,
        raw_xml: '',
      },
    },
  ), true);
});

test('keeps unrelated self system notices filtered', () => {
  assert.equal(shouldAllowSelfInboundMessage(
    {
      is_self: true,
      type: WechatMessageType.SysNotice,
      content: 'patted self',
      xml: '',
    },
    {
      msg_type: WechatMessageType.SysNotice,
      data: {
        content: 'patted self',
        raw_content: 'patted self',
        raw_xml: '',
      },
    },
  ), false);
});

test('never allows non-self messages through the self policy', () => {
  assert.equal(shouldAllowSelfInboundMessage(
    {
      is_self: false,
      type: WechatMessageType.Recalled,
      content: '',
      xml: '',
    },
    {
      msg_type: WechatMessageType.Recalled,
      data: {
        content: '[a message was recalled]',
        raw_content: '',
        raw_xml: '',
      },
    },
  ), false);
});