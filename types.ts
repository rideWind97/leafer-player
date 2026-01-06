import type { IBoxInputData } from "leafer-editor";

export const CENTER_BTN_SIZE_RATIO = 0.3;

export type Status = "empty" | "loading" | "play" | "pause";

export type Config = Omit<IBoxInputData, "width" | "height"> & {
  width: number;
  height: number;
  src: string;
  poster?: string;
  resizeMode?: "cover" | "contain";
  /**
   * Download button visibility (top-right "Download HD").
   * - Default: true
   * - Note: still affected by `controlsVisible` master switch.
   */
  downloadVisible?: boolean;
  /**
   * Bottom control bar master switch.
   * - When false: hide ALL bottom controls (progress bar / time / download / fullscreen / bottom play-pause)
   * - Default: true
   */
  controlsVisible?: boolean;
  /**
   * Backward compatible: progress bar height (old API).
   * Prefer `progressbar.height` for new code.
   */
  progressbarHeight?: number;
  /**
   * Progress bar options.
   * - layout: left/right/bottomOffset/y override
   * - style: colors/cornerRadius/backdrop
   * - behavior: visible/hittable
   */
  progressbar?: {
    /** Left offset (default 45) */
    left?: number;
    /** Right offset (default 50) */
    right?: number;
    /** Bottom offset used when `y` is not provided (default 40) */
    bottomOffset?: number;
    /** Absolute y position override */
    y?: number;
    /** Height override (falls back to `progressbarHeight`) */
    height?: number;

    /** Track background fill (default rgba(255,255,255,0.2)) */
    backgroundFill?: string;
    /** Progress fill (default rgba(255, 255, 255, 0.40)) */
    progressFill?: string;
    /** Corner radius (default 6) */
    cornerRadius?: number;
    /** Backdrop filter (default blur(6px)) */
    backdropFilter?: string;

    /** Whether the progress bar is visible (default true) */
    visible?: boolean;
    /** Whether it can receive pointer events (default true) */
    hittable?: boolean;
  };
  onPlay?: () => void;
  onPause?: () => void;
  onTimeUpdate?: (currentTime: number) => void;
  onEnded?: () => void;
  onFullScreen?: () => void;
};

export type VideoInfo = {
  duration: number;
  videoWidth: number;
  videoHeight: number;
  drawPosition: [number, number, number, number];
};

export type Layout = {
  w: number;
  h: number;
  centerBtnSize: number;
  centerBtnX: number;
  centerBtnY: number;
  progressX: number;
  progressY: number;
  progressW: number;
  controlBtnSize: number;
  controlBtnY: number;
};

export type Callbacks = Pick<
  Config,
  "onPlay" | "onPause" | "onTimeUpdate" | "onEnded" | "onFullScreen"
>;


