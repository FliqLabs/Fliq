import { globeIcons, type GlobeIcon } from "./globe-icons";

const TILE = 160;
const RADIUS = 34;

type Palette = { fill: string; ink: string; stroke?: string };

const ink: Palette = { fill: "#0d0d12", ink: "#fafaf7", stroke: "rgba(255,255,255,0.16)" };
const paper: Palette = { fill: "#fafaf7", ink: "#0d0d12" };
const lilac: Palette = { fill: "#a594ff", ink: "#0d0d12" };
const violet: Palette = { fill: "#5b4be0", ink: "#ffffff" };
const palettes = [ink, paper, lilac, violet];

const share = { glyph: 0.42, flag: 0.26, token: 0.18, bank: 0.14 };

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
  glyph("€", 88),
  glyph("£", 88),
  glyph("¥", 88),
  glyph("₹", 88),
  glyph("₵", 88),
  glyph("₱", 88),
  glyph("₿", 88),
  glyph("KSh", 50),
  glyph("R", 92),
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
];

function blankTile(palette: Palette) {
  const canvas = document.createElement("canvas");
  canvas.width = TILE;
  canvas.height = TILE;
  const context = canvas.getContext("2d")!;
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
  return { canvas, context };
}

function markTile(palette: Palette, mark: Mark, font: string) {
  const { canvas, context } = blankTile(palette);
  mark(context, font);
  return canvas;
}

function flagTile(image: HTMLImageElement) {
  const canvas = document.createElement("canvas");
  canvas.width = TILE;
  canvas.height = TILE;
  const context = canvas.getContext("2d")!;
  context.beginPath();
  context.roundRect(2, 2, TILE - 4, TILE - 4, RADIUS);
  context.save();
  context.clip();
  const scale = Math.max(TILE / image.naturalWidth, TILE / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  context.drawImage(image, (TILE - width) / 2, (TILE - height) / 2, width, height);
  context.restore();
  context.lineWidth = 3;
  context.strokeStyle = "rgba(255,255,255,0.22)";
  context.stroke();
  return canvas;
}

function badgeTile(palette: Palette, image: HTMLImageElement) {
  const { canvas, context } = blankTile(palette);
  const ratio = image.naturalWidth / image.naturalHeight;
  if (Math.abs(ratio - 1) < 0.05) {
    const size = 100;
    context.save();
    context.beginPath();
    context.arc(TILE / 2, TILE / 2, size / 2, 0, Math.PI * 2);
    context.clip();
    context.drawImage(image, (TILE - size) / 2, (TILE - size) / 2, size, size);
    context.restore();
    return canvas;
  }
  const box = 116;
  const width = ratio > 1 ? box : box * ratio;
  const height = ratio > 1 ? box / ratio : box;
  context.drawImage(image, (TILE - width) / 2, (TILE - height) / 2, width, height);
  return canvas;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image.naturalWidth ? image : null);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

export type GlobeTile = { canvas: HTMLCanvasElement; weight: number };

async function iconTiles(icons: GlobeIcon[]) {
  const loaded = await Promise.all(icons.map(async (icon) => ({ icon, image: await loadImage(icon.src) })));
  const tiles: { canvas: HTMLCanvasElement; kind: GlobeIcon["kind"] }[] = [];
  loaded.forEach(({ icon, image }, index) => {
    if (!image) return;
    const wide = Math.abs(image.naturalWidth / image.naturalHeight - 1) >= 0.05;
    const palette = wide || index % 2 ? paper : ink;
    const canvas = icon.kind === "flag" ? flagTile(image) : badgeTile(palette, image);
    tiles.push({ canvas, kind: icon.kind });
  });
  return tiles;
}

export async function createGlobeTiles(font: string): Promise<GlobeTile[]> {
  await document.fonts.load(`900 64px ${font}`, "$₦€£¥₹₵₱₿KSh").catch(() => undefined);
  const tiles: GlobeTile[] = [];
  const glyphCount = palettes.length * marks.length;
  for (const palette of palettes) {
    for (const mark of marks)
      tiles.push({ canvas: markTile(palette, mark, font), weight: share.glyph / glyphCount });
  }
  const images = await iconTiles(globeIcons);
  for (const kind of ["flag", "token", "bank"] as const) {
    const ofKind = images.filter((tile) => tile.kind === kind);
    for (const tile of ofKind) tiles.push({ canvas: tile.canvas, weight: share[kind] / ofKind.length });
  }
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
