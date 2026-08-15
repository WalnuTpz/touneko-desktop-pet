# 糖猫桌宠

一款完全静音、以陪伴和卖萌为目的的 Windows 桌面宠物，使用 Electron 开发。

`v0.3.0` 是当前第三版源码。本仓库只发布代码和文档，不包含角色图片、GIF、生成素材、图标、安装包或便携版 EXE。产品行为以 [桌宠规则](./docs/桌宠规则.md) 为准；文档分类、维护方式和发布边界见[项目文档索引](./docs/README.md)。

## 文档导航

- [桌宠规则](./docs/桌宠规则.md)：当前版本唯一正式行为规格。
- [气泡文案](./docs/气泡文案.md)：由源码和当前素材清单生成的文案目录。
- [版本记录](./docs/README.md#文档导航)：第一版、第二版和第三版的历史变化。
- [素材目录说明](./assets/README.md)：本地素材与生成副本的维护规则。
- [演示脚本](./docs/演示脚本.md)：内部功能录制执行稿，不属于产品规格。

## 主要功能

- 随机日常状态，以及按日常状态配对的悬停表情和轻微悬停动效。
- 静态图片、GIF，以及有完整帧循环和严格速度差异的迈步、跳跳、跑动。
- 可立即替换普通 GIF 的单击、只触发 GIF 的双击、最高 3000 像素/秒的拖拽投掷，以及仅从桌宠右键菜单开始的 90 秒鼠标玩耍。
- 按时间、系统空闲和活动程度调整自动动作权重，并提供安静、默认、活泼三种性格。
- 鼠标穿透、大小调整，以及仅持久保存性格和环境感知的轻量设置。
- 按素材不透明区域计算的悬停命中区域、定向微调的素材显示尺寸和逐帧碰撞箱。
- 多显示器活动范围、屏幕边缘反弹，以及全屏应用自动隐藏与恢复。
- 严格单实例、手动启动和完全静音。

## 准备本地素材

本仓库不发布糖猫原始素材。运行源码前，需要自行准备以下两个目录：

```text
assets/local/
├─ 糖猫合集/
└─ 日常与悬停/
```

素材的配对、排除和生成规则见 [assets/README.md](./assets/README.md)。缺少本地素材时，素材准备、测试和程序启动都会失败。

素材管线只读取原始文件。运行时使用的副本、GIF 帧、碰撞信息和图标均生成到 `assets/generated/`，不会修改原素材。

## 环境要求

- Windows 10 或 Windows 11
- Node.js 22.12.0 或更高版本
- Python 3.10 或更高版本

## 安装与运行

首次安装依赖：

```powershell
python -m pip install -r requirements.txt
npm ci
```

启动桌宠：

```powershell
npm start
```

`npm start` 会先扫描 `assets/local/`，重建 `assets/generated/`，然后启动桌宠。

## 验证源码

按以下顺序执行：

```powershell
npm run check
npm test
npm run start:smoke
```

- `npm run check` 检查 JavaScript 源码和构建脚本语法，并校验 Codex 桌宠图集配置及源帧。
- `npm test` 重建素材副本，并运行核心逻辑、文案、素材清单和加密资源格式测试。
- `npm run start:smoke` 启动真实 Electron 窗口进行自动冒烟测试，截图写入 `build/smoke-test/`，完成后自动退出。

运行冒烟测试前，需要先从系统托盘完全退出正在运行的糖猫。由于程序使用严格单实例，已有实例未退出时，新的测试进程会直接静默结束。

生成用于人工复核素材尺寸的目录图：

```powershell
npm run catalog:assets
```

请先运行 `npm test` 或 `npm run prepare:assets`。目录图写入 `build/asset-catalog/`，不进入版本控制。

修改 `src/dialogue.js` 中的文案后，可同步生成文案文档：

```powershell
npm run docs:dialogue
```

## 生成 Codex 桌宠图集

本地辅助工具可以从指定的原始 PNG/GIF 帧生成固定布局的 Codex 桌宠图集：

```powershell
npm run pet:codex
```

默认输出到 `output/codex-pet/tangmao-strict/`，包括逐帧文件、PNG/WebP 图集、可导入包和来源映射。该目录由 `.gitignore` 排除，不属于 Windows 桌宠运行时或便携版。`npm run check` 只校验配置和源帧，不写入这些生成物。

## 构建便携版

生成 Windows x64 单文件便携版：

```powershell
npm run dist
```

成品写入 `release/糖猫桌宠-0.3.0.exe`，SHA-256 写入同名的 `.sha256.txt`。构建流程会自动执行以下处理：

- 将主进程和预加载代码打包、压缩并适度混淆，不携带原始源码目录或 source map。
- 只收集运行时实际引用的图片、GIF 帧和托盘图标，删除素材来源路径、内容哈希等非运行字段。
- 使用每次构建随机生成的 AES-256-GCM 密钥加密资源包；运行时一次解密到内存，不主动写出明文图片。
- 通过同源内部协议加载页面和图片，保留透明像素命中检测。
- 启用 ASAR 完整性和 Electron Fuses，禁止常见的调试参数、Node 模式和 ASAR 替换。
- 包内应用元数据保留运行需要的字段和作者名 `Walnut`，不包含仓库地址、主页、问题地址或贡献者列表。
- 检查正式包文件白名单、资源加密状态和 Fuses 后才算构建成功。

这些措施用于防止随手提取，并不能让离线客户端绝对不可逆向；解密能力仍随程序存在，EXE 内嵌应用图标也必须能被 Windows 直接读取。便携版是 NSIS 自解压程序，压缩软件能够查看其外层内容属于正常现象。它每次启动前都会解压 Electron 运行环境，速度会比 `release/win-unpacked/糖猫桌宠.exe` 慢；后者只适合本机测试，不是单文件分享成品。

当前项目没有配置商业 Authenticode 证书，朋友首次运行时可能看到 Windows 的“未知发布者”提醒。代码仓库仍然只发布源码和文档，`release/` 继续由 `.gitignore` 排除。

## 基本操作

- 鼠标悬停：仅在日常状态触发对应的随机悬停图。
- 单击：从普通动作池抽取动作；每张静态图片的权重是每个 GIF 的两倍，普通 GIF 播放中也会在单双击判定完成后立即换成新动作。
- 双击：一定触发 GIF，不会先播放单击动作。
- 拖动：超过阈值后显示倒立表情；慢速放下进入新日常，快速甩出后以最高 3000 像素/秒的初速度按二维惯性飞行、反弹并显示落地反馈。
- 右键：打开桌宠菜单，可触发随机动作、移动、90 秒玩耍、暂停、大小调整、隐藏或退出。
- 系统托盘：不提供玩耍入口；菜单依次提供暂停、环境感知、鼠标穿透、性格、大小、藏起/叫回和退出，其中鼠标穿透位于性格上方。
- 玩耍：糖猫会朝向、靠近或拍鼠标，并能识别绕圈和定时追逐；拍鼠标选中 `打招呼` 时会单独翻向鼠标，普通动作中的同名素材不受影响。
- 鼠标穿透后：从系统托盘菜单关闭鼠标穿透。
- 藏起来后：从系统托盘选择“叫糖猫回来”。

每个普通动作都会显示一条对应气泡，四条主题文案各有 `25%` 的选择概率。程序不播放任何声音。

## 主要目录

```text
.
├─ assets/
│  ├─ README.md
│  ├─ local/                       本地原始素材，不进入版本控制
│  └─ generated/                   自动生成的运行时素材，不进入版本控制
├─ docs/
│  ├─ README.md                    文档索引、权威顺序与发布边界
│  ├─ 版本记录/
│  │  ├─ v0.1.0.md                第一版技术样机的初始快照
│  │  ├─ v0.2.0.md                第二版相对第一版的变化
│  │  └─ v0.3.0.md                第三版相对第二版的变化
│  ├─ 桌宠规则.md                  正式行为规则
│  ├─ 气泡文案.md                  由源码同步的文案目录
│  └─ 演示脚本.md                  内部功能录制执行稿
├─ scripts/
│  ├─ prepare_assets.py            素材扫描、配对和副本生成
│  ├─ asset-overrides.json         少量异常素材的显示倍率
│  ├─ render_asset_catalog.py      素材尺寸目录图生成
│  ├─ render_dialogue_doc.js       气泡文案文档同步
│  ├─ build_codex_pet.py           Codex 桌宠图集生成与配置检查
│  ├─ build_secure_runtime.js      正式运行资源打包与加密
│  ├─ verify_secure_package.js     便携版内容和安全配置校验
│  ├─ smoke_portable.js            最终便携版自动冒烟测试
│  ├─ make_icon.py                 Windows 图标生成
│  └─ fullscreen-monitor.ps1       Windows 全屏窗口监测
├─ src/                            Electron 应用源码
├─ tests/                          核心逻辑、文案与素材清单测试
├─ package.json
├─ package-lock.json
└─ requirements.txt
```
