# LP Sentinel 项目执行手册（AGENTS.md）

本文件是 `lp-sentinel` 的项目级协作契约。后续 Agent 在修改代码、补充能力或排查问题前，应先阅读本文件，并以当前代码为准；如果文档与实现不一致，应先修正文档或明确说明差异。

## 1. 项目定位

LP Sentinel 是一个本地优先的集中流动性（LP）监控与预警工具。统一 NFT 查询首批覆盖 Robinhood Chain / Uniswap V3 与 BNB Chain / PancakeSwap V3，并保留 BNB Chain 钱包仓位与钱包确认交易能力。它负责读取链上仓位、计算持仓与手续费指标、判断价格是否接近/越过区间，并通过通知和钱包确认辅助用户处理流动性。

当前产品原则：

- 以 NFT 查询结果作为新增监控仓位的唯一入口。
- 链上数据优先；链上快照不可用时不得伪装成实时数据或模拟价值。
- 预警和 Action 状态机是策略预览与决策辅助，不会在后台自动签名或自动发起交易。
- 钱包交易必须经过预检，并由用户在钱包中明确确认。
- 用户添加的基础 LP 数据以浏览器 IndexedDB 为唯一持久化来源；服务端 JSON 只保存设置、通知状态和迁移前的兼容数据，不引入云端账户体系。

## 2. 技术框架

| 层次 | 当前实现 | 责任 |
| --- | --- | --- |
| 前端运行时 | React + TypeScript + Vite | 单页应用、仓位详情、预警设置、钱包交互 |
| UI 图标 | `lucide-react` | 图标与轻量交互视觉 |
| 链交互 | `viem` | RPC 读取、合约调用、交易参数与链上格式化 |
| 后端运行时 | Node.js + Express + TypeScript | REST API、监控轮询、静态资源服务 |
| 外部行情 | Binance 公共现货接口 | 仅用于没有链上 `source` 的历史模拟仓位 |
| 数据持久化 | 浏览器 IndexedDB + `server/store.ts` | IndexedDB 保存基础 LP；JSON 保存服务端设置与通知状态 |
| 测试 | Vitest + Supertest + jsdom | 领域单测、API 测试、React/浏览器行为测试 |
| 开发编排 | `concurrently` + `tsx watch` | 前后端并行开发 |

关键脚本：

```bash
npm run dev       # API 4317 + Vite 1422
npm run build     # tsc -b && vite build
npm start         # 生产模式启动 server/index.ts
npm test          # Vitest 一次性测试
npm run test:watch
```

开发访问地址：前端 `http://127.0.0.1:1422/`，后端 `http://127.0.0.1:4317`。Vite 开发代理把 `/api` 请求转发到后端。

## 3. 能力地图

### 3.1 NFT 查询、导入与管理

- 统一 NFT 查询：`GET /api/lp-nft/:tokenId`，通过 `server/services/lp-nft-registry.ts` 并行探测已注册来源。
- 首批来源为 `robinhood-uniswap-v3` 与 `bsc-pancake-v3`；增加网络或协议时必须新增适配器并注册，不得在路由或 UI 中堆叠特判。
- NFT 导入监控：`POST /api/positions/from-lp-nft`，请求体为 `{ tokenId, sourceId }`。
- NFT ID 只在单个 Position Manager 内唯一。同编号可在不同网络/协议同时存在，统一查询必须保留全部命中，UI 必须显式展示网络、协议、交易对后让用户选择。
- 查询结果可选择“采用智能值并加入预警”，把链上实时仓位转换为持久化 Position。
- 顶部“添加 LP”入口和通用 `POST /api/positions` 已移除；不要恢复为第二套新增入口。
- 已导入仓位只支持删除、暂停/恢复监控，以及通过专用接口调整上下预警线；不提供 LP 编辑按钮、编辑表单或通用字段更新接口。
- 当前示例/验证 NFT 包括 Robinhood 的 `#984513`、`#994992`，以及 BNB Chain 的 `#7314935`；实际数据以 RPC 返回为准，不要把示例价格、区块或资产数量写死。

#### NFT 来源适配器契约

`server/services/lp-nft-registry.ts` 是统一发现入口。每个来源适配器必须提供：

- 稳定且唯一的 `sourceId`。
- 用户可读的 `networkName` 和 `protocol`。
- `read(tokenId)` 只读方法，并返回 `server/domain/live-lp.ts` 定义的完整 `LiveLpPosition`。
- 可识别的“不存在”错误；注册表负责把底层 `ownerOf` revert、RPC 错误等转换为简洁 `probe`，不得把完整调用参数或潜在 RPC 凭据发给前端。

增加新网络或 DeFi 协议时，需要同步完成：

1. 扩展 `LpSourceId`、网络、chain ID 和协议类型。
2. 实现 Position Manager、Pool 与 Token 的只读适配器，并注册到 `lpNftAdapters`。
3. 保证价格方向、decimals、tick spacing、手续费累计和仓位估值映射正确。
4. 更新 `LivePositionSource`、导入映射、监控刷新、前端共享类型和区块浏览器链接。
5. 增加唯一命中、全部未命中、RPC 暂不可用、同 ID 多重命中及持续监控测试。
6. 更新 README 的来源表与限制说明，并用一个公开 NFT 做只读验证；不得把钱包签名或交易广播混入查询流程。

### 3.2 Robinhood Chain 链上读取

- 默认链 ID：`4663`。
- 默认 RPC：`https://rpc.mainnet.chain.robinhood.com`，可用 `ROBINHOOD_RPC_URL` 覆盖。
- 默认客户端会合并同一轮并发 JSON-RPC 读取并对可重试错误退避重试，避免 5 秒轮询在公共节点上形成请求尖峰；不要移除该保护。
- 读取 Position Manager、Pool、Token 合约，解析 owner、pool、token 地址、symbol、decimals、fee tier、tick spacing、tick 上下界、liquidity、当前 tick/价格、amount0/amount1、应计手续费、区块号和更新时间。
- `server/services/robinhood-v3.ts` 负责链上读取和 Uniswap V3 fee-growth 计算；`s erver/domain/live-lp-import.ts` 负责映射为应用模型。
- 详情页的“链上持仓”卡片必须展示真实 principal、未领取手续费、总价值（quote）以及 block/time 快照。
- 链上读取失败时应展示错误/过期状态；不得用“模拟持有”“模拟价值”替代真实链上字段。

### 3.3 BNB Chain / PancakeSwap V3 钱包能力

- 前端钱包连接和 BNB Chain 仓位展示位于 `src/wallet/pancake-v3.ts`。
- 后端读取接口：`GET /api/wallet/:address/pancake-v3`。
- 支持直接持有的 PancakeSwap V3 Position NFT；可选通过 `BSCSCAN_API_KEY` 做 token ID 发现。
- BSC 默认优先使用 `https://bsc-rpc.publicnode.com`，失败时回退到 Binance 公共节点；可通过 `BSC_RPC_URL` 完全替换。
- 移除流动性位于 `src/wallet/removal.ts`：构造 `decreaseLiquidity` 与 collect 交易、执行预检并请求钱包签名。
- 当前实现是双币领取/收取路径，不等同于 Zap 单币退出；没有自动销毁空 NFT。任何 Zap、单币重建或自动复投都必须新增明确的合约路由、滑点、报价和用户确认设计。

### 3.4 集中流动性与持仓计算

- `server/domain/lp-math.ts`：根据 sqrt price、tick、区间和 liquidity 计算集中流动性头寸的 token 数量与价值。
- `server/domain/position.ts`：Position 的创建、字段校验和领域约束。
- `server/domain/wallet-position.ts`：token ID 规范化、钱包仓位映射和最小金额计算。
- `src/token-selection.ts`：代币候选、搜索和格式化。
- `src/price-freshness.ts`：行情时间新鲜度和过期状态判断。

### 3.5 一小时手续费 APR

- `server/domain/fee-apr.ts` 根据连续链上快照计算过去一小时手续费 APR。
- 快照历史字段包括 `blockNumber`、`updatedAt`、`currentPrice`、`principalValueQuote`、`feeAmount0`、`feeAmount1`。
- 计算规则：使用未领取手续费增量；负增量视为领取动作并忽略；token0 手续费按当前价格换算 quote；以时间加权平均本金年化到 365 天。
- `feeApr1h` 字段包含 `annualizedPercent`、`feesEarnedQuote`、`windowSeconds`、`sampleCount`、`fullWindow`。
- 采样不足 1 分钟时 UI 显示“采样中”；不足 1 小时时显示覆盖分钟数；达到一小时后显示完整窗口 APR。
- 监控重启时会用上一份快照补种基线，避免把重启造成的突变误算成收益。

### 3.6 预警引擎与智能阈值

- `server/domain/smart-alerts.ts` 根据 LP 区间宽度和 tick 结构推荐预警阈值与设置。
- `server/domain/alert-engine.ts` 判断下边界/上边界触达，并维护每一侧一次告警、回到安全区后重新布防的行为。
- 具有已注册 `source.type` 的 NFT 仓位始终通过对应链上适配器刷新；仅历史模拟仓位使用 Binance 价格。
- 全局预警设置包括轮询间隔、通知开关、DING 机器人配置等，走 `PATCH /api/settings`；单仓位上下阈值走 `PATCH /api/positions/:id/alerts`。
- 预警本身不会直接移除或重建 LP；它只触发通知和 Action 状态变化。

### 3.7 Action 状态机

`src/action-state-machine.tsx` 将原 5 步压缩为 4 步，并用编号卡片、连接线和颜色突出当前阶段：

1. `safe` / SAFE / 持续观察：价格在安全航道内。
2. `warning` / WARNING / 进入预警：触达预警线或需要重新布防。
3. `execute` / EXECUTE / 选择并确认：合并原“Action Ready”和“Execute”，比较继续持有、双币移除、Zap 重建等策略，然后等待钱包确认。
4. `cooldown` / COOLDOWN / 防止反复重建：交易后冷却，避免短时间重复操作。

`deriveActionStage` 的约束：无价格时回到 safe；价格越过 LP 区间时进入 execute；在区间内但越过预警线或尚未布防时进入 warning。状态机是展示层/策略层，不是交易执行器。

### 3.8 通知

- `server/services/dws-auth.ts` 读取 DWS 身份。
- `server/services/dws-notifier.ts` 构造并发送通知命令。
- 常规私信通知始终可用；应用内 DING 由 `dingEnabled` 控制，电话 DING 由 `dingCallEnabled` 控制，两者共享 `dingRobotCode` 且默认关闭。
- 当前不支持短信通知。电话 DING 已作为可选高优先级通道接入，但默认关闭，依赖有效的 `dingRobotCode`、DWS 登录态及对应开放平台权限；不得把“可发送电话 DING”描述成后台自动执行 LP 交易。

### 3.9 本地状态与静态应用

- `src/indexeddb-position-store.ts` 保存 NFT 来源、Token ID、启停、预警线、布防状态和创建时间，不保存链上快照或历史采样。
- `server/store.ts` 的 `JsonStore` 负责服务端内存状态、设置与通知状态；IndexedDB 模式下不会继续把仓位写入 JSON。
- 默认数据文件为 `data/lp-sentinel.json`；升级时其中的旧仓位只作为一次性迁移源，浏览器确认 IndexedDB 写入成功后才清空 `positions`。
- `GET /api/state` 返回当前仓位、设置、通知配置和服务器时间。
- `PUT /api/positions/sync` 用经过校验的 IndexedDB 基础记录恢复服务端运行时仓位；链上字段由对应适配器重新读取，不信任客户端提交的 owner、代币或价格。
- `server/http/static-app.ts` 在生产模式下提供前端静态资源与 SPA fallback。

## 4. 分层架构与代码地图

```text
src/
├── App.tsx                 # 主壳、侧栏、详情、设置、NFT 查询、钱包入口
├── api.ts                  # 前端 REST 客户端；不得重新加入通用 createPosition
├── action-state-machine.tsx# 4 阶段 Action 展示与阶段推导
├── price-freshness.ts      # 行情新鲜度
├── indexeddb-position-store.ts # 浏览器基础 LP 持久化
├── token-selection.ts      # token 搜索/选择
├── types.ts                # 前端共享模型
├── styles.css              # 浅色主题、响应式布局、状态颜色
└── wallet/
    ├── pancake-v3.ts       # BNB 钱包连接和 Pancake V3 仓位
    └── removal.ts          # 移除流动性交易构造/预检/签名

server/
├── index.ts                # Express 应用与全部 API 路由
├── monitor.ts              # 轮询、刷新快照、APR、告警、通知
├── store.ts                # 服务端内存状态、设置 JSON 与旧仓位迁移
├── http/static-app.ts      # 静态资源与 SPA fallback
├── domain/
│   ├── position.ts         # Position 校验与创建
│   ├── live-lp.ts          # 跨网络实时 LP 统一模型与来源 ID
│   ├── live-lp-import.ts   # 链上 LP 映射为持仓/快照
│   ├── lp-math.ts          # V3 集中流动性数学
│   ├── fee-apr.ts          # 1h APR 计算
│   ├── smart-alerts.ts     # 智能预警推荐
│   ├── alert-engine.ts     # 告警触发/重置
│   └── wallet-position.ts  # 钱包 token ID 与金额处理
└── services/
    ├── robinhood-v3.ts     # Robinhood V3 链上读取
    ├── pancake-v3.ts       # Pancake V3 NFT/钱包链上读取
    ├── lp-nft-registry.ts  # 多网络、多协议 NFT 适配器注册与并行识别
    ├── binance-price.ts    # Binance 行情
    ├── binance-symbol-search.ts
    ├── dws-auth.ts
    └── dws-notifier.ts

tests/                      # 领域、API、监控、链上导入、Action 和 UI 测试
```

依赖方向应保持为：

```text
App/UI → api、wallet、token-selection、price-freshness、action-state-machine
monitor → domain、store
services → domain（仅做适配/读取，不把 UI 逻辑下沉到服务层）
```

领域函数应尽量保持纯函数；RPC、钱包签名、通知、文件 I/O 等副作用应留在 services、monitor 或 wallet 边界。

## 5. 主要数据流

### NFT 导入与监控

```text
用户输入 NFT ID
  → GET /api/lp-nft/:tokenId
  → lp-nft-registry 并行调用已注册链/协议适配器
  → 唯一命中直接展示；多重命中按网络/协议/交易对选择
  → robinhood-v3 或 pancake-v3 读取 Position Manager/Pool/Token
  → live-lp-import 生成 Position + OnchainPositionSnapshot
  → POST /api/positions/from-lp-nft { tokenId, sourceId }
  → 浏览器 IndexedDB 持久化基础 LP
  → PUT /api/positions/sync 恢复服务端运行时仓位
  → monitor 轮询刷新链上快照、APR 和 alert
  → GET /api/state
  → App 详情页展示
```

### 预警与通知

```text
monitor 取得当前价格
  → alert-engine.evaluateAlert
  → 更新 per-position alert 状态
  → dws-notifier 私信（可选应用内 DING / 电话 DING）
  → UI 通过 state 刷新 Action stage
```

### 钱包移除

```text
连接钱包
  → 读取 Pancake V3 NFT
  → 计算最小可接受金额与 deadline
  → preflight
  → 用户钱包签名 decreaseLiquidity / collect
  → 刷新钱包仓位
```

## 6. API 契约

当前路由清单：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/state` | 读取应用状态 |
| GET | `/api/tokens/search` | 搜索代币 |
| GET | `/api/wallet/:address/pancake-v3` | 读取 BNB 钱包 V3 仓位 |
| GET | `/api/lp-nft/:tokenId` | 并行识别并返回所有已支持来源的 NFT 仓位 |
| GET | `/api/lp/robinhood-uniswap-v3/:tokenId` | 查询 Robinhood NFT 实时链上数据 |
| POST | `/api/positions/from-lp-nft` | 按 `{ tokenId, sourceId }` 新增指定来源监控仓位 |
| PUT | `/api/positions/sync` | 用浏览器 IndexedDB 基础记录恢复运行时仓位 |
| PATCH | `/api/positions/:id/enabled` | 仅通过 `{ enabled: boolean }` 暂停/恢复现有仓位 |
| DELETE | `/api/positions/:id` | 删除现有监控仓位 |
| PATCH | `/api/settings` | 更新监控、预警、通知设置 |
| POST | `/api/refresh` | 手动触发刷新 |

删除或改变路由前，必须同步更新 `src/api.ts`、前端调用、API 测试和 README；不得为了兼容旧 UI 私自恢复通用新增仓位 API 或 LP 字段编辑能力。

## 7. 配置、权限与安全边界

常用环境变量：

- `ROBINHOOD_RPC_URL`：Robinhood Chain RPC。
- `BSC_RPC_URL`：BNB Chain RPC。
- `BSCSCAN_API_KEY`：可选的 BscScan token ID 发现。
- DWS 认证/通知相关环境变量：由 `dws-auth.ts` 和 `dws-notifier.ts` 实际读取为准。

安全要求：

- 不在日志、测试输出、截图、提交或错误信息中打印私钥、助记词、access token、refresh token、cookie 或完整 RPC 密钥。
- RPC 读取、行情查询、链上快照默认是只读；任何交易必须显式由用户操作触发。
- 不在测试中连接真实钱包或广播真实交易；移除流动性测试只验证交易参数、预检和失败分支。
- 外部接口返回内容进入 UI 前应校验、格式化并标记更新时间/过期状态。
- `data/lp-sentinel.json` 可能含设置、通知状态或尚未迁移的旧仓位，不要把它当作固定 fixture，也不要手改生产运行数据。

## 8. 修改规则

1. 先用 codebase-memory MCP 的 `search_graph`、`trace_path`、`get_code_snippet`、`query_graph` 或 `search_code` 理解调用关系；只有搜索字面量、配置、脚本或图谱不足时才使用 `rg`/文件读取。
2. 行为变化遵循测试驱动：先补失败测试，再实现，再运行相关测试和完整测试。
3. 新增链上字段时，同时更新领域模型、服务映射、API 响应、前端类型、UI、历史快照和测试。
4. 新增预警字段时，明确触发、重置、冷却、通知去重和过期数据行为；不能只改颜色或文案。
5. 新增钱包交易时，必须提供金额下限、deadline、滑点/报价来源、preflight、用户确认和失败恢复路径。
6. UI 调整需保持浅色主题、响应式布局和明显的当前选中状态；桌面和约 390px 移动宽度都要检查。
7. 不修改无关功能，不删除用户已有本地数据，不提交密钥或临时文件。
8. 默认不提交 Git。只有用户明确要求提交且提供 Aone ID 时，才使用中文 Conventional Commits：`<type>: <中文说明> to #<Aone ID>`；不得臆造 Aone ID 或使用 `--no-verify`。

## 9. 验证清单

代码或行为改动至少执行：

```bash
npm test
npm run build
```

涉及 API 时补充 Supertest/接口回归；涉及链上映射时补充真实响应脱敏后的 fixture 或 mock；涉及 UI 时在 `http://127.0.0.1:1422/` 检查桌面和移动布局、加载/错误/过期态；涉及钱包时只做预检和用户确认前的流程验证。

已知的非阻塞构建提示：Vite 可能提示入口 bundle 超过 500 KB；除非本次改动扩大问题，否则记录提示即可，不要为了消除提示重构无关模块。

## 10. 当前明确的非目标与限制

- 没有后台自动移除、自动添加、自动 Zap、自动复投或自动签名。
- 没有短信通知；电话 DING 仅在用户显式启用且权限、Robot Code 完整时可用。
- 没有云端数据库、多用户权限、云端同步或跨设备账户；IndexedDB 数据仅属于当前浏览器来源与配置。
- 没有完整的历史价格曲线、无常损失历史报表或农场奖励聚合。
- PancakeSwap 目前覆盖直接持有的 V3 Position NFT；复杂托管、质押、Vault 或第三方管理仓位需单独适配。
- 一小时 APR 依赖监控期间的连续快照；历史不足时只能显示采样中/覆盖时长，不能伪造完整年化值。

## 11. 交付说明

当用户要求“实现”某项能力时，最终交付应说明：修改的文件、实际支持的能力、验证命令及结果、已知限制和是否需要用户在钱包中确认。对于只读分析或文档整理，不应顺带修改链上配置、凭据、项目外文件或广播交易。
