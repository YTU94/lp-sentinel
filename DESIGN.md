---
name: LP Sentinel
description: 参考 Codex 桌面工作台的克制型本地 LP 区间监控界面
colors:
  canvas: "#f7f7f5"
  paper: "#ffffff"
  paper-raised: "#fafaf9"
  ink: "#20201e"
  muted-ink: "#6f6f69"
  chart-line: "#deded9"
  sea-data: "#1f766f"
  sea-channel: "#e7f2ef"
  alert-red: "#b5473c"
  alert-shoal: "#f8e9e6"
  portfolio-selection: "#f3f9f7"
typography:
  display:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "clamp(38px, 6vw, 64px)"
    fontWeight: 650
    lineHeight: 1.02
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "clamp(34px, 5vw, 54px)"
    fontWeight: 650
    lineHeight: 1.04
    letterSpacing: "-0.035em"
  title:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "20px"
    fontWeight: 650
    lineHeight: 1
  body:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "0.04em"
  portfolio-heading:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "26px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  portfolio-source:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "12px"
    lineHeight: 1.55
  portfolio-facts:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "12px"
    lineHeight: 1.7
  portfolio-disclosure:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "12px"
    lineHeight: 1.8
  portfolio-advice:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "13px"
    lineHeight: 1.9
  portfolio-action:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 600
rounded:
  tag: "5px"
  field: "8px"
  control: "8px"
  panel: "12px"
  round: "50%"
  portfolio-position: "10px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "18px"
  lg: "24px"
  xl: "42px"
  portfolio-gutter: "28px"
  portfolio-compact-gutter: "20px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "38px"
  button-primary-hover:
    backgroundColor: "{colors.sea-data}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "38px"
  button-utility:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    size: "38px"
  input:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "0 11px"
    height: "44px"
  status-active:
    backgroundColor: "{colors.sea-channel}"
    textColor: "{colors.sea-data}"
    rounded: "{rounded.tag}"
    padding: "4px 6px"
  status-alert:
    backgroundColor: "{colors.alert-shoal}"
    textColor: "{colors.alert-red}"
    rounded: "{rounded.tag}"
    padding: "4px 6px"
  portfolio-query:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "44px"
  portfolio-address:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "11px 13px"
  portfolio-position:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.portfolio-position}"
    padding: "17px 16px"
  portfolio-position-selected:
    backgroundColor: "{colors.portfolio-selection}"
    textColor: "{colors.ink}"
    rounded: "{rounded.portfolio-position}"
    padding: "17px 16px"
  portfolio-analyze:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.portfolio-action}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "44px"
    width: "100%"
---

# Design System: LP Sentinel

## Overview

**Creative North Star: "Codex 本地工作台"**

LP Sentinel 采用接近 Codex 桌面客户端的安静工作台语法：系统字体、中性灰白画布、轻边界、紧凑工具栏和少量真实浮层。策略 Agent 为唯一主工作区，内部并列展示 LP 清单与详情，报警设置面板像右侧检查器。LP 区间图继续承担业务表达，但不再依靠装饰性的海图材质。

这是 Operate 模式的高信息密度工具。视觉层级优先回答三件事：行情来自真实公开源、资产构成完全模拟、报警在本地执行。任何状态都必须同时依靠文字或形状表达，不能只靠颜色。

**Key Characteristics:**

- 中性灰白画布与白色工作面组成清晰的桌面应用层级。
- 低对比度边界和克制圆角组织区域，不以装饰抢占注意力。
- 单一警戒红专用于预警、错误和危险动作。
- 系统字体承载界面，数字使用等宽特性保证稳定扫描。
- 桌面端使用全宽策略 Agent，内部按 LP 清单与详情分列；移动端纵向堆叠，设置能力始终保留。

### Wallet Agent Surface Extension

地址驱动的策略 Agent 沿用中性画布、白色工作面、系统无衬线字体、海绿选中态和克制边框；钱包发现与 AI 分析并列呈现。以下带有 Wallet Agent 标识的约定以 `src/portfolio-agent.tsx` 与配套样式的实际实现为准；更早章节的航海字体描述不用于新增钱包界面。

- 白色工作面承载来源进度、仓位清单与分析，结构由间距和细线建立。
- 海绿边框和极浅选中底共同标识当前 LP，选择状态同时具有可访问语义。
- 来源逐步返回与分析主动触发是两个可辨认的阶段，状态文字先于装饰。

## Colors

配色像旧海图上的新鲜测绘标记：纸色安静，墨色坚决，海绿传达活跃数据，红色只在需要处理时出现。

### Primary

- **深墨**：主文本、选中仓位、主要按钮和关键结构线；它是界面的主导色，而非装饰色。

### Secondary

- **海图绿**：实时价格、在线状态、航迹、正常反馈和主要按钮悬停态。
- **浅海航道**：区间内背景和正常状态的柔和承载面。

### Tertiary

- **警戒红**：上下预警浮标、错误、离线状态和删除动作。
- **浅红浅滩**：危险区间与报警状态背景，使红色保持可读但不过度铺满。

### Neutral

- **浅航海纸**：页面主背景。
- **升起纸面**：配置抽屉及其粘性标题区域。
- **旧墨灰**：说明文字、时间和次要元数据。
- **测绘线**：分隔、表单描边和次级结构。

### Named Rules

**The Single Flare Rule.** 警戒红只表示风险、错误或破坏性动作；不要把它用作品牌强调或普通装饰。

**The Truth-by-Color Rule.** 海绿可表达公开行情和系统正常状态，但“真实行情”“模拟资产”“本地执行”仍必须有明确文字标签。

### Wallet Agent Accent

钱包表面复用深墨、白色、旧墨灰、测绘线和海图绿。选中 LP 使用独立的极浅海绿表面（`portfolio-selection`）与海绿边框，悬停使用略亮纸面。来源不可用、停止与分析错误沿用警戒红，并始终带可读文字；普通池、空仓位、区间内与出区间均有状态标签。

## Typography

**Display Font:** Barlow Condensed（sans-serif 后备）

**Body Font:** IBM Plex Sans（sans-serif 后备）
**Label/Mono Font:** IBM Plex Mono（monospace 后备）

**Character:** Barlow Condensed 像航海图标题与设备铭牌，承担名称、读数和操作区标题；IBM Plex Sans 保证中文说明清晰，IBM Plex Mono 让价格、编号、来源和状态具有仪表感。

### Hierarchy

- **Display**（700，响应式超大字号，紧凑行高）：仅用于空状态的核心主张。
- **Headline**（700，响应式大字号，紧凑行高）：仓位名称与当前价格读数。
- **Title**（600，中号窄体）：配置面板、记录区和分组标题。
- **Body**（400，常规字号，舒展行高）：说明、表单帮助和事件信息。
- **Label**（500，小号等宽）：行情来源、币对、价格刻度、序号和状态元数据；短标签可使用大写。

### Named Rules

**The Instrument Numerals Rule.** 价格和资产数值使用窄体或等宽字体并启用等宽数字；不要用装饰性字形弱化扫描效率。

### Wallet Agent Type

钱包表面使用 frontmatter 中的系统无衬线字体栈。页面标题为中等强调（26px、650、1.25 行高），窄屏降为 23px；来源与分析分组标题为 15px，选中交易对为 22px。来源名称、协议与进度均为 12px；事实行与分析披露同为 12px，分别采用 1.7 与 1.8 行高。关键指标使用 18–24px 等宽数字突出本金、HOLD 基准损益、累计手续费和历史手续费 APR。建议正文和列表为 13px、1.9 行高，段落比元数据更舒展。

钱包地址使用系统等宽字体（13px、1.4 行高），资产数量与事实数值启用等宽数字。标题、交易对和数值允许换行，不能让长符号、地址或 RPC 错误撑宽页面。

## Layout

主工作区为单个全宽策略 Agent，取消固定模块侧栏及其占位。桌面 58px 粘性顶栏承载品牌、系统状态和关键操作；900px 以下顶栏高 64px。信息使用响应式留白、水平分隔线和清单组织。

700px 以下 Agent 的 LP 清单和详情纵向排列。报警设置面板从右侧覆盖并保留完整表单。设置按钮不能因移动端压缩而隐藏；只允许隐藏独立的刷新按钮和非关键的居中状态摘要。

**The Continuous Helm Rule.** 任何断点都必须保留地址查仓与报警设置入口，且配置面板宽度不得超过视口。

### Wallet Agent Layout

钱包工作区占满原应用主工作区，不再限制为 1480px；内容内边距为 24px 24px 48px。地址输入与“查询 LP”先占据一整行，下方再分为发现清单和 LP 详情两列：左侧为 280–320px，右侧弹性占满剩余空间，两列间距 24px。网络与来源默认折叠，展开后显示两列来源网格；查询摘要、异常提示、筛选和选中态继续可见。右侧详情区用 1px 左边界与 24px 内边距分隔，粘在顶端 76px 处，超长内容在最大 `calc(100vh - 100px)` 的区域内滚动。

详情先展示交易对、仓位状态、关键指标与池价/区间等快照事实，再展示每日有效区间和 AI 分析。宽屏关键指标分四列、事实分两列；1360px 及以下改为两列关键指标和单列事实，标签保留足够宽度。历史加载或错误不会挤走顶部指标。

1180px 及以下，页面内边距改为 24px 20px 40px，清单列固定为 280px，两列间距与详情左内边距均为 20px。700px 及以下，两列堆叠，内边距为 20px 16px 36px，地址输入与查询按钮各占一行；详情区回到普通文档流，取消内部滚动，以顶部分隔线和 24px 上内边距承接列表。选择 LP 时将键盘焦点移到详情区并滚至其起点，使用 80px 的滚动留白避免被顶栏遮住；减少动态偏好下即时滚动。

查询与 AI 主按钮最小高度均为 44px。移动端来源重试、清除地址、网络选择与高级折叠入口也保留 44px 操作高度；报警设置入口继续可达。主界面不再提供独立 NFT 查询、监控仓位或钱包交易页面的切换入口。

**The Selected Snapshot Rule.** 清单中的选中态、分析标题和快照事实必须对应同一个仓位；手机上选中后将用户直接带到该分析区。

## Elevation & Depth

系统默认是平面的，深度主要通过纸色差、墨线和相邻区域的结构边界表达。阴影只用于表示真正悬浮的操作层：主要按钮有低矮环境阴影，右侧配置面板有横向投影；在线状态点可有极轻的海绿光晕。其余内容不应被包装为浮动卡片。

### Shadow Vocabulary

- **操作抬升**（`0 5px 16px rgba(23,32,31,.16)`）：主要操作按钮。
- **抽屉投影**（`-18px 0 38px rgba(23,32,31,.12)`）：右侧配置面板与工作区分离。
- **在线微光**（`0 2px 8px rgba(21,95,103,.35)`）：尺寸很小的在线状态点。

**The Flat Chart Table Rule.** 数据、清单和航道在纸面上保持平整；阴影不得用来代替结构线或信息层级。

钱包发现清单与分析区沿用平面结构，不额外增加阴影层；查询容器使用略亮纸面，分析依靠分隔线而非浮动卡片表达相邻关系。主按钮继承现有应用的小幅阴影。

## Shapes

界面以直线、矩形航道和细边框为骨架。交互控件采用温和的 9–12px 圆角，状态标签更紧凑；圆形仅用于雷达品牌标记、连接灯和开关滑块。预警浮标使用旋转方形，实时船位使用裁切船形/箭头，使关键状态即使失去颜色仍可区分。

钱包表面实际使用紧凑的查询面板（12px 圆角）、地址输入与主按钮（8px 圆角）、可选择仓位行（10px 圆角）和状态标签（5px 圆角）。这些容器只组织查询与选择，不将整页扩展为卡片墙。

## Components

### Buttons

- **Shape:** 温和圆角（12px），最小高度 44px。
- **Primary:** 深墨底、白字、水平内边距 16px；保存按钮占满抽屉宽度。
- **Hover / Focus:** 悬停切换为海图绿；键盘焦点使用 3px 半透明海绿外轮廓并偏移 2px。
- **Utility:** 透明底与测绘线描边，44px 点击区域；危险按钮仅文字和图标变为警戒红。

### Chips

- **Style:** 5px 小圆角、紧凑内边距；正常状态使用浅海航道，报警状态使用浅红浅滩。
- **State:** 标签必须包含“区间内”“等待行情”“上限预警”等文字，不以色块代替含义。

### Cards / Containers

- **Corner Style:** 数据区不使用卡片圆角；面板和清单依靠直线分区。
- **Background:** 主表面为浅航海纸，配置抽屉使用略亮纸色。
- **Shadow Strategy:** 只有配置抽屉可使用抽屉投影。
- **Border:** 关键边界为深墨 1px，次级分隔为测绘线 1px。
- **Internal Padding:** 工作区使用 18–24px 的基础节奏，主段落可扩展到 42px 以上。

### Inputs / Fields

- **Style:** 透明背景、1px 测绘线、9px 圆角、44px 高。
- **Focus:** 3px 半透明海绿外轮廓，不能仅改变边框颜色。
- **Error / Disabled:** 错误说明使用警戒红与浅红背景；禁用主要按钮降低不透明度并保留文字。

### Navigation

顶部导航固定在视口，品牌像设备铭牌。主工作区只有策略 Agent，使用完整可用宽度，不保留左侧模块导航或其移动端轨道。独立 NFT 查询、监控详情和钱包页面不再提供入口。顶栏保留刷新与设置，当前连接状态可在窄屏省略但不能移除设置能力。Agent 内的 LP 选择列表继续使用海绿描边和浅青底表达选中状态。

### Price Corridor

价格航道是系统签名组件：矩形海绿区表示有效 LP 区间，浅红两端表示接近预警的浅滩，可拖动虚线浮标表示报警线，垂直船位/箭头表示实时价格。浮标需要提供大于线宽的拖动热区、方向键微调、保存状态反馈和防交叉约束。所有位置标记同时有文字标签与数值；超界、无行情和已报警状态必须在航道之外另有可读说明。

### Wallet Address Query

明确标注“钱包地址”，输入与帮助文字建立关联；无效地址以文字错误和无效状态标识。页面恢复保存地址后仍等待用户点击查询。查询中主按钮变成“停止查询”，地址保存或读取失败使用可恢复提示，查询仍可继续。清除操作删除本机偏好并清空当前结果，不伪装成钱包解绑。

### Wallet Source Progress and LP Selection

每个来源独立展示网络、协议以及“待查询”“读取中”“已完成”“已返回 · 有提示”“未完成”或“暂不可用”。后两者提供来源重试；来源详情收在“查询范围与来源提示”中。停止后保留已返回结果，并在汇总中表达不完整；空结果同时提示核对筛选和来源状态。

仓位行通过海绿边框、浅选中底和 `aria-pressed` 共同表达选择。每行保留交易对、来源、NFT 或普通 LP 份额身份、数量和状态；只有官方合约目录核验通过时展示股票代币标签。网络与股票筛选不把同符号代币误当成同一资产。悬停仅改变边框和背景（0.18s ease-out），减少动态偏好下取消过渡。

### Wallet AI Analysis

未选仓位时显示分析用途与三步说明。选中后先展示链上核验链接、状态、池价、可用区间与本金估值、快照区块和链上时间，再提供全宽“获取 AI 优化建议”。旁边的披露说明点击后发送哪些快照事实及不会触发交易。

AI 服务检查中、不可用及可重试状态分别有文字说明；分析中主按钮禁用并显示当前仓位进度，切换查看其他仓位时说明另一个仓位正在分析。加载骨架搭配状态文案；错误用警戒红和警告图标表达。结果按建议方向、判断依据、需要留意、下一步与依据区块排列，重取建议仍需显式点击。结果与发现过程独立，不能用规则输出补成模型成功。

高级事件控制台默认折叠，展开后才加载；保留“高级：事件观察与成本演练”的完整入口名称和加载反馈。

### Wallet Daily Range Activity

每日有效区间是钱包分析区内的平面时间图，沿用系统无衬线字体与等宽数字。标题采用 14px、650 字重与 1.5 行高，轴与图例为 10px，日期、占比、明细与说明为 11px。明细与说明使用 1.8 行高。日期、时间带与占比组成三列，宽度分别为 38px、弹性宽度与 44px，间距为 8px。整行按钮在桌面的最小高度为 34px，700px 及以下为 44px。时间带高 18px，行、时间带与图例色键的圆角分别为 4px、2px、1px。局部密度与几何规格随该图表维护。

区间内沿用海图绿，区间外沿用警戒红；历史缺口使用斜线纹理（浅底 #f5f5f2、线色 #92928a），未持仓与未来时段分别使用中性填色（#c8c8c0 / #f0f0ec）。五种状态均保留文字图例。所选日期采用浅海航道底色与按下语义，键盘焦点使用（2px）海绿轮廓；点击日期更新其有效、区间外、缺口及适用的未持仓、未到时间明细。

**The Range Activity Full-Day Band Rule.** 每行始终覆盖北京时间的完整 24 小时，以 0 / 6 / 12 / 18 / 24 刻度对齐。未持仓、缺口和未来时段保留在时间带中。每日有效占比为区间内时长除以 24 小时。有事件回填时标题显示“快照 + 事件 · 北京时间”，其余显示“采样估算 · 北京时间”。

数据优先采用 Revert 历史和有效当前快照，相邻观测沿用前一条状态，超过三小时及首尾未知时段先记为缺口。仅以校验通过的池价与 NFT 流动性回放补齐未知时段，原有采样时段保留估算误差。日期明细显示历史覆盖率和事件校准时长，覆盖率按当天已发生时段中已知状态的比例计算，包含快照与事件并排除未来时段。Revert 观测数和读取时间、链上回放截至时间分行展示。

## Do's and Don'ts

### Do:

- **Do** 在首屏明确展示“真实公开行情”“模拟资产构成”“本地报警执行”。
- **Do** 把 LP 区间画成可读航道，并让实时船位、预警浮标拥有不同形状和文字。
- **Do** 用深墨线和纸色层次组织高密度信息，用海绿表达正常数据活动。
- **Do** 在 320px 起的窄屏保留地址查仓、报警设置和完整配置字段。
- **Do** 为键盘焦点、错误、加载、离线和报警提供非颜色线索。
- **Do** 在钱包表面保留来源、事实和披露的 12px 字号，以及建议正文的 13px 字号；用独立状态解释部分成功。
- **Do** 让手机上的仓位选择聚焦并滚动到分析区，同时保留查询与分析两个显式操作。

### Don't:

- **Don't** 暗示连接钱包、控制真实资产、执行链上交易或展示未经支持的收益。
- **Don't** 把界面改成霓虹加密交易终端、玻璃拟态卡片墙或多色行情热图。
- **Don't** 用警戒红装饰普通 CTA、正常数据或品牌元素。
- **Don't** 在移动端删除设置能力，或让抽屉宽于视口。
- **Don't** 仅用绿/红区分安全与危险；始终搭配文字、图标或形状。
- **Don't** 在钱包表面把停止、不可用或有提示的来源显示成完整查询成功，或把无返回解释为没有持仓。
- **Don't** 将本机 Codex 调用称为离线 AI，或把建议表面画成自动执行、签名或收益承诺。
