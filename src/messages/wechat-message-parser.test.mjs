import assert from 'node:assert/strict';
import test from 'node:test';
import { WechatMessageType } from 'wechatferry';
import { normalizeWechatMessage } from './wechat-message-parser.mjs';

test('quoted group replies use refermsg.chatusr as the quoted sender and auto-mention self', () => {
  const message = {
    type: WechatMessageType.App,
    content: `<?xml version="1.0"?>
<msg>
  <appmsg appid="" sdkver="0">
    <title>teach me like i am two year old</title>
    <type>57</type>
    <refermsg>
      <chatusr>wxid_self</chatusr>
      <type>1</type>
      <displayname>Sterlin Archer</displayname>
      <svrid>8350487493920017198</svrid>
      <fromusr>49953512380@chatroom</fromusr>
      <content>original bot message</content>
    </refermsg>
  </appmsg>
</msg>`,
    xml: '<msgsource></msgsource>',
  };

  const normalized = normalizeWechatMessage(message, { selfWxid: 'wxid_self' });

  assert.equal(normalized.content, 'teach me like i am two year old');
  assert.deepEqual(normalized.atUserList, ['wxid_self']);
  assert.deepEqual(normalized.quotedMessage, {
    type: WechatMessageType.Text,
    message_id: '8350487493920017198',
    from_wxid: 'wxid_self',
    display_name: 'Sterlin Archer',
    content: 'original bot message',
    link_meta: null,
  });
});

test('quoted app replies preserve the reply text and normalize the referenced app share', () => {
  const message = {
    type: WechatMessageType.App,
    content: `<?xml version="1.0"?>
<msg>
  <appmsg appid="" sdkver="0">
    <title>check this</title>
    <type>57</type>
    <refermsg>
      <type>49</type>
      <svrid>1739449349566574535</svrid>
      <fromusr>wxid_sender</fromusr>
      <displayname>spacebar</displayname>
      <content>&lt;msg&gt;&lt;appmsg appid="" sdkver="0"&gt;&lt;title&gt;Article title&lt;/title&gt;&lt;des&gt;Article summary&lt;/des&gt;&lt;type&gt;5&lt;/type&gt;&lt;url&gt;https://mp.weixin.qq.com/s?__biz=test&lt;/url&gt;&lt;sourceusername&gt;gh_test&lt;/sourceusername&gt;&lt;sourcedisplayname&gt;Test Source&lt;/sourcedisplayname&gt;&lt;/appmsg&gt;&lt;/msg&gt;</content>
    </refermsg>
  </appmsg>
</msg>`,
    xml: '<msgsource></msgsource>',
  };

  const normalized = normalizeWechatMessage(message);

  assert.equal(normalized.content, 'check this');
  assert.deepEqual(normalized.atUserList, []);
  assert.deepEqual(normalized.quotedMessage, {
    type: WechatMessageType.App,
    message_id: '1739449349566574535',
    from_wxid: 'wxid_sender',
    display_name: 'spacebar',
    content: 'Article title',
    link_meta: {
      kind: 'mp_article',
      url: 'https://mp.weixin.qq.com/s?__biz=test',
      raw_title: 'Article title',
      raw_desc: 'Article summary',
      raw_sourceusername: 'gh_test',
      raw_sourcedisplayname: 'Test Source',
    },
  });
});
