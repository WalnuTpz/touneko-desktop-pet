# 糖猫桌宠

一款完全静音、以陪伴和卖萌为目的的 Windows 桌面宠物，使用 Electron 开发。

第二版源码已经进入待验收阶段，产品行为以 [桌宠规则](./docs/桌宠规则.md) 为准。本仓库只跟踪代码和文档，不上传角色图片、GIF、生成素材、图标、安装包或便携版 EXE。

## 当前状态

- 第二版素材池、状态机、动作、移动、交互和系统菜单均已实现。
- 已通过素材清单测试、核心逻辑测试和 Electron 源码冒烟测试。
- 尚未执行第二版的 Git 提交、推送、编译或打包；验收通过前保持这一状态。
- 第一版源码仍保留在 Git 历史提交 `d5c42d1` 中。

## 目录结构

```text
.
├─ assets/
│  ├─ README.md
│  ├─ local/                  本地原始素材，不进入 Git
│  │  ├─ 糖猫合集/
│  │  └─ 日常与悬停/
│  └─ generated/              自动生成的素材副本，不进入 Git
├─ docs/
│  ├─ 桌宠规则.md
│  └─ 验收清单.md
├─ scripts/
│  ├─ prepare_assets.py       素材扫描、配对和副本生成
│  ├─ asset-overrides.json    少量异常素材的显示倍率
│  └─ fullscreen-monitor.ps1  Windows 全屏窗口监测
├─ src/                       Electron 第二版源码
├─ tests/                     核心逻辑与素材清单测试
├─ package.json
└─ requirements.txt
```

## 本地运行

需要：

- Windows 10 或 Windows 11
- Node.js 22 或更高版本
- Python 3
- Pillow

首次运行：

```powershell
python -m pip install -r requirements.txt
npm install
npm start
```

`npm start` 会先扫描 `assets/local/`，重建 `assets/generated/` 中的素材副本和清单，然后启动桌宠。原始图片始终只读。

## 源码测试

```powershell
npm run check
npm test
```

可选的本地素材尺寸目录图：

```powershell
npm run catalog:assets
```

目录图写入 `build/asset-catalog/`，只用于检查不同素材的视觉大小，不进入 Git。

真实窗口冒烟测试会短暂显示桌宠并自动退出：

```powershell
npm run start:smoke
```

## 基本操作

- 鼠标悬停：仅在日常状态触发对应悬停图。
- 单击：按静态图权重为 GIF 两倍的规则抽取普通动作。
- 双击：一定触发 GIF。
- 拖动：移动桌宠；碰到左右边缘时水平翻转。
- 右键：打开桌宠菜单。
- 鼠标穿透后：从系统托盘菜单关闭鼠标穿透。
- 藏起来后：从系统托盘选择“叫糖猫回来”。

## 编译与打包

项目保留了后续编译和 Windows 单文件打包配置，但按当前开发约定，验收通过前不执行这些步骤。
