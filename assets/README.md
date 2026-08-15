# 素材目录

> 文档性质：当前 `v0.3.0` 素材协议说明；产品行为仍以[桌宠规则](../docs/桌宠规则.md)为准。

本仓库只跟踪素材协议，不发布糖猫原始图片、GIF、生成副本或图标。运行源码前，需要自行准备与 `catalog.json` 对应的本地素材。

## 目录结构

```text
assets/
├─ catalog.json              受版本控制的素材 ID、角色和倍率
├─ README.md
├─ local/                    私有原始素材，不进入版本控制
│  ├─ static/<asset-id>.png
│  └─ animated/<asset-id>.gif
└─ generated/                自动生成，不进入版本控制
   ├─ manifest.json
   ├─ files/
   │  ├─ static/
   │  └─ animated/
   └─ icons/
```

物理目录只区分文件格式，不区分“日常”“普通动作”或“特殊行为”。同一份素材可以同时承担普通动作、拖拽、投掷或玩耍等多个角色，不需要复制文件。

## 语义 ID 与角色清单

素材文件使用小写 ASCII 语义 ID，单词间以连字符分隔，例如 `run-1.png` 和 `movement-jump.gif`。代码、测试和文档引用 ID，不引用原始中文文件名，也不根据文件名猜测用途。

`catalog.json` 是素材协议的唯一来源，其中包括：

- `staticAssets`、`animatedAssets`：本地应存在的全部源素材；
- `daily`、`actions`、`movement`：日常配对、普通动作池和三种移动行为；
- `throwBehavior`、`playBehavior`、`dragAsset`、`iconAsset`：可复用的特殊行为角色；
- `dialogueAliases`：多份动作共用文案时的主题映射；
- `scaleMultipliers`：少量特殊构图的显示倍率。

当前目录包含 136 份静态素材和 21 份动图，共 157 份唯一内容。逻辑角色包含 5 组日常、133 个普通动作和 3 个移动行为；这些数量不对应独立物理目录。

## 添加或调整素材

1. 为新素材确定稳定的语义 ID，放入 `local/static/` 或 `local/animated/`。
2. 在 `catalog.json` 的格式列表中声明 ID，并把它加入所需角色。
3. 只有自动尺寸不合适时，才在 `scaleMultipliers` 中增加单素材倍率。
4. 运行 `npm run prepare:assets` 和 `npm test`；涉及视觉尺寸时再运行 `npm run catalog:assets` 人工复核。

改动用途时只修改角色清单，不移动或复制源文件。已经被代码和文档引用的 ID 不因中文称呼、文件来源或角色变化而随意改名；确需改名时，应一次性同步代码、测试和文档，不保留旧 ID 兼容层。

## 生成运行时素材

安装 Python 依赖后运行：

```powershell
python -m pip install -r requirements.txt
npm run prepare:assets
```

`npm start` 和 `npm test` 也会先执行素材准备。生成器直接读取 `catalog.json`，不会扫描目录推断角色。缺少声明文件、引用不存在的 ID、ID 重复或两份源素材内容完全相同时会明确失败。

每次生成先写入 `assets/generated-staging/`，成功后整体替换 `assets/generated/`。生成结果包括运行时副本、GIF 逐帧数据、真实帧时长、不透明边界、碰撞信息、角色清单和多 DPI 图标。迈步与跑按清单中的静态帧序列播放；生成器不制作新的合成 GIF。

## 尺寸处理

- 根据代表帧的不透明主体衡量大小，保持原始宽高比，不裁切原图。
- 主体高度超出自动参考范围时，以约 190 像素归一化，再应用 `80%` 全局显示倍率。
- GIF 的所有帧使用同一倍率，保留帧时长、循环信息和相对位置。
- 少量长尾、道具或宽构图素材使用 `catalog.json` 中的明确倍率；倍率只作用于生成副本。

## 分享版素材保护

`npm run dist` 不会直接复制 `assets/generated/`：

- 只收集 manifest 实际引用的图片帧和四档托盘图标；
- 正式 manifest 删除本地来源路径、内容哈希、生成时间和统计信息；
- 页面代码、正式 manifest 和素材写入 AES-256-GCM 加密资源包；
- 应用启动后在内存中验证和解密资源，不主动写出明文素材。

Windows 必须直接读取 EXE 内嵌图标，因此应用图标是唯一允许明文提取的私有视觉例外。离线程序仍携带解密能力，这些措施只能提高随手提取的门槛，不能保证素材不可逆向。

## 本地文件边界

`assets/local/`、`assets/generated/` 和 `assets/generated-staging/` 均由 `.gitignore` 排除。原始素材默认只读；缩放、翻转和动画处理只作用于生成副本或运行时画面。
