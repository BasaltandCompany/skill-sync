// Generates a solid-color 1024x1024 PNG for `tauri icon` to multiply.
// Placeholder brand mark — swap assets/icon.png for real art before shipping.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const W = 1024;
const raw = Buffer.alloc(W * (W * 4 + 1));
for (let y = 0; y < W; y++) {
  const row = y * (W * 4 + 1);
  raw[row] = 0; // filter: none
  for (let x = 0; x < W; x++) {
    const i = row + 1 + x * 4;
    // vertical gradient, basalt slate → indigo accent
    const t = y / W;
    raw[i] = Math.round(20 + 59 * t);
    raw[i + 1] = Math.round(27 + 67 * t);
    raw[i + 2] = Math.round(34 + 221 * t);
    raw[i + 3] = 255;
  }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf: Buffer) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(W, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0)),
]);

mkdirSync(new URL(".", import.meta.url).pathname, { recursive: true });
writeFileSync(new URL("./icon.png", import.meta.url).pathname, png);
console.log("assets/icon.png written");
