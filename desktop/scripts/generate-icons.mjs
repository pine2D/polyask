import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const TRANSPARENT = [0, 0, 0, 0];
const INK = [0x22, 0x22, 0x22, 0xff];
const WHITE = [0xff, 0xff, 0xff, 0xff];
const SHADE = [0xcc, 0xcc, 0xcc, 0xff];
const LAVENDER = [0x99, 0x99, 0xff, 0xff];

const BITMAP_ASK_16 = [
  " #   ## # #",
  "# # #   # #",
  "###  #  ## ",
  "# #   # # #",
  "# # ##  # #"
];

const BITMAP_Ask_17 = [
  " ###        ##   ",
  "## ##       ##   ",
  "## ##       ##   ",
  "## ##  #### ## ##",
  "##### ##    #### ",
  "## ##  ###  ###  ",
  "## ##    ## #### ",
  "## ## ####  ## ##"
];

const BITMAP_Ask_19 = [
  " ###          ##   ",
  "## ##         ##   ",
  "## ##         ##   ",
  "## ##   ####  ## ##",
  "#####  ##     #### ",
  "## ##   ###   ###  ",
  "## ##     ##  #### ",
  "## ##  ####   ## ##"
];

const PIXEL_BUBBLE_24 = [
  "  ####################  ",
  " ##..................###",
  " #....................##",
  " #....................##",
  " #....................##",
  " #....................##",
  " #....................##",
  " #....................##",
  " #....................##",
  " #....................##",
  " #....................##",
  " #....................##",
  " #....................##",
  " #....................##",
  " ##..................###",
  "  ###..#################",
  "   ##.################# ",
  "   #####                ",
  "   ####                 ",
  "   ##                   "
];

const PIXEL_BUBBLE_32 = [
  "   ########################     ",
  "  ##########################    ",
  " ###......................###   ",
  " ##........................#### ",
  " ##........................#### ",
  " ##........................#### ",
  " ##........................#### ",
  " ##........................#### ",
  " ##........................#### ",
  " ##........................#### ",
  " ##........................#### ",
  " ##........................#### ",
  " ##........................#### ",
  " ##........................#### ",
  " ##........................#### ",
  " ##........................#### ",
  " ##........................#### ",
  " ##........................#### ",
  " ###......................##### ",
  "  #####...####################  ",
  "   ####...###################   ",
  "     ##..#####                  ",
  "     ##.#####                   ",
  "     #######                    ",
  "     #####                      ",
  "     ###                        "
];

function createCanvas(size) {
  const data = new Uint8Array(size * size * 4);
  const setPixel = (x, y, rgba) => {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const i = (y * size + x) * 4;
    data[i] = rgba[0];
    data[i + 1] = rgba[1];
    data[i + 2] = rgba[2];
    data[i + 3] = rgba[3];
  };
  const fillRect = (x0, y0, w, h, rgba) => {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) setPixel(x0 + dx, y0 + dy, rgba);
    }
  };
  const drawBitmap = (rows, x0, y0, rgba) => {
    rows.forEach((row, dy) => {
      for (let dx = 0; dx < row.length; dx++) {
        if (row[dx] === "#") setPixel(x0 + dx, y0 + dy, rgba);
      }
    });
  };
  return { size, data, setPixel, fillRect, drawBitmap };
}

export function renderPixelBubble16() {
  const c = createCanvas(16);
  c.fillRect(0, 1, 16, 11, INK);
  c.fillRect(1, 2, 14, 9, WHITE);
  c.fillRect(3, 12, 4, 1, INK);
  c.fillRect(3, 13, 3, 1, INK);
  c.fillRect(3, 14, 2, 1, INK);
  c.fillRect(4, 11, 2, 1, WHITE);
  c.fillRect(4, 12, 1, 1, WHITE);
  c.fillRect(2, 9, 11, 1, LAVENDER);
  c.drawBitmap(BITMAP_ASK_16, 2, 3, INK);
  return c.data;
}

export function renderPixelBubble24() {
  const c = createCanvas(24);
  PIXEL_BUBBLE_24.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      if (row[dx] === "#") c.setPixel(dx, dy + 2, INK);
      else if (row[dx] === ".") c.setPixel(dx, dy + 2, WHITE);
    }
  });
  c.fillRect(3, 16, 2, 1, SHADE);
  c.fillRect(7, 16, 14, 1, SHADE);
  c.fillRect(21, 4, 1, 12, SHADE);
  c.fillRect(3, 14, 17, 1, LAVENDER);
  c.drawBitmap(BITMAP_Ask_17, 3, 5, INK);
  return c.data;
}

export function renderPixelBubble32() {
  const c = createCanvas(32);
  PIXEL_BUBBLE_32.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      if (row[dx] === "#") c.setPixel(dx, dy + 3, INK);
      else if (row[dx] === ".") c.setPixel(dx, dy + 3, WHITE);
    }
  });
  c.fillRect(4, 21, 3, 1, SHADE);
  c.fillRect(10, 21, 16, 1, SHADE);
  c.fillRect(26, 6, 1, 15, SHADE);
  c.fillRect(5, 17, 19, 2, LAVENDER);
  c.drawBitmap(BITMAP_Ask_19, 5, 7, INK);
  return c.data;
}

export function scaleIntegerNearest(src, srcSize, scale) {
  if (scale === 1) return new Uint8Array(src);
  const dstSize = srcSize * scale;
  const dst = new Uint8Array(dstSize * dstSize * 4);
  for (let y = 0; y < dstSize; y++) {
    const sy = Math.floor(y / scale);
    for (let x = 0; x < dstSize; x++) {
      const sx = Math.floor(x / scale);
      const si = (sy * srcSize + sx) * 4;
      const di = (y * dstSize + x) * 4;
      dst[di] = src[si];
      dst[di + 1] = src[si + 1];
      dst[di + 2] = src[si + 2];
      dst[di + 3] = src[si + 3];
    }
  }
  return dst;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

export function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + stride);
    raw[rowOffset] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, rowOffset + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function encodeBmpDib(size, rgba) {
  const header = Buffer.alloc(40);
  const xorSize = size * size * 4;
  const maskRowBytes = Math.ceil(size / 32) * 4;
  const andSize = size * maskRowBytes;
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);
  header.writeUInt32LE(xorSize + andSize, 20);

  const xor = Buffer.alloc(xorSize);
  const and = Buffer.alloc(andSize);
  for (let y = 0; y < size; y++) {
    const srcY = size - 1 - y;
    for (let x = 0; x < size; x++) {
      const si = (srcY * size + x) * 4;
      const di = (y * size + x) * 4;
      const a = rgba[si + 3];
      if (a === 0) {
        and[y * maskRowBytes + (x >> 3)] |= (0x80 >> (x & 7));
      } else {
        xor[di] = rgba[si + 2];
        xor[di + 1] = rgba[si + 1];
        xor[di + 2] = rgba[si];
        xor[di + 3] = a;
      }
    }
  }
  return Buffer.concat([header, xor, and]);
}

export function encodeIco(frames) {
  const dir = Buffer.alloc(6 + frames.length * 16);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(frames.length, 4);

  let offset = dir.length;
  const payloads = frames.map(({ size, rgba }) => (
    size >= 256 ? encodePng(size, size, rgba) : encodeBmpDib(size, rgba)
  ));
  frames.forEach(({ size }, idx) => {
    const entryOffset = 6 + idx * 16;
    const payload = payloads[idx];
    dir[entryOffset] = size >= 256 ? 0 : size;
    dir[entryOffset + 1] = size >= 256 ? 0 : size;
    dir[entryOffset + 2] = 0;
    dir[entryOffset + 3] = 0;
    dir.writeUInt16LE(1, entryOffset + 4);
    dir.writeUInt16LE(32, entryOffset + 6);
    dir.writeUInt32LE(payload.length, entryOffset + 8);
    dir.writeUInt32LE(offset, entryOffset + 12);
    offset += payload.length;
  });
  return Buffer.concat([dir, ...payloads]);
}

export function encodeIcns(entries) {
  const chunks = entries.map(({ type, png }) => {
    const chunk = Buffer.alloc(8 + png.length);
    chunk.write(type, 0, 4, "ascii");
    chunk.writeUInt32BE(chunk.length, 4);
    png.copy(chunk, 8);
    return chunk;
  });
  const total = 8 + chunks.reduce((sum, c) => sum + c.length, 0);
  const header = Buffer.alloc(8);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32BE(total, 4);
  return Buffer.concat([header, ...chunks]);
}

export function buildIconAssets() {
  const s16 = renderPixelBubble16();
  const s24 = renderPixelBubble24();
  const s32 = renderPixelBubble32();
  const s48 = scaleIntegerNearest(s24, 24, 2);
  const s64 = scaleIntegerNearest(s32, 32, 2);
  const s128 = scaleIntegerNearest(s32, 32, 4);
  const s256 = scaleIntegerNearest(s32, 32, 8);
  const s512 = scaleIntegerNearest(s32, 32, 16);
  const s1024 = scaleIntegerNearest(s32, 32, 32);

  const p16 = encodePng(16, 16, s16);
  const p32 = encodePng(32, 32, s32);
  const p64 = encodePng(64, 64, s64);
  const p128 = encodePng(128, 128, s128);
  const p256 = encodePng(256, 256, s256);
  const p512 = encodePng(512, 512, s512);
  const p1024 = encodePng(1024, 1024, s1024);

  const ico = encodeIco([
    { size: 16, rgba: s16 },
    { size: 24, rgba: s24 },
    { size: 32, rgba: s32 },
    { size: 48, rgba: s48 },
    { size: 64, rgba: s64 },
    { size: 128, rgba: s128 },
    { size: 256, rgba: s256 }
  ]);
  const icns = encodeIcns([
    { type: "icp4", png: p16 },
    { type: "icp5", png: p32 },
    { type: "icp6", png: p64 },
    { type: "ic07", png: p128 },
    { type: "ic08", png: p256 },
    { type: "ic09", png: p512 },
    { type: "ic10", png: p1024 },
    { type: "ic11", png: p32 },
    { type: "ic12", png: p64 },
    { type: "ic13", png: p256 },
    { type: "ic14", png: p512 }
  ]);
  return { png: p512, ico, icns };
}

async function main() {
  const resourcesDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "resources");
  await mkdir(resourcesDir, { recursive: true });
  const { png, ico, icns } = buildIconAssets();
  await writeFile(join(resourcesDir, "icon.png"), png);
  await writeFile(join(resourcesDir, "icon.ico"), ico);
  await writeFile(join(resourcesDir, "icon.icns"), icns);
  process.stdout.write(`Generated icon.png (${png.length}B), icon.ico (${ico.length}B), icon.icns (${icns.length}B)\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
