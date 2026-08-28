const fs = require('node:fs');
const zlib = require('node:zlib');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(contents) {
  let value = 0xffffffff;
  for (const byte of contents) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const chunk = Buffer.allocUnsafe(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), data.length + 8);
  return chunk;
}

function paeth(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  if (upDistance <= upperLeftDistance) return up;
  return upperLeft;
}

function decodePng(input) {
  const contents = Buffer.isBuffer(input) ? input : fs.readFileSync(input);
  if (!contents.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('Expected a PNG image');
  }

  let offset = 8;
  let header;
  const compressed = [];
  while (offset + 12 <= contents.length) {
    const length = contents.readUInt32BE(offset);
    const type = contents.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > contents.length) throw new Error(`Truncated PNG ${type} chunk`);
    const data = contents.subarray(dataStart, dataEnd);
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
    } else if (type === 'IDAT') {
      compressed.push(data);
    }
    offset = dataEnd + 4;
    if (type === 'IEND') break;
  }

  if (!header || compressed.length === 0) throw new Error('PNG is missing IHDR or IDAT');
  if (
    header.bitDepth !== 8 ||
    ![2, 6].includes(header.colorType) ||
    header.compression !== 0 ||
    header.filter !== 0 ||
    header.interlace !== 0
  ) {
    throw new Error('Only non-interlaced 8-bit RGB and RGBA PNG images are supported');
  }

  const channels = header.colorType === 6 ? 4 : 3;
  const rowLength = header.width * channels;
  const filtered = zlib.inflateSync(Buffer.concat(compressed));
  if (filtered.length !== header.height * (rowLength + 1)) {
    throw new Error('PNG scanline length does not match its header');
  }

  const pixels = Buffer.allocUnsafe(header.height * rowLength);
  let inputOffset = 0;
  for (let rowIndex = 0; rowIndex < header.height; rowIndex += 1) {
    const filterType = filtered[inputOffset];
    inputOffset += 1;
    const rowOffset = rowIndex * rowLength;
    const previousOffset = rowOffset - rowLength;
    for (let byteIndex = 0; byteIndex < rowLength; byteIndex += 1) {
      const encoded = filtered[inputOffset + byteIndex];
      const left = byteIndex >= channels ? pixels[rowOffset + byteIndex - channels] : 0;
      const up = rowIndex > 0 ? pixels[previousOffset + byteIndex] : 0;
      const upperLeft =
        rowIndex > 0 && byteIndex >= channels ? pixels[previousOffset + byteIndex - channels] : 0;
      let predictor;
      switch (filterType) {
        case 0:
          predictor = 0;
          break;
        case 1:
          predictor = left;
          break;
        case 2:
          predictor = up;
          break;
        case 3:
          predictor = Math.floor((left + up) / 2);
          break;
        case 4:
          predictor = paeth(left, up, upperLeft);
          break;
        default:
          throw new Error(`Unsupported PNG filter type ${filterType}`);
      }
      pixels[rowOffset + byteIndex] = (encoded + predictor) & 0xff;
    }
    inputOffset += rowLength;
  }

  return { ...header, channels, pixels };
}

function encodeRgbPng(width, height, pixels) {
  if (pixels.length !== width * height * 3) throw new Error('RGB pixel length is invalid');
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  const scanlines = Buffer.allocUnsafe(height * (width * 3 + 1));
  for (let rowIndex = 0; rowIndex < height; rowIndex += 1) {
    const scanlineOffset = rowIndex * (width * 3 + 1);
    scanlines[scanlineOffset] = 0;
    pixels.copy(scanlines, scanlineOffset + 1, rowIndex * width * 3, (rowIndex + 1) * width * 3);
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function flattenPngToRgb(input, output, background = [255, 255, 255]) {
  const image = decodePng(input);
  const rgb = Buffer.allocUnsafe(image.width * image.height * 3);
  for (let pixelIndex = 0; pixelIndex < image.width * image.height; pixelIndex += 1) {
    const sourceOffset = pixelIndex * image.channels;
    const outputOffset = pixelIndex * 3;
    const alpha = image.channels === 4 ? image.pixels[sourceOffset + 3] : 255;
    for (let channel = 0; channel < 3; channel += 1) {
      const source = image.pixels[sourceOffset + channel];
      rgb[outputOffset + channel] = Math.round(
        (source * alpha + background[channel] * (255 - alpha)) / 255,
      );
    }
  }
  fs.mkdirSync(require('node:path').dirname(output), { recursive: true });
  fs.writeFileSync(output, encodeRgbPng(image.width, image.height, rgb));
}

module.exports = { decodePng, encodeRgbPng, flattenPngToRgb };
