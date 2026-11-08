# 地址驱动的 LP 策略 Agent

策略 Agent 是当前唯一主界面。左侧模块菜单与独立 NFT 查询、监控详情、钱包交易页面已移除，主工作区使用完整可用宽度。Agent 内的仓位选择、每日有效区间与 APR、AI 建议和高级事件控制台继续保留，既有本地记录与后端兼容接口不受页面移除影响。

输入 EVM 钱包地址，通过 Revert Finance 地址索引发现 LP，选中仓位后在右侧查看资产与收益。页面可连接同一台电脑的本机 Codex API，点击“获取 AI 优化建议”后补充个人历史与 Uniswap TVL Top 50 基准，再交给 Codex。Vercel 提供数据 API，AI Gateway 接入待开通。高级事件控制台位于本地页面底部。

## 本地运行与地址保存

```sh
npm run dev
codex login status
npm run codex:bridge
```

打开 `http://127.0.0.1:1422/`。本机 API 复用 Codex 登录态，可用 `codex login` 登录，首次安装启动器见下文。有效地址在主动查询时写入当前浏览器、当前 origin 的 IndexedDB，数据库为 `lp-sentinel`，对象仓库为 `preferences`，键为 `wallet-address`。重开页面恢复输入，用户点击后开始查询。清除操作删除地址及当前结果，存储错误会在页面提示。

## Revert 数据接入

后端调用网站实际使用的只读接口，单页最多 25 个活跃仓位。

```text
GET https://api.revert.finance/v1/positions/{network}/{exchange}/account/{address}/?active=true&limit=25
```

| 应用来源 | Revert network | Revert exchange |
| --- | --- | --- |
| Robinhood / Uniswap V3 | `robinhood` | `uniswapv3` |
| Base / Uniswap V3 | `base` | `uniswapv3` |
| Ethereum / Uniswap V3 | `mainnet` | `uniswapv3` |
| Arbitrum / Uniswap V3 | `arbitrum` | `uniswapv3` |
| Optimism / Uniswap V3 | `optimism` | `uniswapv3` |
| BNB / PancakeSwap V3 | `bnb` | `pancakeswapv3` |
| Base / Aero 与 Aerodrome CL | `base` | `aero`、`aerodrome`、`aerodromev2`、`aerodromev3` |

四个 Aero/Aerodrome 标识分别对应集中流动性部署，其中 `aerodromev2/v3` 是部署版本。仓位键包含应用来源、Revert exchange 和 NFT ID，跨部署的相同编号可同时展示。归属优先核对 `real_owner`，由 `current-reward-state.staked` 识别质押状态。

各来源独立分页、逐步返回。Revert 的原始游标包在本机 `r:` 游标中，调用方应原样传回 `nextCursor`。Aero 来源按四个部署依次续查，部署内空结果后继续下一部署。`incomplete`、`stale`、校验失败和连接失败均保留明确提示，停止后保留已返回结果。

查询超时为 25 秒。相同地址、来源和游标共享在途请求及 15 秒内存缓存，缓存最多 256 项。分析操作绕过这层缓存，重新取得数据并核对归属。股票代币目录另缓存 5 分钟。

当前范围为表中来源的活跃集中流动性仓位。Revert 的索引覆盖、历史数据完整度和接口可用性决定结果范围。接口来自网站公开读请求，其字段变化需要同步适配。源代码与指标定义可在 Revert 官方站点核对。[Revert](https://revert.finance/)、[绩效口径](https://docs.revert.finance/revert/position-analytics/how-revert-measures-performance)、[Aerodrome](https://docs.revert.finance/revert/aerodrome)

## Uniswap TVL Top 50 历史数据池

`server/services/uniswap-pool-universe.ts` 从 `https://yields.llama.fi/pools` 读取 DeFiLlama 收录的 Uniswap V2、V3、V4，按美元 TVL 跨链排序并固定前 50 个池。池身份使用数据源 UUID，保留网络、协议、费率标签和两个底层代币合约。

随后读取 `/chart/{uuid}`，采样最近 30 个完整 UTC 日，每日保留最后一条真实观测，记录 TVL、基础 APY、奖励 APY、实际日数和最大日期间隔。当天数据、无效值和重复日期被排除，缺失日保留缺口。单池失败仍保留其排名，避免以其他池替换后改变样本选择。

读取并发为 2，批次间隔 300ms，限流或服务错误最多重试一次，总采集时限 100 秒。完整数据在实例内缓存 1 小时，部分结果缓存 5 分钟，并共享在途请求。页面列出全部池及历史覆盖，AI 接收逐日 TVL 加权基础 APY、覆盖池数，以及按同链代币合约匹配的币对参考。

这是当前排名的历史回溯，存在选择与幸存者偏差。池级基础 APY 保留数据源口径，个人区间收益、无常损失、gas 与再平衡成本仍需独立分析。离线研究的完整小时价格输入要求见 [LP 研究](lp-research.md)。数据源字段与适配器定义见 [DeFiLlama Yield Server](https://github.com/DefiLlama/yield-server)。

## 本机 Codex API 与启动器

页面标题右侧显示本机 Codex 状态与“修复”按钮，每 10 秒读取 `http://127.0.0.1:4318/api/local/status`。ready 要求 API 在线、CLI 可执行、已登录且最小 JSON 调用验证成功。心跳只读取状态，CLI 登录状态每 30 秒复查。启动和显式修复执行一次最小模型调用，近期成功结果用于合并重复修复请求。实际分析由“获取 AI 优化建议”按钮触发，优先使用 ready 的本机入口。

在本机项目目录执行以下命令。

```bash
npm run codex:install  # macOS 安装启动器并启动到 ready
npm run codex:bridge   # 从终端启动或检查本机 API
```

macOS 启动器位于 `~/Applications/LP Sentinel Codex.app`，注册 `lp-sentinel://repair`。API 离线时，页面“修复”通过该协议唤起启动器，启动器执行固定项目入口。API 在线时修复会重新验证 CLI 调用。登录失效时显示 `codex login` 操作提示，安装与登录由这台电脑的用户管理。浏览器可能需要用户本人确认打开本机应用或连接本机网络。协议无法唤起时，可手动打开启动器或使用上述终端命令。

桥接 API 仅监听 IPv4 loopback，允许正式站 `https://lp-sentinel.vercel.app` 和开发站 `http://127.0.0.1:1422`、`http://localhost:1422`，校验 Host 与 Origin。状态响应提供进程内会话令牌，修复和分析 POST 必须携带 `X-LP-Bridge-Token`。令牌只存在页面内存中，Codex 登录凭据由本机 CLI 使用。接口支持浏览器的私有网络预检。

本机分析入口仍只接受 `address / sourceId / positionKey`，服务端刷新仓位后发送脱敏事实。执行器采用独立临时目录、stdin 输入、结构化 JSON 输出与临时会话，并关闭工具、插件、记忆、hooks 和用户配置发现。API 的 PID 与脱敏运行日志分别保存为 `data/local-codex.pid`、`data/local-codex.log`。启动器仅恢复项目管理的 API 进程，已被其他程序占用的端口会提示处理。

代码入口为 `server/local-codex-bridge.ts`、`server/agent/codex-cli.ts`、`scripts/start-local-codex.mjs`、`scripts/install-local-codex.mjs` 与 `src/local-codex.tsx`。CLI 集成方式见 [OpenAI 非交互模式](https://learn.chatgpt.com/docs/non-interactive-mode)，服务接口背景见 [OpenAI App Server](https://learn.chatgpt.com/docs/app-server)。

## 每日有效区间时间

选中 LP 后，右侧“仓位分析”自动读取该 NFT 的 Revert 历史，展示最近 30 天内的北京时间日线，默认收起为最近 7 天。每行覆盖 00–24 时，点击日期查看区间内、区间外、缺口、未持仓和未到时间的时长分解。

日有效占比为区间内秒数除以 86,400。计算优先使用 Revert 返回的全部已校验历史及有效当前快照，在相邻观测间沿用前一条状态。超过 3 小时的整个间隔、历史未返回的首尾时段先记为缺口，再通过链上回放校准。建仓前与已退出时段标为未持仓，今天剩余时段标为未到时间。原始快照的观测次数占比仍独立保留。

回放通过 Revert 的建仓交易识别真实 NFT 合约，核对链 ID、建仓区块、代币、Factory 池地址和不可变的 tick 区间。池子的 Swap / Initialize 事件还原价格状态，NFT 索引事件定位流动性变化区块，再读取该区块结束时的 NFT 流动性，以兼容不同 CL 部署的事件参数格式。区间判断采用 `tickLower <= tick < tickUpper`，时间按区块时间戳累计。同区块的变更按零时长处理。

每段回放同时校验终点池 tick、NFT 流动性和区块哈希，校验完成后写入派生结果。事件时段记录 `basis=events`，每日 `eventSeconds` 给出回放覆盖秒数，`coveragePercent` 表示当天已发生时段中已知状态的覆盖率。Revert 采样时段仍有穿越时刻误差，事件时段具有区块时间戳精度。数据源已抽样、字段失败或回放失败均显示提示，缺乏有效状态观测的日期显示“—”。

有效占比后展示“当日 APR”，按北京时间汇总当日手续费与奖励的 USD 收益，除以收益采样时段的时间加权平均本金，再乘以 365。版本 1 DTO 的可选 `days[].income` 返回年化百分比、手续费 USD、奖励 USD、平均本金 USD 和有效采样秒数。点击日期可查看这些明细。收益来自相邻快照的累计代币数量增量，按后一个快照的 USD 价格估值，不将已赚代币的价格上涨当作新收益；跨午夜的增量按时长分摊，本金在相邻快照间线性插值。

只计算间隔不超过 3 小时且收益与本金字段完整的快照对，累计计数下降或奖励缺少价格的时段不计；链上价格回放不会补造收益。有效收益采样不足 1 分钟、没有平均本金或缺少数据时显示“—”，确认没有收益时显示 `≈0.00%`。当前未结束日期和有收益缺口的日期仅使用已采样收益，不外推全天收益；数值带 `≈` 标明快照估算，采样时长随日期明细展示。

持久历史沿用 Revert 和链本身。链上原始日志仅用于单次回放，应用缓存合并后的区间段。版本 1 DTO 的新增回放字段为可选字段，以完整来源、钱包与 NFT 身份作缓存键，最多保留 128 项，重复在途读取共享请求。缓存有效期为 5 分钟并在北京时间午夜截断，响应携带 `fetchedAt`、`expiresAt`。时间图按到期时间后台读取，保持所选日期，并在跨日后取得新的日线。有剩余缺口时可点击“重新补齐缺口”，显式刷新会绕过已完成结果缓存。

单次链上读取有 90 秒、96 个日志分段及每缺口 30,000 个状态点的上限，日志按至多 50,000 区块分段，高密度响应继续缩小范围。未通过完整性校验的整段保留缺口。RPC 优先读取对应链的 `*_HISTORY_RPC_URL`，其次为 `*_RPC_URL`，默认使用只读公共节点。支持的前缀为 `ETHEREUM`、`OPTIMISM`、`BSC`、`ROBINHOOD`、`BASE`、`ARBITRUM`。节点需要提供历史 `eth_call`、`eth_getLogs`、交易收据与区块，具体覆盖取决于节点。

计算位于 `server/domain/range-activity.ts`，事件回放位于 `server/services/range-activity-replay.ts`，读取与缓存复用 `server/services/revert-portfolio.ts`、`server/services/wallet-portfolio.ts`，图形位于 `src/range-activity.tsx`。时间图读取独立于池日行情查询。JSON 运行数据和地址偏好由各自入口管理。事件语义见 [Uniswap V3 Pool Events](https://github.com/Uniswap/v3-core/blob/main/contracts/interfaces/pool/IUniswapV3PoolEvents.sol)。

## 资产、收益与时间口径

右侧基础事实展示代币数量、池内价格、区间、本金 token1 估值、本金 USD、总损益及索引时间。展开“Revert 收益与费用”查看历史指标。

| 字段 | 口径 |
| --- | --- |
| 本金 USD | Revert `underlying_value` |
| 总损益 | `performance.hodl.pnl`，HOLD 基准，以 USD 计价 |
| 池子损益与价格分歧损益 | `performance.hodl.pool_pnl / il` |
| 历史总 APR、手续费 APR、ROI | `performance.hodl.apr / fee_apr / roi`，保留各自含义 |
| 累计手续费与奖励 | `fees_value / rewards_value` |
| 待领手续费 | 两种 `uncollected_fees` 乘以 Revert 当前 token USD 价格 |
| 待领奖励 | 当前奖励状态数量乘以对应奖励币 USD 价格 |
| 仓位年龄 | Revert `age`，单位为天 |

缺失指标显示“—”。Revert 返回 `fee_experiment` 时，页面显示手续费 APR 实验值提示，AI 也收到对应标记。金额和年化仅按本次数据源口径使用，调整判断仍需结合仓位年龄、成本和奖励条件。

`updatedAt` 来自 `now_ts`，页面标为“索引数据时间”。`ts` 是历史活动时间。当前响应的快照区块号缺失时省略该字段，分析建议绑定返回快照及时间。过期标记、超过三分钟的数据或异常未来时间会阻止分析。

股票身份按 `chainId + token contract` 匹配 Robinhood 官方目录。目录错误会显示身份核验提示。已核验股票筛选保留这个合约级条件。[Robinhood 资产目录](https://docs.robinhood.com/chain/stock-token-apis/)

## AI 数据流

浏览器提交地址、来源和仓位键。后端要求该键在最近 15 分钟内被本机查询过，刷新对应 Revert 页并重新核对归属。给模型的事实包含网络、交易对、数量、区间、质押状态、绩效基准、历史样本与现金流摘要。地址发给 Revert，模型收到脱敏摘要。

Codex 在独立临时目录中以 `--ephemeral`、只读沙箱和结构化输出运行，工具权限受限，结束后清理临时文件。模型服务返回方向、依据、风险与下一步。单次最多 90 秒，最多两条不同仓位并发，同仓位在途调用复用。界面使用结果中的快照更新事实。模型连接或格式错误显示可重试状态。

## 分析前的历史样本

点击分析后，后端在当前快照上补充两组 Revert 历史，再调用模型。

- 仓位 `metrics-history` 提供最近30天内的真实快照、每日手续费和奖励。保留实际覆盖天数、原始样本数、最大间隔与区间内观测比例，最多将60条快照摘要送给模型。
- 池级 `discover-pools/daily` 提供最近30个完整UTC日的成交量、费用和TVL。当前未结束日单独排除，数据源实际覆盖不足时显示样本数量和缺口。
- 当前仓位页的现金流按事件时间整理，包含投入、移出、领取、质押和历史gas。摘要保留24条首末事件以及实际总记录数，模型接收的历史字段经过地址与交易身份脱敏。

页面将仓位历史与池级参考分别标明。WETH/USDC 样本实际为约7天、91条快照、6日手续费和8条现金流，池级参考为30个完整日。已质押Aero CL样本取得45条快照、3日奖励和15日池数据，页面按实际覆盖显示。区间内观测比例按已有快照计算，历史gas按数据源事件计价。

总结最多48字，优先展示调整方向。其后分别显示最多72字的调整策略、64字的触发条件及最多两步操作，每步最多48字。依据与风险折叠展示，历史查询失败或部分缺失以具体数据项提示。

本轮真实浏览器分析返回33字总结，明确给出下移并拓宽范围的方向、历史价格参考、观察条件与成本门槛。界面展示91条仓位快照、30日池样本，模型依据引用了6个完整日的68.40美元手续费。已有65项测试及构建通过。

## 本机 API 与配置

| 方法 | 路径 | 内容 |
| --- | --- | --- |
| GET | `/api/agent/sources` | 网络和平台目录 |
| GET | `/api/agent/ai-status` | 提供方及可用性 |
| GET | `/api/agent/wallet/:address?sourceId=...&cursor=...` | Revert 单来源分页、进度与提示 |
| POST | `/api/agent/analyze` | `{ address, sourceId, positionKey }`，刷新后分析 |
| GET | `/api/agent/pool-universe` | Uniswap TVL 前 50 池、30 日观测与覆盖摘要 |
| GET | `/api/agent/range-activity` | `address / sourceId / positionKey`，可选 `refresh=1`，返回每日有效区间、回放覆盖与紧凑时段 |

写请求经过本机 Host、JSON 和 Origin 校验。开发代理保留 Host。无效地址、来源和游标返回 400，数据源错误返回 502。RPC 环境变量服务于 NFT 监控和钱包合约读取，地址查仓使用固定的 Revert HTTPS 服务。

AI 默认 `LP_PORTFOLIO_AI_PROVIDER=codex`。选用 `gateway` 时配置 `LP_AGENT_MODEL`，认证可使用 `AI_GATEWAY_API_KEY`、本地开发的 `VERCEL_OIDC_TOKEN` 或 Vercel Functions 请求上下文的 `x-vercel-oidc-token`。运行时令牌按请求传递。普通 `npm run dev` 从 shell 获取环境变量。

## Vercel 部署

`vercel.json` 将 Vite 页面与 `api/index.ts` 只读 API 部署到同一个项目。云端构建设置 `VITE_LP_RUNTIME=cloud`，提供地址查仓、Top 50 样本与用户点击触发的 AI 分析。云端和本地均使用策略 Agent 主界面；本地继续保留 JSON、监控轮询与 DWS 兼容能力，独立 NFT 查询和钱包交易页面已移除。部署包排除运行数据、环境文件和个人知识库。

云端默认模型为 `openai/gpt-6-luna`，使用 Vercel OIDC 接入 AI Gateway。需要团队具备可用额度及对应模型权限。平台返回 `customer_verification_required` 时，团队所有者需要在 Vercel 添加有效付款方式，页面会显示具体开通要求。查询与分析分配到不同实例时，后端根据固定来源和 NFT 标识直接刷新 Revert，并再次核对 `real_owner`。模型输入仍只包含脱敏事实。

`vercel.json` 中 `LP_PORTFOLIO_AI_PROVIDER=disabled`，查仓与历史样本可独立使用。同机浏览器可以连接本机 Codex API；未连接时，页面引导修复。AI Gateway 完成团队验证后，可将该值改为 `gateway` 并重新部署，再验收真实模型返回。

```sh
vercel deploy --prod --skip-domain --scope ytu94s-projects
# 检查部署页面、查仓、Top 50 和真实 AI 响应后执行
vercel promote <已验证的部署URL> --scope ytu94s-projects
```

云端 POST 保持同源和 JSON 校验，API 只挂载数据与分析路由。AI Gateway 的 [OIDC 认证](https://vercel.com/docs/ai-gateway/authentication-and-byok/oidc) 使用项目运行时身份。

## 2026-11-07 历史缺口回填验收

- 正式入口为 [LP Sentinel](https://lp-sentinel.vercel.app/)，构建 `dpl_Aypo7bXUpeJKHT7GBdbxifJwrgzB` 已完成暂存生产验证并切换正式域名，前端资源为 `index-B2Wb9eWl.js` 与 `index-DQnw9X4L.css`，与本地 cloud 构建匹配。
- 样本地址的 5 个活跃 NFT 全部通过云端回放校验，分别为 Base Uniswap V3 `#6486311`，Aero CL `#1125629`、`#1216549`、`#1126374`、`#1118921`。已发生时段的历史覆盖率均为 100%，各日总时长为 86,400 秒，剩余历史缺口为 0。
- Aero CL `#1125629` 的 2026-11-06 补齐 79,219 秒缺口，有效时长由 7,181 秒更新为 78,507 秒，界面由 8.3% 更新为 90.9%。建仓日另补齐 3,296 秒。已有完整 Revert 采样日期的时长统计保持一致，事件回放精度按区块时间戳计。
- 暂存生产的上述 5 次真实读取返回 200，单次耗时约 2–17 秒。正式域名的真实回填接口返回 200，无效地址、错误刷新参数与已退出 NFT 分别返回 400、400、409。隔离运行验证了 RPC 不可用时保留原始缺口和采样结果，错误信息经过脱敏。
- 正式页面已刷新，7/7 来源查仓完成，选中 NFT 后显示新统计口径、来源时间和日期明细。本地 1280×1000、390×844 与正式 390×844 检查通过，页面无横向溢出。正式桌面以资源一致性和 DOM 尺寸核验，侧栏截图边界限制了完整桌面截图。截图为 `.impeccable/review/range-backfill-desktop.jpg`、`range-backfill-mobile.jpg`、`range-backfill-production-mobile.jpg`。
- 独立界面复核为 `ship`，来源契约同步项 R1 为 `Resolved`。65 项既有测试、类型检查及 cloud 构建通过，入口约 552 kB，保留既有包体积提示。发布回读的 error/fatal 日志为 0。其他链的回放效果依赖对应历史 RPC，当前真实回放验收覆盖 Base。

## 2026-11-07 每日有效区间上线验收

- 正式入口为 [LP Sentinel](https://lp-sentinel.vercel.app/)，构建 `dpl_AmF5HvtTthuopEaJwk3JxZAug2Vz` 已完成暂存生产验证并切换正式域名。页面引用的 `index-4gdXdNi3.js` 与本地 cloud 构建一致。
- 真实 Aero CL NFT `#1125629` 返回 6 个北京时间日期、46 条观测。所有日期的区间段连续覆盖 86,400 秒，2026-11-03 的区间内时长为 57,589 秒，界面显示 16.0 小时和 66.7%。2026-11-06 的 22 小时缺口明确显示，2026-11-07 缺乏历史时显示“—”。
- 线上时间图接口返回 200，无效地址返回 400，已退出的旧 NFT 返回 409 并提示重新查仓。同仓位并发读取共享结果，缓存按剩余有效期返回，跨日日期更新已通过运行验证。
- 正式浏览器完成 7/7 来源查询与选仓、日期切换。1280×1000 和 390×844 的图表、图例、时长明细均可读且页面无横向溢出。独立界面复核结论为 `ship`，无待处理的实质问题，检测器保留组件字号和圆角建议。截图位于 `.impeccable/review/range-production-desktop.png` 与 `range-production-mobile.png`。
- `npm test` 的 24 个文件、65 项测试通过，常规构建和 cloud 构建通过。cloud 入口约 551 kB，保留既有超过 500 kB 的构建提示。发布回读的 error/fatal 日志为 0。

## 2026-11-06 数据版线上验收

- 正式构建 `dpl_522y8vZnY5zPHnuemrZPLigrVYYy` 为 `READY`，已将验证过的暂存生产构建 promote 至正式入口。[LP Sentinel](https://lp-sentinel.vercel.app/)
- Top 50 全部取得历史观测，2026-10-07 至 2026-11-05 共 1,419 条日样本，30 池具有完整 30 日，20 池有历史缺口。[历史数据接口](https://lp-sentinel.vercel.app/api/agent/pool-universe)
- 正式域名的页面、查仓和样本接口返回 200。浏览器真实查询完成 7/7 来源并返回 5 个活跃仓位，AI 状态为待开通，分析按钮禁用。
- 正式页面引用 `index-BH9zUWN2.js`，暂存部署的 JS/CSS 与本地构建字节一致，SHA-256 前缀分别为 `04f2329d658de86e` 与 `90eea2b39c62f5e2`。
- 线上无效输入、跨站 Origin、非 JSON 和本地状态路由分别按 400、403、415、404 拒绝。发布回读时 error/fatal 日志为 0。
- 真实线上桌面 1280px、手机 390px 检查通过，手机样本表格在自身容器横向滚动，页面宽度保持 390px。已有 24 个测试文件、65 项测试及构建通过，入口约 546 kB，保留现有 bundle 大小提示。
- 新增数据服务、共享 DTO、样本面板与云端入口分别位于 `server/services/uniswap-pool-universe.ts`、`shared/pool-universe.ts`、`src/pool-universe.tsx`、`api/index.ts`。`package-lock.json` 的 298 个下载地址已切换到公共 npm，锁定版本与完整性校验保留。

## 2026-11-06 Revert 验收

- 七个来源均取得真实 200 响应，样本地址返回 1 个 Base Uniswap V3 和 4 个已质押 Aero CL 仓位。
- 另一个 Robinhood 地址返回 2 个已核验股票代币 LP，交易对为 USDG/USO 与 SPCX/USDG。
- Aerodrome 旧部署原生游标续查返回 NFT `#7665206`，`aerodromev2` 样本按集中仓位返回 NFT `#5350458` 及真实区间。
- 浏览器从真实已质押 Aero CL 点击分析，刷新 Revert 后调用本机 Codex，返回 3 条依据、4 条风险和 4 条下一步。建议与右侧事实使用同一份索引时间及仓位快照。
- 桌面 1440×1000、手机 390×844 检查通过，展开收益字段后仍无横向溢出，手机选仓后分析区获得焦点并位于顶栏下约 80px。
- 无效地址和旧游标返回 400。已有测试 65 项通过，生产构建通过，入口约 545 kB，仍有超过 500 kB 的提示。

## 2026-11-05 验收记录 · 旧 RPC 地址查询

| 范围 | 结果与证据边界 |
| --- | --- |
| 真实多链查询 | 样本地址完整返回 Robinhood 8 个 NFT、Base 17 个 NFT，其中 2 个股票/ETF 代币 LP 经发行方目录匹配 |
| 真实 Aerodrome 查询 | 官方 Sugar 测试地址返回 2 个 Slipstream 仓位；公共种子地址首池页返回 79 个普通池份额，普通池没有伪造现价/区间 |
| 真实 AI | 浏览器选中 Base WETH/USDC 后，后端刷新链上数据并调用本机 Codex，返回建议方向及依据/风险/下一步各 3 条；显示区块与返回快照一致 |
| IndexedDB | 主动查询保存、重开恢复、从界面清除并回读确认删除均通过 |
| 停止与失败恢复 | 停止录得 0 次误提交、0 个继续加载来源，已返回结果保留；AI 状态 503 演练后重试真实状态接口成功，保留 5 个真实仓位 |
| API 边界 | 无效地址/来源 400、客户端附带价格字段 400、外站 Origin 403；合法开发代理请求保持同源 |
| 桌面/手机 | 1440×1000、390×844 检查通过；手机无横向溢出，选仓后分析区停在顶栏下约 80px 并获得焦点 |
| 原有回归 | `npm test`：24 个文件、65 项通过；`npm run build` 通过，入口约 542 kB，仍有超过 500 kB 的提示 |

界面独立复核结论为 `ship`：

| 项目 | 最终状态 |
| --- | --- |
| R1 停止误提交 | 已解决 |
| R2 手机分析跳转与焦点 | 已解决 |
| R3 手机控制文字裁切 | 已解决 |
| R4 建议/事实快照一致 | 已解决 |
| R5 支持信息可读性 | 已解决 |
| R6 明确具体 NFT / 池 | 已解决 |
| R7 AI 服务失败后重试 | 已解决 |

未完成真实验收的范围：四个额外公共 RPC 域名受当前网络策略限制，浏览器只演练了其显式 502 失败分支；未完成 Aerodrome 四万多个池的全量扫描或全部质押/ALM 场景。没有验证投资收益、真实钱包签名或交易。设计检测有旧 DESIGN.md 的字号/配色/圆角建议，不能声称检测器零告警；最终界面结论以源代码、实际交互和截图复核为准。

策略与证据迭代见 [LP 知识库](../MEMORY.md)。
