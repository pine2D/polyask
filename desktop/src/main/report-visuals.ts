/** Only generated bounded PNGs cross the trusted renderer boundary, never source SVG/HTML. */
export const REPORT_DIAGRAM_LIMIT = 24;
export const REPORT_IMAGE_BYTES = 4 * 1024 * 1024;
export const REPORT_IMAGE_EDGE = 4096;
export const REPORT_IMAGE_PIXELS = 8 * 1024 * 1024;
export function validReportPng(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > REPORT_IMAGE_BYTES * 4 / 3 + 32 ||
    !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  const bytes = Buffer.from(value.slice(22), 'base64');
  if (bytes.length < 33 || bytes.length > REPORT_IMAGE_BYTES ||
    bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.toString('ascii', 12, 16) !== 'IHDR') return false;
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  return width > 0 && height > 0 && width <= REPORT_IMAGE_EDGE && height <= REPORT_IMAGE_EDGE && width * height <= REPORT_IMAGE_PIXELS;
}
export const reportImageUrls = (html: string): Set<string> => new Set([...html.matchAll(/<img src="([^"]+)"/g)]
  .map(match => match[1]).filter(validReportPng));
