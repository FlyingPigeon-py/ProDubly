import { BinaryAssembler, encodeBinaryMessage } from "./chunking";
import type { NetMessage, TakeHeader } from "./protocol";

export interface Transport {
  send(msg: NetMessage): void;
  sendBinary(header: TakeHeader, bytes: Uint8Array): void;
  onMessage: ((msg: NetMessage) => void) | null;
  onBinary: ((header: TakeHeader, bytes: Uint8Array) => void) | null;
  onClose: (() => void) | null;
  close(): void;
}

export class ChannelTransport implements Transport {
  onMessage: ((msg: NetMessage) => void) | null = null;
  onBinary: ((header: TakeHeader, bytes: Uint8Array) => void) | null = null;
  onClose: (() => void) | null = null;
  private assembler = new BinaryAssembler<TakeHeader>();
  private deliver: (data: string | Uint8Array) => void;
  private shutdown: () => void;

  constructor(deliver: (data: string | Uint8Array) => void, shutdown: () => void) {
    this.deliver = deliver;
    this.shutdown = shutdown;
  }

  receive(data: string | Uint8Array): void {
    if (typeof data === "string") {
      this.onMessage?.(JSON.parse(data) as NetMessage);
      return;
    }
    const frame = this.assembler.push(data);
    if (frame) this.onBinary?.(frame.header, frame.bytes);
  }

  send(msg: NetMessage): void {
    this.deliver(JSON.stringify(msg));
  }

  sendBinary(header: TakeHeader, bytes: Uint8Array): void {
    for (const chunk of encodeBinaryMessage(header, bytes)) this.deliver(chunk);
  }

  close(): void {
    this.shutdown();
  }

  closedByPeer(): void {
    this.onClose?.();
  }
}

export function memoryPair(): [ChannelTransport, ChannelTransport] {
  const post = (to: () => ChannelTransport) => (data: string | Uint8Array) => {
    queueMicrotask(() => to().receive(data));
  };
  const disconnect = () => {
    queueMicrotask(() => {
      left.closedByPeer();
      right.closedByPeer();
    });
  };
  const left: ChannelTransport = new ChannelTransport(post(() => right), disconnect);
  const right: ChannelTransport = new ChannelTransport(post(() => left), disconnect);
  return [left, right];
}
