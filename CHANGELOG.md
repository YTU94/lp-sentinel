# 更新日志

本文件记录 LP Sentinel 的用户可见变更。版本号遵循语义化版本。

## [0.3.0] - 2026-09-04

### 变更

- 钉钉通知统一使用本地 DWS CLI OAuth 登录态，不再读取 AppKey、AppSecret 或云端监控口令。
- 设置页支持刷新 DWS 登录状态并发送普通私聊测试消息。
- 应用内 DING 与电话 DING 改用当前 DWS 用户身份发送，不再要求 Robot Code。
- Vercel 版本明确关闭钉钉通知；链上查询、IndexedDB 仓位和页面内刷新不受影响。

### 安全

- LP Sentinel 只执行 DWS 命令，不读取、保存或返回 OAuth Token。
- 旧版保存的 Robot Code 在状态迁移时自动移除。

## [0.2.0] - 2026-09-04

### 新增

- 用户添加的基础 LP 数据改为保存在当前浏览器 IndexedDB。
- Vercel 版本支持通过钉钉 OpenAPI 发送机器人私聊预警。
- 设置页支持发送云端钉钉通道测试消息。
- 应用内显示当前版本，并可直接查看更新日志。

### 修复

- 链上快照按目标区块读取，并依据区块时间判断实时、延迟与过期。
- Vercel 刷新在单次请求中恢复仓位，避免不同 Function 实例丢失监控数据。
- 通知发送失败后自动重新布防，下一轮刷新继续尝试。

### 安全

- 钉钉凭据只从服务端环境变量读取，不进入前端构建产物。
- 云端刷新与测试消息接口增加独立监控口令保护。

## [0.1.0] - 2026-09-04

### 新增

- 支持 Robinhood Chain / Uniswap V3 与 BNB Chain / PancakeSwap V3 Position NFT 查询。
- 支持集中流动性仓位估值、智能预警线、手续费 APR 与链上快照。
- 支持本地 DWS 钉钉私聊、应用内 DING 和电话 DING。
- 支持 Binance Wallet 连接与 PancakeSwap V3 全部流动性移除预执行。
