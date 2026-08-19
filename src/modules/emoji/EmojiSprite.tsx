// Apple 风格 Emoji 雪碧图渲染：32px 格子（含 1px 透明边框，格子 34px）
const SHEET_URL = `${import.meta.env.BASE_URL}emoji-sheet.png`;
const SHEET_PX = 2108;
const CELL = 34; // 32px 图 + 2px 边框

export function EmojiSprite({ x, y, size = 32 }: { x: number; y: number; size?: number }) {
  const scale = size / 32;
  return (
    <div
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${SHEET_URL})`,
        backgroundSize: `${SHEET_PX * scale}px ${SHEET_PX * scale}px`,
        backgroundPosition: `${-(x * CELL + 1) * scale}px ${-(y * CELL + 1) * scale}px`,
        backgroundRepeat: "no-repeat",
      }}
    />
  );
}
