import {
  Canvas,
  Box,
  Image,
  Text,
  PointerEvent,
  ChildEvent,
  type IUI,
} from "leafer-editor";
import { Flow } from "@leafer-in/flow";

import PlaySvg from "./assets/play.svg";
import PauseSvg from "./assets/pause.svg";
import SpinnerSvg from "./assets/spinner.svg";
import FullScreenSvg from "./assets/full-screen.svg";
import DownloadSvg from "./assets/download.svg";

import type { Callbacks, Config, Layout, Status, VideoInfo } from "./types";
import { CENTER_BTN_SIZE_RATIO } from "./types";
import { downloadVideo, formatTime } from "./utils";

export class VideoPlayer extends Box {
  private src: string;
  private poster?: string;
  private resizeMode: NonNullable<Config["resizeMode"]>;
  /** 底部控制条整体开关 */
  private controlsVisible: boolean;
  /** Top-right download button switch */
  private downloadVisible: boolean;
  private progressbarHeight: number;
  private progressbarOptions: Required<NonNullable<Config["progressbar"]>>;
  private callbacks: Callbacks;

  /**
   * 视频元素（不挂载到 DOM）
   *
   * - 这里只把 `<video>` 当成“解码器 + 帧源”，每一帧用 `drawImage` 绘制到 Leafer `Canvas` 上
   * - 好处：可以把视频当成 Leafer 场景里的一个节点（方便缩放/裁切/叠加 UI）
   * - 注意：不挂 DOM 也能播放/seek，但依赖浏览器的自动播放策略（通常需要用户手势触发 play）
   */
  private videoEl: HTMLVideoElement | null = null;

  /** 视频画布 */
  private canvasEl: Canvas;

  /** 中心播放/暂停/加载态 */
  private playEl: Box;
  private pauseEl: Box;
  private loadingEl: Box;

  /** 底部控制条 */
  private progressBarEl: Box;
  private progressBarInnerEl: Box;
  private controlPlayEl: Box;
  private controlPauseEl: Box;
  private controlDownloadEl: Box;
  private controlFullScreenEl: Image;
  private timeTextEl: Text;

  private videoInfo: VideoInfo = {
    duration: 0,
    videoWidth: 0,
    videoHeight: 0,
    drawPosition: [0, 0, 0, 0],
  };

  private currentTime = 0;
  private rafId: number | null = null;
  private status: Status = "empty";

  // When we pause programmatically to enforce exclusive playback,
  // we may want to avoid triggering external onPause callbacks.
  private suppressOnPauseOnce = false;

  constructor(config: Config) {
    const {
      src,
      poster,
      controlsVisible = true,
      downloadVisible = true,
      progressbarHeight = 10,
      progressbar,
      resizeMode = "contain",
      onPlay,
      onPause,
      onTimeUpdate,
      onEnded,
      onFullScreen,
      cornerRadius = 10,
      fill = "#000000",
      ...boxProps
    } = config;
    super({
      // 默认给一个黑底（也允许外部通过 config.fill 覆盖）
      fill,
      cornerRadius,
      ...boxProps,
    });

    this.src = src;
    this.poster = poster;
    this.controlsVisible = controlsVisible;
    this.downloadVisible = downloadVisible;
    this.progressbarOptions = {
      left: progressbar?.left ?? 45,
      right: progressbar?.right ?? 50,
      bottomOffset: progressbar?.bottomOffset ?? 40,
      y: progressbar?.y ?? NaN,
      height: progressbar?.height ?? progressbarHeight,
      backgroundFill: progressbar?.backgroundFill ?? "rgba(255,255,255,0.2)",
      progressFill:
        progressbar?.progressFill ?? "rgba(255, 255, 255, 0.40)",
      cornerRadius: progressbar?.cornerRadius ?? 6,
      backdropFilter: progressbar?.backdropFilter ?? "blur(6px)",
      visible: progressbar?.visible ?? true,
      hittable: progressbar?.hittable ?? true,
    };
    this.progressbarHeight = this.progressbarOptions.height;
    this.resizeMode = resizeMode;
    this.callbacks = { onPlay, onPause, onTimeUpdate, onEnded, onFullScreen };

    const layout = this.computeLayout();
    this.canvasEl = this.createCanvas(layout);
    this.playEl = this.createCenterPlay(layout);
    this.pauseEl = this.createCenterPause(layout);
    this.loadingEl = this.createCenterLoading(layout);
    this.progressBarInnerEl = this.createProgressInner();
    this.progressBarEl = this.createProgressBar(layout);
    this.controlFullScreenEl = this.createFullScreenBtn(layout);
    this.controlPlayEl = this.createControlPlay(layout);
    this.controlPauseEl = this.createControlPause(layout);
    this.timeTextEl = this.createTimeText(layout);
    this.controlDownloadEl = this.createDownloadBtn(layout);

    this.addMany(
      this.canvasEl,
      this.playEl,
      this.pauseEl,
      this.loadingEl,
      this.progressBarEl,
      this.controlPlayEl,
      this.controlPauseEl,
      this.timeTextEl,
      this.controlDownloadEl,
      this.controlFullScreenEl
    );

    // Apply master visibility switch once all UI nodes are created.
    this.applyBottomControlsVisibility();

    this.bindUIEvents();
    this.bindLifecycle();
  }

  /** 对外：暂停 */
  pause() {
    this.videoEl?.pause();
  }

  /**
   * 对外：静默暂停（不会触发外部 onPause 回调）
   *
   * 用途：例如一个页面同时存在多个 VideoPlayer，希望“只播放一个”，
   * 切换时其它 player 需要 pause，但不希望业务层把它当成用户主动暂停。
   */
  pauseSilently() {
    this.suppressOnPauseOnce = true;
    this.videoEl?.pause();
  }

  /** 对外：播放 */
  play() {
    this.tryPlay();
  }

  /**
   * 对外：控制底部控制条整体显示/隐藏
   *
   * - true: 显示底部控制条（仍会受内部状态机控制 play/pause 切换）
   * - false: 隐藏所有底部控制条元素
   */
  setControlsVisible(visible: boolean) {
    this.controlsVisible = visible;
    this.applyBottomControlsVisibility();
  }

  /** 对外：视频总时长（metadata ready 后才有值） */
  get duration() {
    return this.videoInfo.duration;
  }

  /**
   * 对外：主动释放资源（不强制把节点从 Leafer 树上移除）
   *
   * - 停止 RAF
   * - 移除 video 事件监听
   * - 释放 video 资源引用
   */
  destroy() {
    // Keep current semantics: just release resources; not necessarily remove from tree.
    this.off(ChildEvent.DESTROY);
    this.cleanup();
  }

  // -------------------------
  // Lifecycle
  // -------------------------

  private bindLifecycle() {
    this.once(ChildEvent.MOUNTED, this.initVideoEl);
    this.on(ChildEvent.DESTROY, this.cleanup);
  }

  private initVideoEl = () => {
    const videoEl = document.createElement("video");
    videoEl.preload = "metadata";
    videoEl.src = this.src;

    // 用 addEventListener + 具名 handler，便于 cleanup 中完整解绑
    videoEl.addEventListener("play", this.onVideoPlay);
    videoEl.addEventListener("pause", this.onVideoPause);
    videoEl.addEventListener("timeupdate", this.onVideoTimeUpdate);
    videoEl.addEventListener("loadedmetadata", this.onVideoLoadedMetadata);
    videoEl.addEventListener("ended", this.onVideoEnded);

    this.videoEl = videoEl;
  };

  private cleanup = () => {
    // 先停渲染循环，再释放视频资源，避免 RAF 里访问已释放对象
    this.stopRenderLoop();

    const video = this.videoEl;
    if (video) {
      video.removeEventListener("play", this.onVideoPlay);
      video.removeEventListener("pause", this.onVideoPause);
      video.removeEventListener("timeupdate", this.onVideoTimeUpdate);
      video.removeEventListener("loadedmetadata", this.onVideoLoadedMetadata);
      video.removeEventListener("ended", this.onVideoEnded);

      video.pause();
      video.load();
      video.remove();
    }
    this.videoEl = null;
  };

  // -------------------------
  // Video events
  // -------------------------

  private onVideoPlay = () => {
    // 进入播放态：启动 RAF，持续绘制帧 + 更新进度条
    this.toggleStatus("play");
    this.canvasEl.setAttr("fill", undefined);
    this.startRenderLoop();
    this.callbacks.onPlay?.();
  };

  private onVideoPause = () => {
    // 进入暂停态：停止 RAF（最后一帧保留在 canvas 上）
    this.toggleStatus("pause");
    this.stopRenderLoop();
    if (this.suppressOnPauseOnce) {
      this.suppressOnPauseOnce = false;
      return;
    }
    this.callbacks.onPause?.();
  };

  private onVideoTimeUpdate = (ev: Event) => {
    const t = (ev.target as HTMLVideoElement).currentTime;
    this.currentTime = t;

    // 拖动/seek 时（非播放态）需要刷新画面与进度
    if (this.status !== "play") {
      this.updateProgressBar();
      this.paintToCanvas();
    }
    this.callbacks.onTimeUpdate?.(this.currentTime);
  };

  private onVideoLoadedMetadata = (ev: Event) => {
    const { duration, videoWidth, videoHeight } = ev.target as HTMLVideoElement;

    // metadata ready：可以计算绘制/裁切所需的 drawPosition（用于 drawImage）
    this.videoInfo = {
      duration,
      videoWidth,
      videoHeight,
      drawPosition: this.computeDrawPosition(videoWidth, videoHeight),
    };

    // 如果没有 poster，默认用视频的第一帧（更准确：第一个可解码帧）作为封面
    // 只在初始化阶段（empty）执行，避免影响正常播放/seek。
    if (!this.poster && this.status === "empty") {
      this.renderFirstFrameAsCover();
    }

    // 如果用户先点了播放，metadata 后再继续播放
    if (this.status === "loading") {
      this.tryPlay();
    }
  };

  /**
   * Render a cover frame when no poster is provided.
   *
   * Note: Setting `currentTime = 0` often does not fire `seeked` if it's already 0.
   * We seek to a tiny offset (clamped to duration) to force decode a first frame,
   * then paint it onto the canvas and switch UI to `pause` (show play icon).
   */
  private renderFirstFrameAsCover() {
    if (!this.videoEl || !this.videoInfo.duration) return;

    const maxSafe = Math.max(0, this.videoInfo.duration - 0.001);
    const t = Math.min(0.01, maxSafe); // ~first decodable frame

    this.videoEl.addEventListener(
      "seeked",
      () => {
        this.paintToCanvas();
        // Show play icon + enable progress/time display
        this.toggleStatus("pause");
        this.updateProgressBar();
      },
      { once: true }
    );

    this.videoEl.currentTime = t;
  }

  private onVideoEnded = () => {
    if (!this.videoEl) return;
    this.videoEl.pause();
    this.toggleStatus("pause");
    this.updateProgressBar();
    this.paintToCanvas();
    this.callbacks.onEnded?.();
  };

  // -------------------------
  // UI events
  // -------------------------

  private bindUIEvents() {
    this.playEl.on(PointerEvent.TAP, () => this.tryPlay());
    this.pauseEl.on(PointerEvent.TAP, () => this.videoEl?.pause());
    this.controlPlayEl.on(PointerEvent.TAP, () => this.tryPlay());
    this.controlPauseEl.on(PointerEvent.TAP, () => this.videoEl?.pause());

    // 点击进度条跳转：progressBarEl 必须 hittable=true（在 createProgressBar 里已设置）
    this.progressBarEl.on(PointerEvent.TAP, this.handleSeekByProgressTap);

    this.controlDownloadEl.on(PointerEvent.TAP, (e: PointerEvent) => {
      // 不让事件向上冒泡（避免触发父容器的点击/拖拽逻辑）
      e.stopNow();
      void downloadVideo(this.src);
    });

    this.controlFullScreenEl.on(PointerEvent.TAP, (e: PointerEvent) => {
      // 同样阻止冒泡；进入全屏前先暂停，避免全屏切换过程中的“黑帧/卡顿”
      e.stopNow();
      this.videoEl?.pause();
      this.callbacks.onFullScreen?.();
    });

    // Hover: show/hide pause overlay
    this.on(PointerEvent.ENTER, () => {
      this.pauseEl.setAttr("visible", true);
    });
    this.on(PointerEvent.LEAVE, () => {
      this.pauseEl.setAttr("visible", false);
    });
  }

  private handleSeekByProgressTap = (ev: PointerEvent) => {
    if (!this.videoEl || !this.videoInfo.duration) return;
    const { x: originX, width: barLength } = this.progressBarEl.worldBoxBounds;
    if (!barLength) return;
    const ratio = Math.max(0, Math.min(1, (ev.x - originX) / barLength));
    this.videoEl.currentTime = this.videoInfo.duration * ratio;
  };

  // -------------------------
  // Rendering & layout
  // -------------------------

  private startRenderLoop() {
    this.stopRenderLoop();
    this.rafId = requestAnimationFrame(this.renderTick);
  }

  private stopRenderLoop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private renderTick = () => {
    // 仅在 play 态持续渲染：暂停时不需要占用 RAF
    if (this.status === "play") {
      this.paintToCanvas();
      this.updateProgressBar();
      this.rafId = requestAnimationFrame(this.renderTick);
    } else {
      this.rafId = null;
    }
  };

  private paintToCanvas() {
    if (!this.videoEl) return;
    const [x, y, w, h] = this.videoInfo.drawPosition;
    if (!w || !h) return;
    // drawImage 的裁切/绘制区域来自 computeDrawPosition 的计算结果
    this.canvasEl.context.drawImage(this.videoEl, x, y, w, h);
    this.canvasEl.paint();
  }

  private updateTimeDisplay() {
    if (!this.videoEl || !this.videoInfo.duration) return;
    const current = formatTime(this.videoEl.currentTime);
    const total = formatTime(this.videoInfo.duration);
    this.timeTextEl.text = `${current}  ${total}`;
  }

  private updateProgressBar() {
    if (!this.videoEl || !this.videoInfo.duration) return;
    const ratio = this.videoEl.currentTime / this.videoInfo.duration;
    this.progressBarInnerEl.setAttr(
      "width",
      ratio * (this.progressBarEl.width ?? 0)
    );
    this.updateTimeDisplay();
  }

  private tryPlay() {
    if (!this.videoEl) return;

    // 1) metadata 未就绪：先给 loading 反馈
    if (!this.videoInfo.duration && this.status !== "play") {
      this.toggleStatus("loading");
    }

    // 2) 如果已经播放到结尾（ended 或 currentTime≈duration），直接 play() 往往不会触发 play 事件，
    //    UI 会停留在“播放按钮”，并且会有明显卡顿（浏览器需要先 seek 回去再解码）。
    //    这里显式把时间轴拉回 0，再启动播放。
    const duration = this.videoInfo.duration;
    const isAtEnd =
      this.videoEl.ended ||
      (duration > 0 && this.videoEl.currentTime >= Math.max(0, duration - 0.05));

    if (isAtEnd) {
      // seek 回 0 的瞬间可能会看到“空帧”，用 loading 兜底更平滑
      this.toggleStatus("loading");

      this.videoEl.currentTime = 0;
      this.videoEl.addEventListener(
        "seeked",
        () => {
          // 先绘制第一帧（更平滑），再尝试播放
          this.paintToCanvas();
          void this.videoEl?.play();
        },
        { once: true }
      );
      return;
    }

    void this.videoEl.play();
  }

  private computeDrawPosition(videoWidth: number, videoHeight: number) {
    // NOTE: This keeps the existing behavior (letterbox via expanded canvas),
    // and fixes a typo that was setting canvas width incorrectly.
    const containerW = this.width ?? 0;
    const containerH = this.height ?? 0;
    if (!containerW || !containerH || !videoWidth || !videoHeight) {
      return [0, 0, videoWidth, videoHeight] as [
        number,
        number,
        number,
        number
      ];
    }

    const videoRatio = videoWidth / videoHeight;
    const canvasRatio = containerW / containerH;

    let x = 0;
    let y = 0;
    let newCanvasWidth = videoWidth;
    let newCanvasHeight = videoHeight;

    /**
     * 目标：让“容器宽高比 = 视频显示区域宽高比”，保持视频不变形。
     *
     * 做法：扩展离屏 canvas 的逻辑尺寸（newCanvasWidth/newCanvasHeight），
     * 让它的比例匹配容器，然后用 x/y 偏移把原视频居中放进这个扩展后的画布里。
     *
     * - videoRatio > canvasRatio：视频更“宽”，需要增加画布高度（上下留黑）
     * - videoRatio <= canvasRatio：视频更“窄”，需要增加画布宽度（左右留黑）
     */
    if (videoRatio > canvasRatio) {
      newCanvasHeight = newCanvasWidth / canvasRatio;
      y = (newCanvasHeight - videoHeight) / 2;
    } else {
      newCanvasWidth = newCanvasHeight * canvasRatio;
      x = (newCanvasWidth - videoWidth) / 2;
    }

    this.canvasEl.width = newCanvasWidth;
    this.canvasEl.height = newCanvasHeight;
    this.canvasEl.scale = containerW / newCanvasWidth;

    return [x, y, videoWidth, videoHeight] as [number, number, number, number];
  }

  private setVisibleInteractive(el: IUI, visible: boolean) {
    el.setAttr("opacity", visible ? 1 : 0);
    el.setAttr("hittable", visible);
  }

  private setVisibleWithHittable(el: IUI, visible: boolean, hittable: boolean) {
    el.setAttr("visible", visible);
    el.setAttr("opacity", visible ? 1 : 0);
    el.setAttr("hittable", hittable);
  }

  /**
   * Bottom controls master visibility.
   * This must be re-applied after `toggleStatus`, because status machine may
   * change bottom play/pause visibility.
   */
  private applyBottomControlsVisibility() {
    const on = this.controlsVisible;

    const progressVisible = on && this.progressbarOptions.visible;
    this.setVisibleWithHittable(
      this.progressBarEl,
      progressVisible,
      progressVisible && this.progressbarOptions.hittable
    );

    // time text is display-only (non-interactive)
    this.setVisibleWithHittable(this.timeTextEl, on, false);
    const downloadOn = on && this.downloadVisible;
    this.setVisibleWithHittable(this.controlDownloadEl, downloadOn, downloadOn);
    this.setVisibleWithHittable(this.controlFullScreenEl, on, on);

    // bottom play/pause buttons are controlled by status machine, but must be hidden when master switch is off.
    if (!on) {
      this.setVisibleWithHittable(this.controlPlayEl, false, false);
      this.setVisibleWithHittable(this.controlPauseEl, false, false);
      return;
    }

    // master switch on: ensure they can be rendered; opacity/hittable stays with status machine
    this.controlPlayEl.setAttr("visible", true);
    this.controlPauseEl.setAttr("visible", true);
  }

  private toggleStatus(status: Exclude<Status, "empty">) {
    // 状态机统一控制中心按钮 + 底部按钮的可见性/可交互性
    switch (status) {
      case "loading": {
        this.setVisibleInteractive(this.playEl, false);
        this.setVisibleInteractive(this.pauseEl, false);
        this.setVisibleInteractive(this.loadingEl, true);
        break;
      }
      case "pause": {
        this.setVisibleInteractive(this.playEl, true);
        this.setVisibleInteractive(this.pauseEl, false);
        this.setVisibleInteractive(this.loadingEl, false);
        this.setVisibleInteractive(this.controlPlayEl, true);
        this.setVisibleInteractive(this.controlPauseEl, false);
        break;
      }
      case "play": {
        this.setVisibleInteractive(this.playEl, false);
        this.setVisibleInteractive(this.pauseEl, true);
        this.setVisibleInteractive(this.loadingEl, false);
        this.setVisibleInteractive(this.controlPlayEl, false);
        this.setVisibleInteractive(this.controlPauseEl, true);
        break;
      }
      default: {
        status satisfies never;
      }
    }
    this.status = status;
    this.applyBottomControlsVisibility();
  }

  // -------------------------
  // UI factories
  // -------------------------

  private computeLayout(): Layout {
    const w = this.width ?? 0;
    const h = this.height ?? 0;
    const centerBtnSize = Math.min(w, h) * CENTER_BTN_SIZE_RATIO;
    const centerBtnX = (w - centerBtnSize) / 2;
    const centerBtnY = (h - centerBtnSize) / 2;

    const progressX = this.progressbarOptions.left;
    const progressW = Math.max(0, w - progressX - this.progressbarOptions.right);
    const progressY = Number.isFinite(this.progressbarOptions.y)
      ? this.progressbarOptions.y
      : h - this.progressbarHeight - this.progressbarOptions.bottomOffset;

    const controlBtnSize = 32;
    const controlBtnY =
      progressY - (controlBtnSize - this.progressbarHeight) / 2;

    return {
      w,
      h,
      centerBtnSize,
      centerBtnX,
      centerBtnY,
      progressX,
      progressY,
      progressW,
      controlBtnSize,
      controlBtnY,
    };
  }

  private createCanvas(layout: Layout) {
    return new Canvas({
      x: 0,
      y: 0,
      width: layout.w,
      height: layout.h,
      lazy: true,
      fill: this.poster
        ? {
            type: "image",
            url: this.poster,
            mode: this.resizeMode === "cover" ? "cover" : "fit",
          }
        : undefined,
    });
  }

  private createCenterPlay(layout: Layout) {
    return new Box({
      x: layout.centerBtnX,
      y: layout.centerBtnY,
      width: layout.centerBtnSize,
      height: layout.centerBtnSize,
      cursor: "pointer",
      cornerRadius: 9999,
      hittable: true,
      opacity: 1,
      children: [
        new Image({
          url: PlaySvg,
          width: layout.centerBtnSize,
          height: layout.centerBtnSize,
        }),
      ],
    });
  }

  private createCenterPause(layout: Layout) {
    return new Box({
      x: layout.centerBtnX,
      y: layout.centerBtnY,
      width: layout.centerBtnSize,
      height: layout.centerBtnSize,
      cursor: "pointer",
      cornerRadius: 9999,
      hittable: false,
      opacity: 0,
      children: [
        new Image({
          url: PauseSvg,
          width: layout.centerBtnSize,
          height: layout.centerBtnSize,
        }),
      ],
    });
  }

  private createCenterLoading(layout: Layout) {
    return new Box({
      x: layout.centerBtnX,
      y: layout.centerBtnY,
      width: layout.centerBtnSize,
      height: layout.centerBtnSize,
      hittable: false,
      opacity: 0,
      children: [
        new Image({
          url: SpinnerSvg,
          width: layout.centerBtnSize,
          height: layout.centerBtnSize,
          origin: "center",
          animation: {
            keyframes: [{ rotation: 0 }, { rotation: 360 }],
            duration: 2,
            loop: true,
            easing: "linear",
          },
        }),
      ],
    });
  }

  private createProgressInner() {
    return new Box({
      x: 0,
      y: 0,
      width: 0,
      height: this.progressbarHeight,
      fill: this.progressbarOptions.progressFill,
      cornerRadius: this.progressbarOptions.cornerRadius,
    });
  }

  private createProgressBar(layout: Layout) {
    const visible = this.controlsVisible && this.progressbarOptions.visible;
    const hittable =
      visible && this.controlsVisible && this.progressbarOptions.hittable;
    return new Box({
      x: layout.progressX,
      y: layout.progressY,
      width: layout.progressW,
      height: this.progressbarHeight,
      cursor: "pointer",
      fill: this.progressbarOptions.backgroundFill,
      backdropFilter: this.progressbarOptions.backdropFilter,
      overflow: "hide",
      // Important: must be hittable so tap-to-seek works.
      hittable,
      visible,
      children: [this.progressBarInnerEl],
      cornerRadius: this.progressbarOptions.cornerRadius,
    });
  }

  private createFullScreenBtn(layout: Layout) {
    return new Image({
      url: FullScreenSvg,
      x: layout.w - 40,
      y: layout.h - this.progressbarHeight - 47,
      width: 24,
      height: 24,
      cursor: "pointer",
    });
  }

  private createControlPlay(layout: Layout) {
    return new Box({
      x: 10,
      y: layout.controlBtnY,
      width: layout.controlBtnSize,
      height: layout.controlBtnSize,
      cursor: "pointer",
      hittable: false,
      children: [
        new Image({
          url: PlaySvg,
          width: layout.controlBtnSize,
          height: layout.controlBtnSize,
        }),
      ],
    });
  }

  private createControlPause(layout: Layout) {
    return new Box({
      x: 10,
      y: layout.controlBtnY,
      width: layout.controlBtnSize,
      height: layout.controlBtnSize,
      cursor: "pointer",
      hittable: false,
      opacity: 0,
      children: [
        new Image({
          url: PauseSvg,
          width: layout.controlBtnSize,
          height: layout.controlBtnSize,
        }),
      ],
    });
  }

  private createTimeText(layout: Layout) {
    return new Text({
      x: layout.progressX,
      y: layout.progressY - 20,
      text: "00:00  00:00",
      fill: "#ffffff",
      fontSize: 12,
      fontFamily: "Poppins",
    });
  }

  private createDownloadBtn(layout: Layout) {
    return new Flow({
      x: layout.w - 143,
      y: 16,
      padding: [8, 12],
      fill: "rgba(39, 39, 42, 1)",
      cornerRadius: 8,
      gap: 8,
      flowAlign: "center",
      cursor: "pointer",
      children: [
        new Image({
          url: DownloadSvg,
          width: 16,
          height: 16,
        }),
        new Text({
          ownerId: this.id!,
          text: "Download HD",
          fontSize: 12,
          fontWeight: 500,
          fontFamily: "Poppins",
          fill: "#FAFAFA",
        }),
      ],
    });
  }
}
