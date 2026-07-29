# 糖猫桌宠

使用 Electron 开发的 Windows 糖猫桌宠。

当前仓库正在基于第一版技术样机开发第二版。已经确认的产品行为与实现目标记录在 [桌宠规则.md](./docs/桌宠规则.md) 中，第二版实现以该文档为准。

本仓库只跟踪源代码和文档，不上传角色图片、GIF、生成图标、安装包或便携版 EXE。

## 目录结构

```text
.
├─ assets/
│  ├─ README.md            素材目录说明
│  ├─ local/               本地原始素材，不进入 Git
│  │  ├─ 糖猫合集/
│  │  └─ 日常与悬停/
│  └─ generated/           处理后的素材副本，不进入 Git
├─ docs/                 第二版行为规则
├─ scripts/              构建与素材处理脚本
├─ src/                  Electron 应用源码
├─ tests/                检查与测试
├─ package.json
└─ package-lock.json
```

第一版源码保留在 Git 历史提交 `d5c42d1` 中。

## 本地运行

需要 Node.js 22 或更高版本。

```powershell
npm install
npm start
```

基础源码检查：

```powershell
npm run check
```

准备本地素材后，可以额外检查素材引用：

```powershell
npm run check:assets
```

## 打包为 Windows 单文件程序

```powershell
npm run dist
```

生成结果位于 `release` 文件夹。

## 素材说明

原始素材放在 `assets/local/`，只在本地使用。程序只读取原素材，所有尺寸归一化、图标生成和其他处理都写入 `assets/generated/` 等副本目录，不修改原始图片。
