---
name: wechatferry-native-recovery
description: Use when restoring or validating a WechatFerry capability that depends on the native WeChat desktop integration layer, especially when wrapper return codes are misleading and success must be proven by durable WeChat state. Covers semantic probes, safe DLL staging, WeChatWin traversal, route ledgers, and this repo's bundled revoke compatibility DLL.
---

# WechatFerry Native Recovery

Use this skill when a WechatFerry feature works incorrectly below the HTTP/API layer and needs native-path validation or a pinned compatibility DLL.

This is not for normal gateway endpoints, webhook config, or app-layer bugs. Start there first; use this only after the public wrapper path is proven insufficient.

## Core Rule

Trust semantic outcome, not return codes.

A candidate path succeeds only when WeChat's own durable state matches the intended user-visible action. For revoke, success means the target message becomes a revoke system message (`type=10000`) with `<revokemsg>` content, matching the manual WeChat behavior.

## Workflow

1. **Pin the boundary**
   - Record WeChat desktop version, `wechatferry` package version, SDK root, and staged DLL hash.
   - Preserve 64-bit message identifiers as strings; do not rely on JS number precision.
   - Confirm whether the failure is in HTTP glue, identifier mapping, SDK wrapper, or native behavior.

2. **Define semantic success before probing**
   - Write the exact before/after state expected in WeChat storage or UI.
   - For revoke, capture `local_id`, exact `msgid`, message type, raw content, sender, room, and create time before and after.

3. **Use one named probe per candidate path**
   - Send or select one controlled test message.
   - Execute one candidate strategy.
   - Store the result as JSON with inputs, identifiers, status, and semantic after-state.
   - Avoid repeated blind retries; change one variable at a time.

4. **Classify the path**
   - Semantic owner: writes the intended durable state. Minimize and preserve this path.
   - Maintenance path: refreshes sessions, queues, storage, or UI but does not write the target semantic state. Pivot away.
   - Wrapper/facade path: rebuilds internal objects or hides the real owner. Traverse below it.
   - Preparation path: only keep it if removing it breaks semantic success.
   - Sibling action: same manager family, different action; validate each by after-state.

5. **Trace safely**
   - Make tracing opt-in with an environment flag or temp marker.
   - Guard pointer reads and keep logs append-only.
   - Trace only branch decisions, key arguments, object identity, dispatch codes, and before/after state.

6. **Keep a route ledger**
   - Record dead ends and partial wins with why they failed.
   - A strong false signal is useful if it identifies the subsystem to leave.
   - Do not keep polishing paths that only return success or remove a row locally.

7. **Promote carefully**
   - Stage the minimal DLL/root that produces the semantic result.
   - Keep a rollback path to the package-provided SDK files.
   - Document version pairing, hash, install target, validation command, and failure mode.

## Revoke Case Model

Current confirmed revoke compatibility model for this repo:

```text
PRE_LOCAL_ID_MGR
  -> CHAT_REVOKE_GET_MANAGER
  -> CHAT_REVOKE_MANAGER_B
```

Strategy label: `mgrb_base`.

Known false signals:

- `status=1` without `type=10000` and `<revokemsg>` is not success.
- Local disappearance without a revoke system message is not success.
- Session/storage/list refreshes are downstream maintenance unless they write the revoke state.
- A manager-family action can return success while still being the wrong sibling action.

## Bundled Compatibility DLL

This skill includes the repo's pinned revoke compatibility DLL:

- Asset: `assets/ferry-revoke-fix.dll`
- Role: replacement for WechatFerry SDK `spy.dll`
- Expected SHA256: `31FDE0A32A1B7EF23885D399C288D39E0332166260B91572F09C70DC55875B7E`

Typical pnpm target:

```text
node_modules/.pnpm/@wechatferry+core@0.0.26/node_modules/@wechatferry/core/sdk/v39.4.5/spy.dll
```

Safe staging sequence:

1. Verify the asset hash.
2. Back up the current target `spy.dll`.
3. Copy `assets/ferry-revoke-fix.dll` to the target path.
4. Restart the gateway.
5. Validate revoke with a controlled message and semantic after-state.
6. Roll back by restoring the backup or running `pnpm install --force`.

## Anti-Patterns

- Calling a path successful because it returned `1` or did not throw.
- Treating local deletion as revoke success.
- Mixing multiple candidate changes in one probe.
- Hardcoding version-specific offsets without recording the pinned version.
- Shipping debug/trace DLLs as the default compatibility artifact.
- Committing real wxids, hostnames, IPs, tokens, local user paths, or probe logs.