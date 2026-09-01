export const CHUNK_SIZE = 16 * 1024;

const HEADER_TAG = 0;
const DATA_TAG = 1;

export interface BinaryFrame<H = unknown> {
  header: H;
  bytes: Uint8Array;
}

export function encodeBinaryMessage(header: unknown, bytes: Uint8Array, chunkSize = CHUNK_SIZE): Uint8Array[] {
  const meta = new TextEncoder().encode(JSON.stringify({ header, length: bytes.length }));
  const head = new Uint8Array(meta.length + 1);
  head[0] = HEADER_TAG;
  head.set(meta, 1);
  const out = [head];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const slice = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    const chunk = new Uint8Array(slice.length + 1);
    chunk[0] = DATA_TAG;
    chunk.set(slice, 1);
    out.push(chunk);
  }
  return out;
}

export class BinaryAssembler<H = unknown> {
  private header: H | null = null;
  private expected = 0;
  private buffer: Uint8Array | null = null;
  private filled = 0;

  push(chunk: Uint8Array): BinaryFrame<H> | null {
    if (chunk.length === 0) return null;
    if (chunk[0] === HEADER_TAG) {
      const meta = JSON.parse(new TextDecoder().decode(chunk.subarray(1)));
      this.header = meta.header as H;
      this.expected = meta.length as number;
      this.buffer = new Uint8Array(this.expected);
      this.filled = 0;
      return this.expected === 0 ? this.complete() : null;
    }
    if (!this.buffer) return null;
    const data = chunk.subarray(1);
    this.buffer.set(data, this.filled);
    this.filled += data.length;
    return this.filled >= this.expected ? this.complete() : null;
  }

  private complete(): BinaryFrame<H> {
    const frame = { header: this.header as H, bytes: this.buffer ?? new Uint8Array(0) };
    this.header = null;
    this.buffer = null;
    this.expected = 0;
    this.filled = 0;
    return frame;
  }
}
