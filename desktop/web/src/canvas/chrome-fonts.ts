/**
 * The font stack of text the canvas draws itself: Pixi labels and every canvas
 * chip (measure chips included: Source Sans 3's digits are tabular, so a chip
 * keeps its width as its number changes), Canvas2D lens badges, and
 * runtime-owned DOM overlays such as the rotate readout. Pixi and Canvas2D
 * cannot resolve CSS custom properties, so this mirrors `--font-sans` in
 * `styles/global.css` (bundled Source Sans 3 first, then Noto/system fallbacks
 * for CJK and Cyrillic); `canvas-chrome-theme.test.ts` keeps them equal.
 */
export const CANVAS_CHROME_FONT_FAMILY = "'Source Sans 3', 'Noto Sans', 'Noto Sans SC', 'Noto Sans JP', 'Noto Sans KR', 'PingFang SC', 'Hiragino Sans', 'Apple SD Gothic Neo', 'Microsoft YaHei', 'Yu Gothic UI', 'Malgun Gothic', system-ui, -apple-system, 'Segoe UI', sans-serif"
