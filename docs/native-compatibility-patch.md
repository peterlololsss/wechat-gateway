# Native Compatibility Patch

`skills/wechatferry-native-recovery/assets/ferry-revoke-fix.dll` is a patched WechatFerry injection DLL for the pinned Windows WeChat / WechatFerry pairing used by this bridge.

It preserves the existing WechatFerry SDK layout while fixing message revoke behavior for this project. Use it as a replacement for the SDK `spy.dll` only when you are running the matching WeChat desktop version and understand how to roll back to the package-provided DLL.

## Artifact

- File: `skills/wechatferry-native-recovery/assets/ferry-revoke-fix.dll`
- Source role: replacement for WechatFerry SDK `spy.dll`
- SHA256: `31FDE0A32A1B7EF23885D399C288D39E0332166260B91572F09C70DC55875B7E`

## Rollback

Restore the original package-provided `spy.dll` from a clean dependency install:

```bash
pnpm install --force
```

Then restart the bridge.
