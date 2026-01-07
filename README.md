# leafer-canvas-player

基于 `leafer-editor` 的 Canvas 视频播放器组件：用 `<video>` 作为“解码器 + 帧源”，每一帧绘制到 Leafer `Canvas` 上。这样视频就可以像普通 Leafer 节点一样被布局/缩放/裁切/叠加 UI。

## 特性

- **Leafer 节点化**：`VideoPlayer` 继承自 `Box`，可直接加入你的 Leafer 场景树。
- **内置 UI**：中心播放/暂停/加载态，底部进度条、时间、下载、全屏按钮。
- **可配置**：封面图、缩放模式、进度条样式/布局、底部控制条整体开关。
- **TypeScript**：导出 `Config` 类型与 `d.ts`。

## 安装

```bash
npm i leafer-canvas-player
```

本包依赖以下 **peerDependencies**（请在你的项目中自行安装）：

- `leafer-editor`
- `@leafer-in/flow`

## 快速开始

### 1) 创建播放器并加入 Leafer 场景树

`VideoPlayer` 是 Leafer 的 `Box` 子类，你可以把它 `add` 到任意容器（如 App 的根节点 / Group / Box）中。

```ts
import { VideoPlayer } from "leafer-canvas-player";

const player = new VideoPlayer({
  // 必填
  width: 640,
  height: 360,
  src: "https://example.com/video.mp4",

  // 可选
  poster: "https://example.com/poster.jpg",
  resizeMode: "contain",

  onPlay: () => console.log("play"),
  onPause: () => console.log("pause"),
  onTimeUpdate: (t) => console.log("time", t),
  onEnded: () => console.log("ended"),
  onFullScreen: () => {
    // 这里仅提供回调，你可以在外部实现全屏逻辑（例如把外层容器 requestFullscreen）
  }
});

// 伪代码：将 player 加入你的 Leafer 场景树（按你项目里实际的容器 API 来）
// app.tree.add(player) / group.add(player) / box.add(player) ...
```

![Preview](https://github.com/rideWind97/leafer-player/blob/master/assets/player.gif)

### 2) 播放控制（可选）

```ts
player.play();
player.pause();

// 隐藏/显示底部控制条（进度条/时间/下载/全屏/底部播放暂停）
player.setControlsVisible(false);
```

### 3) 释放资源（推荐）

当你不再需要该实例时调用：

```ts
player.destroy();
```

---

## 支持项目

如果这个项目对你有帮助，欢迎在 GitHub 上点个 **Star** 支持一下，让我知道它值得继续维护与完善 🙂

## API

### 导出

```ts
import { VideoPlayer } from "leafer-canvas-player";
import type { Config } from "leafer-canvas-player";
```

### `new VideoPlayer(config: Config)`

`Config` = 业务参数 + Leafer `Box` 输入参数（`IBoxInputData`，但 `width/height` 由本组件强制要求传入）。

#### 参数总览（字段级说明 + 默认值）

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `width` | `number` | 是 | - | 播放器宽度（像素） |
| `height` | `number` | 是 | - | 播放器高度（像素） |
| `src` | `string` | 是 | - | 视频 URL |
| `poster` | `string` | 否 | - | 封面图 URL。传了会作为初始画面（Canvas fill image）；不传则会在 metadata 就绪后尝试渲染一帧作为封面。 |
| `resizeMode` | `"cover" \| "contain"` | 否 | `"contain"` | 封面图（`poster`）的适配模式：`cover`=裁切铺满，`contain`=完整显示（letterbox）。 |
| `controlsVisible` | `boolean` | 否 | `true` | 底部控制条总开关：关闭后会隐藏**进度条 / 时间 / 下载 / 全屏 / 底部播放暂停**（中心按钮仍由内部状态机控制）。 |
| `downloadVisible` | `boolean` | 否 | `true` | “下载”按钮（右上角 Download HD）是否显示/可点击。注意：仍会受 `controlsVisible=false` 的总开关影响。 |
| `progressbarHeight` | `number` | 否 | `10` | 兼容旧 API：进度条高度（仅在未提供 `progressbar.height` 时生效）。 |
| `progressbar` | `object` | 否 | - | 进度条高级配置，见下表。 |
| `onPlay` | `() => void` | 否 | - | 视频进入播放态时触发（`video` 的 `play` 事件）。 |
| `onPause` | `() => void` | 否 | - | 视频进入暂停态时触发（`video` 的 `pause` 事件）。 |
| `onTimeUpdate` | `(currentTime: number) => void` | 否 | - | 时间更新（秒）。注意：播放中也会触发；拖动/seek 时也会触发。 |
| `onEnded` | `() => void` | 否 | - | 播放结束时触发。 |
| `onFullScreen` | `() => void` | 否 | - | 点击“全屏”按钮触发（具体全屏行为由你在外部实现）。 |
| `fill` | `string \| object` | 否 | `"#000000"` | 作为播放器容器 `Box` 的底色（不是视频内容）。不传时默认黑底。 |
| `cornerRadius` | `number \| number[]` | 否 | `10` | 播放器容器圆角。 |
| `...IBoxInputData` | - | 否 | - | 其余参数会透传给 `Box`，常用的有 `x/y/scale/rotation/opacity/visible/cursor/...`（具体字段以 `leafer-editor` 的 `IBoxInputData` 为准）。 |

#### `progressbar` 详细参数（字段级说明 + 默认值）

> 说明：进度条的最终可见性/可交互性受三者共同控制：`controlsVisible`、`progressbar.visible`、`progressbar.hittable`。

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `left` | `number` | `45` | 进度条左侧偏移 |
| `right` | `number` | `50` | 进度条右侧偏移 |
| `bottomOffset` | `number` | `40` | 未传 `y` 时，进度条距离底部的偏移 |
| `y` | `number` | - | 进度条 y 绝对定位。传了会覆盖 `bottomOffset` 计算逻辑。 |
| `height` | `number` | `progressbarHeight`（再默认 10） | 进度条高度 |
| `backgroundFill` | `string` | `rgba(255,255,255,0.2)` | 轨道背景色 |
| `progressFill` | `string` | `rgba(255, 255, 255, 0.40)` | 进度填充色 |
| `cornerRadius` | `number` | `6` | 进度条圆角 |
| `backdropFilter` | `string` | `blur(6px)` | 背景滤镜（需要运行环境/渲染层支持） |
| `visible` | `boolean` | `true` | 是否显示进度条（仅进度条本身；不影响时间/下载/全屏） |
| `hittable` | `boolean` | `true` | 是否允许点击跳转（tap-to-seek）。设为 `false` 可禁用交互。 |

#### 参数示例（完整）

```ts
import { VideoPlayer } from "leafer-canvas-player";

const player = new VideoPlayer({
  width: 640,
  height: 360,
  src: "https://example.com/video.mp4",
  poster: "https://example.com/poster.jpg",
  resizeMode: "cover",

  // Box 参数（示例）
  x: 20,
  y: 20,
  cornerRadius: 12,
  fill: "#000",

  controlsVisible: true,
  progressbar: {
    left: 60,
    right: 60,
    bottomOffset: 24,
    height: 8,
    backgroundFill: "rgba(255,255,255,0.18)",
    progressFill: "rgba(255,255,255,0.55)",
    cornerRadius: 999,
    backdropFilter: "blur(8px)",
    visible: true,
    hittable: true
  }
});
```

### 实例方法

- **`play(): void`**：播放（需要浏览器允许；通常要用户手势触发）
- **`pause(): void`**：暂停
- **`setControlsVisible(visible: boolean): void`**：显示/隐藏底部控制条
- **`destroy(): void`**：释放资源（停止 RAF、解绑 video 事件、释放 `<video>`）

### 只读属性

- **`duration: number`**：视频总时长（metadata ready 后才有值）

## 常见问题（非常重要）

### 自动播放策略

大多数浏览器限制自动播放：如果没有用户手势触发，`play()` 可能被拒绝或无效。建议让用户点击播放按钮后再调用 `play()`。

### 跨域（CORS）与 Canvas 绘制限制

本组件会把视频帧绘制到 Canvas 上。若视频是跨域资源，且服务端未配置正确的 CORS 头，浏览器可能：

- 无法绘制/出现黑屏；或
- “污染 Canvas”（tainted），导致后续读取/导出等操作被禁止。

同时，内置“下载”按钮在多数情况下也要求视频资源支持 CORS（`fetch(..., { mode: "cors" })`）。

建议：

- 尽量使用同源资源；或
- 确保视频资源服务端开启 CORS（例如 `Access-Control-Allow-Origin`）。

### SSR / Node

本组件依赖浏览器 DOM（例如 `HTMLVideoElement` / `CanvasRenderingContext2D`），**不支持在 Node/SSR 环境直接运行**。

如果你的项目有 SSR：

- 只在客户端渲染阶段创建 `VideoPlayer`
- 或使用动态导入（按你框架约定）

## 构建与发布（维护者）

### 本地开发

```bash
npm run dev
```

### 构建

```bash
npm run build
```

### 发布

发布前会自动执行（清理 + 构建）：

```bash
npm run prepublishOnly
```

发布流程（示例）：

```bash
npm version patch
npm publish
```

## License

MIT

---

## 欢迎issues

欢迎提交 Issue（Bug/需求/文档改进都可以）。为了更快定位问题，建议在 Issue 中附上：

- 复现步骤（最好有最小可复现示例）
- 预期行为 vs 实际行为
- 运行环境（浏览器/版本、操作系统、`leafer-editor` 版本）
- 相关截图/录屏/报错堆栈


