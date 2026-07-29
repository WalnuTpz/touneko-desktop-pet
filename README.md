# 糖猫桌宠

糖猫桌宠的第一版技术样机。它使用 Electron 创建透明、无边框、始终置顶的 Windows 桌宠窗口。

本仓库只保存源代码，不包含角色图片、GIF、安装包或便携版 EXE。

## 第一版功能

- 透明、无边框、始终置顶
- 鼠标拖动桌宠
- 单击、双击互动
- 随机静态表情和 GIF 动作
- 偶尔沿屏幕底部散步
- 桌宠右键菜单与系统托盘菜单
- 自动散步、鼠标穿透和置顶开关
- 80%、100%、125%、150% 四档大小
- 自动保存位置和设置

## 项目结构

```text
.
├─ src/                  Electron 主进程、预加载与界面代码
├─ scripts/              图标生成脚本
├─ tests/                语法和素材引用检查
├─ package.json          项目配置与运行命令
└─ package-lock.json     依赖锁定文件
```

## 准备本地素材

程序需要在项目根目录存在 `糖猫合集` 文件夹。素材未提交到仓库，请自行准备具有使用权的图片，并保持第一版源码引用的文件名和目录结构。

第一版直接使用以下类型的路径：

```text
糖猫合集/站.png
糖猫合集/跑.png
糖猫合集/坐.png
糖猫合集/趴1.png
糖猫合集/动图/跳跳.gif
糖猫合集/动图/伸手.gif
...
```

完整引用可以在 `src/renderer.js` 中查看，也可以通过检查命令验证。

## 安装与运行

需要 Node.js 和 npm：

```powershell
npm install
npm start
```

## 检查

```powershell
npm run check
```

该命令检查 JavaScript 语法，不需要本地素材。准备素材后，可以额外检查所有素材引用：

```powershell
npm run check:assets
```

## 本地打包

仓库不提供安装包。需要自行打包时，先安装 Python 与 Pillow，并准备本地素材：

```powershell
python -m pip install pillow
npm run dist
```

生成结果位于本地 `release` 文件夹，该文件夹默认不会被 Git 跟踪。

## 操作

- 拖动：移动桌宠
- 单击：随机互动
- 双击：跳跳
- 右键：打开桌宠菜单
- 鼠标穿透后：双击系统托盘中的糖猫图标恢复操作
