# 糖猫桌宠

糖猫桌宠是一个使用 Electron 开发的 Windows 桌面宠物。它会在桌面边缘随机待机、播放动作和移动，并响应悬停、点击、拖拽与鼠标玩耍。程序完全静音，不包含任务提醒、养成数值或其他工具功能。

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

## 源码与素材

仓库公开应用源码、测试、构建脚本和语义化素材清单，不包含糖猫角色图片、GIF、图标、生成素材或正式发布包。

`assets/catalog.json` 是代码与素材之间的协议。素材以语义 ID 引用，物理目录只区分 PNG 和 GIF，不按日常、动作或特殊行为重复存放。同一素材可以承担多个角色。

为了让仓库在没有真实素材时仍可运行和测试，项目提供确定性的几何占位素材生成器。占位图只用于开发验证，不包含或模仿糖猫角色内容。

## 快速开始

环境要求：

- Windows 10 或 Windows 11
- Node.js 22.12.0 或更高版本
- Python 3.10 或更高版本

克隆仓库并进入项目目录：

```powershell
git clone https://github.com/WalnuTpz/touneko-desktop-pet.git
cd touneko-desktop-pet
```

安装依赖：

```powershell
python -m pip install -r requirements.txt
npm ci
```

生成占位素材并启动桌宠：

```powershell
npm run demo:assets
npm start
```

`npm run demo:assets` 只会创建或更新由该命令生成的 `assets/local/`。如果目录中已经存在自行准备的真实素材，命令会停止，不会覆盖它们。需要同时执行完整测试时，运行 `npm run test:demo`。

## 使用自己的素材

按照 `assets/catalog.json` 中声明的 ID 准备文件：

```text
assets/local/
├─ static/<asset-id>.png
└─ animated/<asset-id>.gif
```

然后运行：

```powershell
npm run prepare:assets
npm test
npm start
```

素材生成、缩放和角色映射规则见[素材目录说明](./assets/README.md)。

## 开发与验证

| 命令 | 用途 |
|---|---|
| `npm run check` | 检查 JavaScript 与 Python 源码语法 |
| `npm test` | 使用 `assets/local/` 生成运行时素材并执行测试 |
| `npm run test:demo` | 生成几何占位素材并执行完整测试 |
| `npm run start:smoke` | 启动真实 Electron 窗口进行自动冒烟测试 |
| `npm run catalog:assets` | 生成素材尺寸目录图 |
| `npm run dist` | 构建 Windows x64 单文件便携版 |

主要模块：

| 路径 | 内容 |
|---|---|
| `src/main.js` | Electron 主进程、窗口、托盘和系统状态 |
| `src/renderer.js` | 桌宠状态机、动画和鼠标交互 |
| `src/core.js` | 可独立测试的计时与运动算法 |
| `src/dialogue.js` | 启动和普通动作气泡文案 |
| `assets/catalog.json` | 素材 ID、角色、移动规则和显示倍率 |
| `scripts/prepare_assets.py` | 生成运行时素材、GIF 帧和碰撞信息 |
| `tests/` | 核心逻辑、文案、素材协议和资源格式测试 |

运行真实窗口测试前，请先从托盘退出正在运行的糖猫。测试截图、生成素材、构建目录和 EXE 都由 `.gitignore` 排除。

## 构建

准备完整素材后运行：

```powershell
npm run dist
```

成品输出到 `release/糖猫桌宠-0.3.0.exe`，同时生成 SHA-256 校验文件。项目没有配置商业代码签名证书，因此 Windows 可能显示“未知发布者”。

## 使用说明

本仓库未附带开源许可证，`package.json` 标记为 `UNLICENSED`。公开源码仅供查看和参考，不表示已经授予使用、修改或再分发许可。糖猫角色素材及正式发布包不属于本仓库内容。
