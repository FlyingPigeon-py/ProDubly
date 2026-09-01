import { ChannelTransport } from "./transport";

export interface SignalPort {
  send: (payload: unknown) => void;
  onSignal: (handler: (payload: any) => void) => void;
}

const CHANNEL_LABEL = "dubl";
const CONNECT_TIMEOUT = 25000;

function wrap(channel: RTCDataChannel, connection: RTCPeerConnection): ChannelTransport {
  channel.binaryType = "arraybuffer";
  const transport = new ChannelTransport(
    (data) => {
      if (channel.readyState !== "open") return;
      if (typeof data === "string") channel.send(data);
      else channel.send(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
    },
    () => {
      channel.close();
      connection.close();
    }
  );
  channel.onmessage = (e) => {
    transport.receive(typeof e.data === "string" ? e.data : new Uint8Array(e.data as ArrayBuffer));
  };
  channel.onclose = () => transport.closedByPeer();
  return transport;
}

function prepare(config: RTCConfiguration, port: SignalPort): RTCPeerConnection {
  const pc = new RTCPeerConnection(config);
  pc.onicecandidate = (e) => {
    if (e.candidate) port.send({ ice: e.candidate.toJSON() });
  };
  return pc;
}

function waitOpen(channel: RTCDataChannel, connection: RTCPeerConnection): Promise<ChannelTransport> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      connection.close();
      reject(new Error("Не удалось соединиться напрямую — проверьте сеть или TURN в настройках"));
    }, CONNECT_TIMEOUT);
    const transport = wrap(channel, connection);
    const done = () => {
      clearTimeout(timer);
      resolve(transport);
    };
    if (channel.readyState === "open") done();
    else channel.onopen = done;
  });
}

export async function connectAsHost(port: SignalPort, config: RTCConfiguration): Promise<ChannelTransport> {
  const pc = prepare(config, port);
  const channel = pc.createDataChannel(CHANNEL_LABEL, { ordered: true });
  port.onSignal(async (payload) => {
    if (payload.sdp) await pc.setRemoteDescription(payload.sdp);
    if (payload.ice) await pc.addIceCandidate(payload.ice).catch(() => {});
  });
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  port.send({ sdp: pc.localDescription?.toJSON() });
  return waitOpen(channel, pc);
}

export async function connectAsGuest(port: SignalPort, config: RTCConfiguration): Promise<ChannelTransport> {
  const pc = prepare(config, port);
  const channel = await new Promise<RTCDataChannel>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Хост не ответил на подключение")), CONNECT_TIMEOUT);
    pc.ondatachannel = (e) => {
      clearTimeout(timer);
      resolve(e.channel);
    };
    port.onSignal(async (payload) => {
      if (payload.sdp) {
        await pc.setRemoteDescription(payload.sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        port.send({ sdp: pc.localDescription?.toJSON() });
      }
      if (payload.ice) await pc.addIceCandidate(payload.ice).catch(() => {});
    });
  });
  return waitOpen(channel, pc);
}
