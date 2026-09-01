import { describe, expect, it } from "vitest";
import { BinaryAssembler, encodeBinaryMessage } from "./chunking";
import { bytesOf } from "../test/factories";

describe("бинарные сообщения", () => {
  it("собирает большой дубль в точности как отправляли", () => {
    const bytes = bytesOf(70000, 7);

    const chunks = encodeBinaryMessage({ lineId: "l1" }, bytes);
    const assembler = new BinaryAssembler<{ lineId: string }>();
    const frames = chunks.map((c) => assembler.push(c)).filter((f) => f !== null);

    expect(frames[frames.length - 1].bytes).toEqual(bytes);
    expect(frames[frames.length - 1].header).toEqual({ lineId: "l1" });
  });

  it("режет дубль на чанки по заданному размеру", () => {
    const chunks = encodeBinaryMessage({ lineId: "l1" }, bytesOf(40000), 16384);

    expect(chunks).toHaveLength(4);
  });

  it("завершает сообщение без данных сразу на заголовке", () => {
    const chunks = encodeBinaryMessage({ lineId: "пусто" }, new Uint8Array(0));
    const assembler = new BinaryAssembler<{ lineId: string }>();

    const frame = assembler.push(chunks[0]);

    expect(frame?.bytes).toEqual(new Uint8Array(0));
  });

  it("разбирает два сообщения подряд по отдельности", () => {
    const assembler = new BinaryAssembler<{ lineId: string }>();
    const first = encodeBinaryMessage({ lineId: "l1" }, bytesOf(100, 3));
    const second = encodeBinaryMessage({ lineId: "l2" }, bytesOf(100, 5));

    const frames = [...first, ...second].map((c) => assembler.push(c)).filter((f) => f !== null);

    expect(frames.map((f) => f.header.lineId)).toEqual(["l1", "l2"]);
    expect(frames[1].bytes).toEqual(bytesOf(100, 5));
  });
});
