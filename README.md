# LP Sentinel

本地运行的集中流动性 LP 监控、模拟与价格预警工具。

「策略 Agent」从钱包地址开始，通过 Revert Finance 索引查询六条链的活跃 LP，选中后在右侧查看 HOLD 基准损益、APR、手续费与奖励，并点击获取本机 Codex 的优化建议。支持 Uniswap V3、PancakeSwap V3、Aero CL 与 Aerodrome CL 的多个部署。地址保存在浏览器 IndexedDB，股票身份按发行方合约目录识别。见 [地址查仓与 AI 分析](docs/wallet-agent.md)。

当前主界面仅保留策略 Agent，并占满可用宽度。左侧模块菜单、独立 NFT 查询、旧监控详情和钱包交易页面已移除；顶部刷新与报警设置、Agent 内的 LP 列表和每日 APR 继续使用。

原事件驱动分析、代码风控、成本模拟和复盘记忆保留在「高级：事件观察与成本演练」。详见 [事件 Agent 使用与架构](docs/strategy-agent.md)。

离线研究流程支持三个 Ethereum Uniswap V3 池的连续 30 天小时数据、前 21 天参数校准、后 9 天隔离测试，以及手续费/调仓成本压力模拟。需要可访问的 The Graph 数据源；合成演练不代表真实回测。见 [LP 历史研究与复现](docs/lp-research.md)。

LP 策略思路与迭代记录统一从 [Memory 知识库](MEMORY.md) 查阅，包含现有策略、参数边界、指标口径、实验依据及升级模板。

## 本地兼容监控能力

以下为保留的后端和底层能力；独立 NFT 导入、监控详情与钱包操作界面已移除，既有本地记录继续保留。

- 通过 Position NFT 查询导入并监控多个 LP；导入时自动带入链上价格、区间、资产和智能预警线。
- 已导入仓位的兼容接口可暂停/恢复监控、删除本地记录及调整上下预警线；链上仓位本身不提供通用编辑入口。
- 读取 Binance 现货公共行情，并按集中流动性曲线估算当前两种代币构成。
- 触及预警线时通过 DWS 给当前登录用户发送钉钉私聊。
- 可选追加应用内 DING 或高优先级电话 DING；两者默认关闭，电话 DING 可能产生通信费用。
- 越界只报警一次，价格回到安全区后自动重新布防。
- 数据保存在本机 `data/lp-sentinel.json`。
- 连接浏览器 Binance Wallet，读取 BNB Chain 上由当前地址直接持有的 PancakeSwap V3 Position NFT。
- 保留先链上预执行、再由钱包签名的部分/全部流动性移除底层构造能力，当前主界面不提供交易操作入口。
- 按 Position NFT ID 并行识别 Robinhood Chain / Uniswap V3、BNB Chain / PancakeSwap V3 与 Base / Uniswap V3，无需连接钱包；同一编号跨链重复时展示全部候选供用户选择。
- 根据 LP tick 宽度自动生成上下预警线，并可一键加入本地持续监控；后续刷新始终使用链上池价格。
- 回放 Position Manager 的 IncreaseLiquidity、DecreaseLiquidity 与 Collect 事件，在详情页展示累计投入/移除/领取、已领取与未领取手续费、相对持币损益、ROI、历史费 APR、仓位年龄和交易 gas。

> LP Sentinel 不读取、保存私钥或代替用户签名。真实仓位与模拟仓位在界面中明确隔离，任何移除交易都必须由钱包逐笔确认。

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

独立“按 NFT 查询”模块已移除。兼容后端仍可并行探测已注册的链与协议，查询返回交易对、持有人、池地址、手续费档位、tick、当前价格、区间、代币构成、仓位估值和建议预警线。NFT ID 不是全局唯一标识；兼容接口调用者需按网络、协议和交易对确认来源后再导入。

- Robinhood Chain（chain ID `4663`）/ Uniswap V3；RPC 可通过 `ROBINHOOD_RPC_URL` 覆盖。
- BNB Chain（chain ID `56`）/ PancakeSwap V3；RPC 可通过 `BSC_RPC_URL` 覆盖。
- Base（chain ID `8453`）/ Uniswap V3；默认使用 Base 官方公共 RPC，并可通过 `BASE_RPC_URL` 覆盖。
- 统一查询接口：`GET /api/lp-nft/:tokenId`，返回 `matches` 与每个平台的脱敏 `probes`。
- 导入预警：`POST /api/positions/from-lp-nft`，JSON 请求体必须明确来源，例如 `{ "tokenId": "7314935", "sourceId": "bsc-pancake-v3" }`。
- 兼容查询接口：`GET /api/lp/robinhood-uniswap-v3/:tokenId`；新界面不再依赖此单链接口。

当前来源标识：

| `sourceId` | 网络 | DeFi 协议 | 查询方式 |
| --- | --- | --- | --- |
| `robinhood-uniswap-v3` | Robinhood Chain | Uniswap V3 | Position Manager + Pool 公开 RPC |
| `bsc-pancake-v3` | BNB Chain | PancakeSwap V3 | Position Manager + Pool 公开 RPC |
| `base-uniswap-v3` | Base | Uniswap V3 | Position Manager + Pool 公开 RPC |
| `ethereum-uniswap-v3` | Ethereum | Uniswap V3 | Position Manager + Pool 公开 RPC |
| `arbitrum-uniswap-v3` | Arbitrum | Uniswap V3 | Position Manager + Pool 公开 RPC |
| `optimism-uniswap-v3` | Optimism | Uniswap V3 | Position Manager + Pool 公开 RPC |

地址查询使用 Revert 索引，`base-aerodrome` 聚合 `aero / aerodrome / aerodromev2 / aerodromev3` 四个 CL 部署及其识别的质押归属。各来源逐页返回，错误、停止和索引过期分别提示。来源、绩效字段和接入范围见[地址查询说明](docs/wallet-agent.md)。

运行 `npm run dev` 后，从右上角「Agent 菜单」分别打开「模型与运行」「Agent 测评」和「样本数据」。模型页面支持本机 Codex、DeepSeek、GLM 和 OpenAI 兼容接口；远程模型密钥可在本地填写，服务端明文保存在权限为 0600 的文件中。地址建议、自动提醒与事件策略使用所选模型；测评仍固定使用本机 Codex。详细配置见[地址查询说明](docs/wallet-agent.md#本机-api-与配置)。

样本页面每天北京时间 08:10 更新首页最近一次成功查询钱包的 Uniswap V3 近 30 日历史，钱包历史不可用时回退到 TVL Top 50；数据保存在本机 JSON，服务停机后暂停并在重启时补采。来源、覆盖和缺口以页面实际结果为准。详见[每日样本概览](docs/wallet-agent.md#每日样本概览)。

线上页面连接这台电脑时使用独立的 loopback API。macOS 首次运行 `npm run codex:install` 安装启动器并验证 ready，也可运行 `npm run codex:bridge` 从终端启动。完整启动方式与浏览器权限说明见[本机 Codex API](docs/wallet-agent.md#本机-codex-api-与启动器)。

选中 LP 后可查看按北京时间分天的 24 小时有效区间图。历史优先采用 Revert 快照，缺口通过池价事件和 NFT 流动性状态回放校准，同时展示每日历史覆盖率与事件校准时长。派生结果使用 5 分钟内存缓存，读取失败的时段保留缺口，并支持主动重试。回放需要支持历史调用与日志的 RPC，配置和精度口径见[每日有效区间说明](docs/wallet-agent.md#每日有效区间时间)。

统一查询的处理规则：

1. 先校验 NFT ID 为正整数，再并行调用全部已注册来源，避免错误请求进入 RPC。
2. `matches` 保留所有成功命中；NFT ID 跨链重复时不会擅自选择其中一个。
3. `probes` 只返回“已识别 / 未找到 / 暂不可用”等简洁诊断，不把完整 RPC 或合约异常堆栈暴露到界面。
4. 用户选择候选后，以 `tokenId + sourceId` 作为仓位身份加入监控；后续刷新继续使用同一链上适配器。

已验证样本包括 BNB Chain / PancakeSwap V3 的 `#7314935`，以及 Base / Uniswap V3 的 `#5949035`。样本仅用于验证识别能力，价格、区块和持仓仍以实时链上结果为准。

智能预警会依据 tick 区间宽度，把上下预警线放在边界内侧：窄区间使用 20% 缓冲、常规集中区间使用 12.5%、宽区间使用 8%。推荐参数同时返回 3 次确认、5 分钟采样和 4 小时冷却，当前版本自动应用的是价格预警线；报警引擎仍按全局轮询设置采样，并采用“单次触界报警、回到安全区后重新布防”的现有语义。

> NFT 查询与加入预警均为只读链上操作。受监控仓位不会被自动移除或重新添加；任何资产操作都必须另行实现钱包签名、预执行和交易确认流程。

### 链上仓位分析口径

- “累计投入 / 移除 / 领取”直接来自 Position Manager 的 NFT 生命周期事件；首次读取会扫描该 NFT 的历史事件，结果按 RPC 客户端缓存 5 分钟。
- `Collect` 同时可能包含已移除本金和手续费。系统按事件顺序先冲减尚未领取的移除本金，再把余额计为已领取手续费，避免把移除本金整体误报为收益。
- 历史投入、移除、领取和已领取手续费使用事件发生前最近一笔 Pool Swap 的 `sqrtPriceX96` 估值；“池子净损益”采用“当前本金 + 累计领取 − 累计投入”，“资金效率 ROI”以累计投入为分母。该口径接近 Revert 的现金流分析，但不等同于税务成本或法币入金收益率。
- 若事件前 100 万个区块内没有可用 Swap，历史分析会安全降级为待回填，不使用当前价格伪造历史估值。
- gas 统计为涉及该 NFT 生命周期事件的整笔交易 gas；一笔交易若还执行了其他操作，无法仅靠标准事件精确拆分到该仓位。
- Robinhood 默认 RPC 已可直接读取完整历史。BNB 与 Base 公共 RPC 通常不保证归档日志；分别设置支持 `eth_getLogs` 全历史查询的 `BSC_HISTORY_RPC_URL`、`BASE_HISTORY_RPC_URL`（也可让对应自有 RPC 同时承担历史读取），配置后会在下一轮自动回填，未配置时页面会明确提示而不会伪造指标。
- 标准 V3 Position Manager 事件不能可靠判断某次增加流动性是否来自手续费复投，也不包含外部 Farm 奖励；因此不会把“复投”和“奖励”伪装成可验证的链上字段。

## 真实 PancakeSwap V3 仓位

此独立操作页面已移除，以下为保留的底层实现约定。策略 Agent 的地址查仓与建议不触发钱包交易。

- 默认 RPC：`https://bsc-dataseed.binance.org`，可通过 `BSC_RPC_URL` 替换。
- 配置 `BSCSCAN_API_KEY` 后可自动枚举钱包持有的 Position NFT；未配置时兼容读取接口接受 Token ID，读取结果仍会通过链上 `ownerOf` 校验。
- 第一版只支持由钱包地址直接持有的 BNB Chain PancakeSwap V3 仓位；已质押到 MasterChef/Farm、V2 LP 和 Infinity 仓位暂不支持。
- 移除流程固定使用 0.5% 滑点保护，20 分钟截止时间，将 `decreaseLiquidity` 与 `collect` 合并为一次钱包交易；不会自动销毁空 NFT。

## 报警语义

- 当前价格 `<= 下限预警`：发送一次下限报警。
- 当前价格 `>= 上限预警`：发送一次上限报警。
- 价格持续位于同一侧：不重复发送。
- 价格回到两条预警线之间：自动重新布防。

普通私聊始终开启。应用内 DING 和电话 DING 是两个独立追加通道，不会替代普通消息；电话通道仅在明确启用后生效。
