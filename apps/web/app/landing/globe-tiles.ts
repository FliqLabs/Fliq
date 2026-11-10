const TILE = 160;
const RADIUS = 34;

type Palette = { fill: string; ink: string; stroke?: string; weight: number };

const palettes: Palette[] = [
  { fill: "#0d0d12", ink: "#fafaf7", stroke: "rgba(255,255,255,0.16)", weight: 0.32 },
  { fill: "#fafaf7", ink: "#0d0d12", weight: 0.3 },
  { fill: "#a594ff", ink: "#0d0d12", weight: 0.26 },
  { fill: "#5b4be0", ink: "#ffffff", weight: 0.12 },
];

type Mark = (context: CanvasRenderingContext2D, font: string) => void;

const glyph =
  (text: string, size: number): Mark =>
  (context, font) => {
    context.font = `900 ${size}px ${font}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, TILE / 2, TILE / 2 + size * 0.04);
  };

const stroke =
  (draw: (context: CanvasRenderingContext2D) => void): Mark =>
  (context) => {
    context.lineWidth = 13;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    draw(context);
    context.stroke();
  };

const marks: Mark[] = [
  glyph("$", 92),
  glyph("₦", 88),
  glyph("KSh", 50),
  stroke((context) => {
    context.moveTo(54, 106);
    context.lineTo(106, 54);
    context.moveTo(62, 54);
    context.lineTo(106, 54);
    context.lineTo(106, 98);
  }),
  stroke((context) => {
    context.moveTo(50, 82);
    context.lineTo(72, 104);
    context.lineTo(112, 58);
  }),
  stroke((context) => {
    context.moveTo(80, 50);
    context.lineTo(80, 110);
    context.moveTo(50, 80);
    context.lineTo(110, 80);
  }),
];

function tileCanvas(palette: Palette, mark: Mark | HTMLImageElement, font: string) {
  const canvas = document.createElement("canvas");
  canvas.width = TILE;
  canvas.height = TILE;
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  context.beginPath();
  context.roundRect(2, 2, TILE - 4, TILE - 4, RADIUS);
  context.fillStyle = palette.fill;
  context.fill();
  if (palette.stroke) {
    context.lineWidth = 3;
    context.strokeStyle = palette.stroke;
    context.stroke();
  }
  context.fillStyle = palette.ink;
  context.strokeStyle = palette.ink;
  if (mark instanceof HTMLImageElement) {
    context.save();
    context.beginPath();
    context.arc(TILE / 2, TILE / 2, 44, 0, Math.PI * 2);
    context.clip();
    context.drawImage(mark, TILE / 2 - 44, TILE / 2 - 44, 88, 88);
    context.restore();
  } else {
    mark(context, font);
  }
  return canvas;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

export type GlobeTile = { canvas: HTMLCanvasElement; weight: number };

export async function createGlobeTiles(font: string): Promise<GlobeTile[]> {
  await document.fonts.load(`900 64px ${font}`, "$₦KSh").catch(() => undefined);
  const logo = await loadImage("/logo.png");
  const tiles: GlobeTile[] = [];
  for (const palette of palettes) {
    for (const mark of marks) {
      tiles.push({ canvas: tileCanvas(palette, mark, font), weight: palette.weight / marks.length });
    }
  }
  if (logo) tiles.push({ canvas: tileCanvas(palettes[0], logo, font), weight: 0.06 });
  return tiles;
}

export function pickTile(tiles: GlobeTile[], roll: number) {
  const total = tiles.reduce((sum, tile) => sum + tile.weight, 0);
  let remaining = roll * total;
  for (let index = 0; index < tiles.length; index++) {
    remaining -= tiles[index].weight;
    if (remaining <= 0) return index;
  }
  return tiles.length - 1;
}
