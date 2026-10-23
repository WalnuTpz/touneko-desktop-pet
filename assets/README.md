# 素材准备与显示尺寸

桌宠使用语义 ID 连接图片与行为。仓库提供 `assets/catalog.json` 中的 ID、角色、移动帧序列和倍率，使用者自行准备 PNG 与 GIF；Python 生成器据此制作运行时文件与 manifest。本文说明如何准备本地素材、调整映射与尺寸，并检查结果。

## 准备本地素材

在项目根目录安装依赖：

```powershell
python -m pip install -r requirements.txt
npm ci
```

创建 `assets/local/static/` 和 `assets/local/animated/`，按 `catalog.json` 中的列表放置文件：

```text
assets/
├─ catalog.json
├─ local/
│  ├─ static/<id>.png
│  └─ animated/<id>.gif
└─ generated/
   ├─ manifest.json
   ├─ files/
   └─ icons/
```

`staticAssets` 中每个 ID 对应一张 PNG，`animatedAssets` 中每个 ID 对应一份 GIF。例如 `stand` 对应 `local/static/stand.png`，`movement-jump` 对应 `local/animated/movement-jump.gif`。当前清单包含 136 份静态素材、21 份动图；角色池包含 5 组日常、133 个普通动作和 3 种移动行为。

每个声明的 ID 都需要对应文件。选图时按角色用途匹配内容，例如站立图用于日常，迈步与跑动的连续姿势用于移动。透明背景决定角色的可见轮廓，生成器与运行时用这条轮廓计算尺寸、鼠标命中和碰撞。当前倍率按既有糖猫素材校准，更换构图后按下文调整倍率并检查显示结果。

准备好文件后运行：

```powershell
npm run prepare:assets
```

成功后终端输出素材统计，`assets/generated/manifest.json` 与运行文件一同更新。`npm start` 和 `npm test` 也会执行这一步。`assets/local/`、`assets/generated/` 与临时的 `assets/generated-staging/` 由 Git 忽略，原始素材保持只读。

执行 `npm start` 即可从源码运行。需要本地 EXE 时，完成素材验证后执行 `npm run dist`，构建会将当前生成素材装入程序。修改本地素材后重新打包，成品才会使用新图片。

## 开发用示例素材

需要先验证环境或运行自动测试时，在一份独立的源码目录中安装依赖，然后执行：

```powershell
npm run demo:assets
npm start
```

生成器按清单创建带有 ID 标识的几何图形，覆盖全部 PNG 与 GIF 槽位。示例使用 `assets/local/.demo-assets` 标记目录；再次运行会重建带标记的目录。已有自备素材的目录保持原样，命令报错退出。

需要生成示例并执行完整测试时运行 `npm run test:demo`。GitHub Actions 使用这条命令验证素材管线和行为。角色外观、构图与动作衔接使用自己的图片在真实窗口验收。

从示例切换到自己的图片时，先将整个 `assets/local/` 示例目录移到项目外保存，再创建新的 `static/` 和 `animated/` 子目录并放入素材，最后执行 `npm start`。

## ID 如何表达用途

ID 由小写 ASCII 字母、数字和连字符组成，使用稳定名称，例如 `run-1`。物理目录区分文件格式，行为角色由清单字段表达：

| 字段 | 含义 |
|---|---|
| `staticAssets`、`animatedAssets` | 所有源素材 ID |
| `daily` | 每种日常的 `idle` 素材与 `hovers` 候选 |
| `actions` | 普通动作池 |
| `movement` | 移动速度、轴、源朝向与动画 |
| `dragAsset`、`throwBehavior`、`playBehavior` | 拖拽、投掷、落地与玩耍角色 |
| `iconAsset` | 应用和托盘图标来源 |
| `dialogueAliases` | 动作 ID 到共用文案主题的映射 |
| `scaleMultipliers` | 指定素材的额外显示倍率 |

同一图片可被多个角色引用。例如 `handstand` 同时用于普通动作和拖拽，源文件保存一份。普通动作 `jump` 与移动动画 `movement-jump` 则是两个独立 ID。

移动中的迈步采用如下结构，数值与当前清单一致：

```json
{
  "speed": 50,
  "axes": ["horizontal", "vertical"],
  "sourceFacing": "right",
  "animation": {
    "type": "sequence",
    "frames": [
      { "asset": "walk-step", "durationMs": 250 },
      { "asset": "walk-leg-lift", "durationMs": 250 }
    ]
  }
}
```

其中 `sourceFacing` 表达原画方向，运行时结合移动方向决定镜像。静态帧序列按声明时长播放；`type: "gif"` 的移动动画使用对应 GIF 的逐帧数据。

## 调整角色或文案映射

1. 在对应格式列表中维护源素材 ID，并把文件放到匹配路径。
2. 在日常、动作、移动或特殊行为字段中设置用途。
3. 普通动作在 `src/dialogue.js` 中需要对应的四条文案；共用主题时通过 `dialogueAliases` 指向已有主题。
4. 运行 `npm test`，核对清单、文案和尺寸测试。
5. 运行 `npm run docs:dialogue`，更新受影响的文案目录。

生成器按清单读取文件。缺少声明文件、重复 ID、未声明的角色引用以及两份内容相同的源文件都会终止生成。角色复用通过引用同一个 ID 完成。

## 如何计算显示尺寸

生成器以 alpha 不低于 8 的像素计算每帧不透明边界。GIF 的代表帧选取边界高度最接近所有帧中位数的一帧；并列时取较早的帧。这个测量包含该帧中的道具和特效。

设代表帧边界高度为 `H`，清单额外倍率为 `M`，用户大小档位为 `U`，显示倍率为：

```text
基础倍率 B = 1                当 180 ≤ H ≤ 200
基础倍率 B = 190 / H          其余情况
素材倍率 displayScale = B × M × 0.8
运行时倍率 = displayScale × U
```

例如边界高度为 300、`M = 1`、用户选择 `100%` 时，显示后的边界高度为 `300 × (190/300) × 0.8 = 152` DIP。保持宽高比，完整画布使用相同倍率。

PNG 原图与 GIF 原文件复制到生成目录，GIF 另外拆成原尺寸 PNG 帧；显示缩放由运行时应用 manifest 中的倍率完成。GIF 所有帧共享倍率，保持动画内部的相对位置。每帧时长读取源 GIF，并以 20 ms 为下限；循环时长等于各帧时长之和。

### 调整一份素材

当道具、长尾或宽构图影响观感时，在 `scaleMultipliers` 中调整该 ID。例如 `run-2` 为 `0.82`，普通动作 `jump` 为 `1.15`，移动的 `movement-jump` 为 `1.1`。

按以下步骤检查修改：

```powershell
npm run prepare:assets
npm run catalog:assets
npm test
```

打开 `build/asset-catalog/` 中的目录图，比较该素材与相邻常规素材的大小，并检查 GIF 各帧是否完整。随后在真实窗口中播放相关动作，检查碰壁、气泡位置和用户 `150%` 档位。自动测试检查画布在 `150%` 大小下仍位于承载窗口范围内；角色间的比例与动画衔接通过目录图和真实窗口确认。

## 替换素材后的构建检查

`npm run dist` 会先执行 `check` 和 `test`。前者检查 JavaScript 与 Python 语法；后者重建素材，再验证行为、文案、素材清单和资源格式。

`tests/manifest.test.js` 检查当前 157 份素材的数量与角色映射，核对源文件内容、逐帧边界、循环时长和图标尺寸，并检查画布在 `150%` 大小下位于承载窗口内。更换图片后运行 `npm test`；改变清单数量时同步更新统计预期。具体构图、角色比例与连续动作的观感通过真实窗口确认。

## 生成结果如何被使用

生成器先写入 `assets/generated-staging/`，完成后替换 `assets/generated/`。manifest 包含每个素材的画布、逐帧文件、边界、时长、显示倍率、角色映射与图标表示。内容哈希用于检测重复源文件，并命名生成文件。

桌宠运行时播放 PNG 帧。开发生成目录另存原 GIF 副本，正式资源包收集实际运行帧和四档托盘图标。图标由 `stand` 生成多尺寸副本，应用图标由构建脚本制成 ICO。

生成 manifest 是运行协议。调整源文件、角色或倍率后，通过生成命令更新它；运行与构建流程读取同一份结果。
