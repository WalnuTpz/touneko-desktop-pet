# 素材协议

仓库只跟踪素材清单，不发布糖猫角色图片、GIF、图标或生成副本。产品行为以[桌宠规则](../docs/桌宠规则.md)为准，素材角色和倍率以 `catalog.json` 为准。

## 目录

```text
assets/
├─ catalog.json
├─ local/                    本地源素材，不进入版本控制
│  ├─ static/<asset-id>.png
│  └─ animated/<asset-id>.gif
└─ generated/                自动生成，不进入版本控制
   ├─ manifest.json
   ├─ files/
   └─ icons/
```

物理目录只区分文件格式，不表达日常、普通动作或特殊行为。代码和文档使用小写 ASCII 语义 ID；同一素材可以同时承担多个角色，不需要复制文件。

`catalog.json` 声明：

- `staticAssets`、`animatedAssets`：全部源素材；
- `daily`、`actions`、`movement`：日常状态、普通动作和移动行为；
- `throwBehavior`、`playBehavior`、`dragAsset`、`iconAsset`：特殊行为；
- `dialogueAliases`：共用气泡文案的动作映射；
- `scaleMultipliers`：需要单独调整的显示倍率。

## 准备真实素材

将文件放入 `assets/local/static/` 或 `assets/local/animated/`，然后运行：

```powershell
npm run prepare:assets
npm test
```

生成器不会扫描目录猜测用途。缺少声明文件、引用不存在的 ID、ID 重复或源素材内容重复时会直接失败。

原始素材保持只读。缩放、GIF 拆帧、碰撞信息和多 DPI 图标都写入 `assets/generated/`；该目录每次生成时重建。

## 演示素材

没有真实素材时可以生成非角色化的几何占位图：

```powershell
npm run test:demo
```

生成器会在 `assets/local/.demo-assets` 留下标记，只会重建带有该标记的目录。如果 `assets/local/` 已包含自行准备的素材，命令会停止，不会覆盖文件。

占位素材用于验证清单、生成管线和运行时，不用于视觉验收，也不属于糖猫角色素材。

## 构建边界

`npm run dist` 只收集运行时清单实际引用的资源，并将页面、清单和图片写入加密资源包。应用图标仍需由 Windows 直接读取。该处理只能提高随手提取素材的门槛，不能保证离线客户端不可逆向。

`assets/local/`、`assets/generated/` 和 `assets/generated-staging/` 均由 `.gitignore` 排除。
