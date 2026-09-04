# LP Sentinel

本地运行的集中流动性 LP 监控、模拟与价格预警工具。

## MVP 能力

- 通过 Position NFT 查询导入并监控多个 LP；导入时自动带入链上价格、区间、资产和智能预警线。
- 已导入仓位可暂停/恢复监控、删除本地记录，并可在价格航道中直接拖动上下预警线；链上仓位本身不提供通用编辑入口。
- 读取链上池价格，并按集中流动性曲线估算当前两种代币构成。
- 触及预警线时通过 DWS 给当前登录用户发送钉钉私聊。
- 可选追加应用内 DING 或高优先级电话 DING；两者默认关闭，电话 DING 可能产生通信费用。
- 越界只报警一次，价格回到安全区后自动重新布防。
- 数据保存在本机 `data/lp-sentinel.json`。
- 连接浏览器 Binance Wallet，读取 BNB Chain 上由当前地址直接持有的 PancakeSwap V3 Position NFT。
- 支持先链上预执行、再由钱包签名的流动性移除底层能力；界面第一版开放全部移除并同时领取代币。
- 按 Position NFT ID 并行识别 Robinhood Chain / Uniswap V3 与 BNB Chain / PancakeSwap V3，无需连接钱包；同一编号跨链重复时展示全部候选供用户选择。
- 根据 LP tick 宽度自动生成上下预警线，并可一键加入本地持续监控；后续刷新始终使用链上池价格。

> LP Sentinel 不读取、保存私钥或代替用户签名。真实仓位与钱包仓位在界面中明确隔离，任何移除交易都必须由钱包逐笔确认。

## 启动

```bash
npm install
npm run dev
```

- 控制台：http://127.0.0.1:1422
- API：http://127.0.0.1:4317

使用钉钉报警前，请确认：

```bash
dws auth status --format json
```

如果尚未登录，运行 `dws auth login`。追加应用内/电话 DING 还需要在设置中填写开放平台机器人的 Robot Code。

## 验证

```bash
npm test
npm run build
NODE_ENV=production npm start
```

生产模式默认在 http://127.0.0.1:4317 同时提供 API 和构建后的前端页面。可通过环境变量 `LP_SENTINEL_PORT` 修改端口。

## 多网络 LP NFT 查询

页面中的“按 NFT 查询”默认带入示例 NFT `#984513`。系统会并行探测已注册的链与协议，查询返回交易对、持有人、池地址、手续费档位、tick、当前价格、区间、代币构成、仓位估值和建议预警线。NFT ID 不是全局唯一标识；若多个网络存在同编号 NFT，必须按网络、协议和交易对选择后再加入预警。

- Robinhood Chain（chain ID `4663`）/ Uniswap V3；RPC 可通过 `ROBINHOOD_RPC_URL` 覆盖。
- BNB Chain（chain ID `56`）/ PancakeSwap V3；RPC 可通过 `BSC_RPC_URL` 覆盖。
- 统一查询接口：`GET /api/lp-nft/:tokenId`，返回 `matches` 与每个平台的脱敏 `probes`。
- 导入预警：`POST /api/positions/from-lp-nft`，JSON 请求体必须明确来源，例如 `{ "tokenId": "7314935", "sourceId": "bsc-pancake-v3" }`。
- 兼容查询接口：`GET /api/lp/robinhood-uniswap-v3/:tokenId`；新界面不依赖此单链接口。

当前来源标识：

| `sourceId` | 网络 | DeFi 协议 | 查询方式 |
| --- | --- | --- | --- |
| `robinhood-uniswap-v3` | Robinhood Chain | Uniswap V3 | Position Manager + Pool 公开 RPC |
| `bsc-pancake-v3` | BNB Chain | PancakeSwap V3 | Position Manager + Pool 公开 RPC |

统一查询的处理规则：

1. 先校验 NFT ID 为正整数，再并行调用全部已注册来源，避免错误请求进入 RPC。
2. `matches` 保留所有成功命中；NFT ID 跨链重复时不会擅自选择其中一个。
3. `probes` 只返回“已识别 / 未找到 / 暂不可用”等简洁诊断，不把完整 RPC 或合约异常堆栈暴露到界面。
4. 用户选择候选后，以 `tokenId + sourceId` 作为仓位身份加入监控；后续刷新继续使用同一链上适配器。

已验证样本 `#7314935` 应识别为 BNB Chain / PancakeSwap V3 的 `WBNB / SPCXB` 仓位；它在 Robinhood Chain / Uniswap V3 中不存在。样本仅用于验证识别能力，价格、区块和持仓仍以实时链上结果为准。

智能预警依据区间相对宽度，把上下预警线放在边界内侧：窄区间使用 20% 缓冲、常规集中区间使用 12.5%、宽区间使用 8%。推荐参数同时包含 3 次确认、5 分钟采样和 4 小时冷却，当前版本自动应用价格预警线；报警引擎按全局轮询设置采样，并采用“单次触界报警、回到安全区后重新布防”的语义。

## 链上快照实时性

一次仓位刷新会先确定目标区块，再把 NFT、池、代币、tick 与手续费累计值全部固定在该区块读取，避免把不同区块的数据拼成一个快照。当前价格和代币构成使用池的精确 `sqrtPriceX96` 计算。快照同时保存目标区块、读取结束时的链头、区块差、区块时间和本机观测时间。

- **链上实时**：目标区块的实际时间距当前不超过 30 秒。高速出块网络不会再因为读取期间自然前进了较多区块而被误判为延迟。
- **链上延迟**：目标区块距当前超过 30 秒、但尚未超过 10 分钟；区块差作为诊断信息继续展示。
- **数据已过期**：观测时间超过 10 分钟、RPC 读取失败、快照已被服务端标记异常，或采集到的目标区块时间已经落后本机超过 60 秒。区块差会继续原样展示，但不会脱离实际区块时间，用固定块数阈值误判出块速度较快的网络。

过期快照只作为“最后已知值”展示，不写入 APR 历史、不改变报警布防状态、不触发钉钉通知，也不参与 Action 阶段判断。服务启动时会立即刷新一次；默认每 5 秒轮询，修改轮询间隔后新周期立即生效。旧版本未显式配置过的 5 分钟默认值会在首次启动时迁移为 5 秒。

> NFT 查询与加入预警均为只读链上操作。受监控仓位不会被自动移除或重新添加；任何资产操作都必须经过钱包签名、预执行和交易确认流程。

## 真实 PancakeSwap V3 仓位

- 默认优先 RPC：`https://bsc-rpc.publicnode.com`，失败时回退到 `https://bsc-dataseed.binance.org`；可通过 `BSC_RPC_URL` 完全替换。
- 配置 `BSCSCAN_API_KEY` 后可自动枚举钱包持有的 Position NFT；未配置时可在页面输入 Token ID 导入，读取结果仍会通过链上 `ownerOf` 校验。
- 第一版只支持由钱包地址直接持有的 BNB Chain PancakeSwap V3 仓位；已质押到 MasterChef/Farm、V2 LP 和 Infinity 仓位暂不支持。
- 移除流程固定使用 0.5% 滑点保护，20 分钟截止时间，将 `decreaseLiquidity` 与 `collect` 合并为一次钱包交易；不会自动销毁空 NFT。

## 报警语义

- 当前价格 `<= 下限预警`：发送一次下限报警。
- 当前价格 `>= 上限预警`：发送一次上限报警。
- 价格持续位于同一侧：不重复发送。
- 价格回到两条预警线之间：自动重新布防。

普通私聊默认开启。应用内 DING 和电话 DING 是两个独立追加通道，不会替代普通消息；电话通道仅在明确启用后生效。

## 环境变量

复制 `.env.example` 后按需填写；不要提交含凭据的 `.env` 文件。

| 变量 | 说明 |
| --- | --- |
| `ROBINHOOD_RPC_URL` | Robinhood Chain RPC；默认使用限流公共节点 |
| `BSC_RPC_URL` | BNB Chain RPC |
| `BSCSCAN_API_KEY` | 自动枚举钱包 Position NFT，可选 |
| `LP_SENTINEL_PORT` | 生产服务端口，默认 `4317` |
| `LP_SENTINEL_DATA` | 本地 JSON 文件位置，默认 `data/lp-sentinel.json` |

## 安全边界

- 所有监控、查询与导入操作均为只读。
- LP Sentinel 不读取或保存私钥、助记词和浏览器钱包凭据。
- 移除交易只在用户点击后构造，先通过 RPC 预执行，再显示钱包确认。
- 不会后台自动移除、自动 Zap、自动复投、自动签名或销毁 NFT。
- 链上刷新失败时保留并明确标记最后已知快照，不用模拟值冒充实时数据。
