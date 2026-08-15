# 糖猫桌宠

糖猫桌宠是一个运行在 Windows 上的 Electron 桌面宠物。它会待在桌面边缘，随机切换表情和动作，也会回应悬停、点击、拖拽与鼠标玩耍。程序没有语音、音效、任务提醒或养成系统，只负责安静地陪着你。

当前版本为 `v0.3.0`。

## 功能

- 随机日常状态、悬停表情、静态动作和 GIF 动作
- 迈步、跳跳和跑动，支持水平与垂直移动
- 单击、双击、拖拽、投掷和 90 秒鼠标玩耍
- 安静、默认、活泼三种性格
- 根据时间、系统空闲和操作活跃度调整自动行为
- 多显示器边界处理和全屏应用自动隐藏
- 系统托盘、鼠标穿透、大小调整和临时暂停
- 完全静音，严格单实例运行

具体的概率、速度、时长和交互优先级见[桌宠规则](./docs/桌宠规则.md)。

## 环境要求

- Windows 10 或 Windows 11
- Node.js 22.12.0 或更高版本
- Python 3.10 或更高版本

安装依赖：

```powershell
python -m pip install -r requirements.txt
npm ci
```

## 准备素材

仓库不包含角色图片和 GIF。运行项目之前，需要按 [assets/catalog.json](./assets/catalog.json) 中的语义 ID 准备本地素材：

```text
assets/local/
├─ static/<asset-id>.png
└─ animated/<asset-id>.gif
```

素材用途不由目录或文件名推断。日常、普通动作、移动和特殊行为都在 `assets/catalog.json` 中声明，同一份素材可以承担多个角色。

完整的命名和生成规则见[素材目录说明](./assets/README.md)。`assets/local/` 不进入版本控制；缺少素材时，生成、测试和启动会直接失败。

## 运行

```powershell
npm start
```

启动前会根据素材清单重建 `assets/generated/`，随后打开桌宠。项目使用严格单实例；如果糖猫已经在运行，新进程会直接退出。

常用操作：

- 悬停：切换当前日常状态对应的表情
- 单击：随机播放一个普通动作
- 双击：随机播放一个 GIF 动作
- 拖拽：移动糖猫；快速甩出会进入投掷
- 右键：随机动作、移动、玩耍、暂停、调整大小、隐藏或退出
- 托盘：管理环境感知、鼠标穿透、性格和显示状态

## 开发

| 命令 | 用途 |
|---|---|
| `npm run check` | 检查源码和构建脚本 |
| `npm test` | 重新生成素材并运行单元测试 |
| `npm run start:smoke` | 启动真实 Electron 窗口进行自动冒烟测试 |
| `npm run catalog:assets` | 生成素材尺寸目录图 |
| `npm run docs:dialogue` | 根据源码更新气泡文案文档 |

运行 `npm run start:smoke` 前，请先从托盘退出正在运行的糖猫。测试截图保存在 `build/smoke-test/`，素材目录图保存在 `build/asset-catalog/`；这些目录都不会提交到仓库。

主要代码分工：

| 路径 | 内容 |
|---|---|
| `src/main.js` | Electron 主进程、窗口、托盘和系统状态 |
| `src/renderer.js` | 桌宠状态机、动画和鼠标交互 |
| `src/core.js` | 可独立测试的计时与运动算法 |
| `src/dialogue.js` | 启动和普通动作气泡文案 |
| `assets/catalog.json` | 素材 ID、角色、移动规则和显示倍率 |
| `scripts/prepare_assets.py` | 生成运行时素材、GIF 帧和碰撞信息 |
| `tests/` | 核心逻辑、文案、素材协议和资源格式测试 |

开发约定见 [AGENTS.md](./AGENTS.md)，文档之间的权威顺序见[项目文档索引](./docs/README.md)。

## 构建

生成 Windows x64 单文件便携版：

```powershell
npm run dist
```

成品输出到 `release/糖猫桌宠-0.3.0.exe`，同时生成 SHA-256 校验文件。构建会检查源码与测试，整理运行时资源，并验证最终包的文件范围和 Electron 安全配置。

`release/` 不进入版本控制。当前没有配置商业代码签名证书，因此 Windows 可能显示“未知发布者”。

## 素材与许可

角色图片、GIF 和生成素材不随仓库发布，也不因代码公开而获得授权。正式包只包含运行所需的资源副本；具体处理方式见[素材目录说明](./assets/README.md)。

项目目前在 `package.json` 中标记为 `UNLICENSED`，尚未选择开源许可证。在许可证落地之前，仓库内容不能视为已经获得开源使用、修改或再分发授权。
