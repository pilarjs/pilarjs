import {
  TransportReadyState,
  type ITransport,
  type ITransportCloseEvent,
  type ITransportEvent,
  type ITransportInstance,
  type ITransportMessageEvent,
} from ".";
import { makeEventSource, type UnsubscribeCallback } from "../lib/EventSource";

class WT implements ITransportInstance {
  readyState = TransportReadyState.CONNECTING;

  events = {
    open: makeEventSource<ITransportEvent>(),
    close: makeEventSource<ITransportCloseEvent>(),
    error: makeEventSource<ITransportEvent>(),
    message: makeEventSource<ITransportMessageEvent>(),
  };

  private wt: WebTransport | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private unsubs = new Map<any, UnsubscribeCallback>();

  constructor(address: string) {
    this.wt = new WebTransport(address);

    this.wt.closed
      .then(() => {
        this.readyState = TransportReadyState.CLOSED;
        this.events.close.notify({ type: "close", code: 0, reason: "" });
      })
      .catch((err) => {
        console.error("transport closed due to %s", err);
        // this.onError("webtransport error", err);
      });

    this.wt.ready
      .then(() => {
        this.readyState = TransportReadyState.OPEN;
        this.events.open.notify({ type: "open" });
        this.writer = this.wt!.datagrams.writable.getWriter();

        const reader = this.wt!.datagrams.readable.getReader();

        const read = () => {
          reader
            .read()
            .then(({ done, value }) => {
              if (done) {
                this.events.close.notify({
                  type: "close",
                  code: 0,
                  reason: "",
                });
                return;
              }
              this.events.message.notify({
                type: "message",
                data: value as Uint8Array,
              });
              read();
            })
            .catch((err) => {
              console.error("failed to read data: %s", err);
              this.events.error.notify({ type: "error" });
            });
        };

        read();
      })
      .catch((err) => {
        console.error("failed to open transport: %s", err);
        this.events.error.notify({ type: "error" });
      });

    console.log("connect to :", address);
  }

  close(): void {
    this.wt?.close();
  }

  send(data: Uint8Array): void {
    if (this.writer) {
      this.writer.write(data).catch((err) => {
        console.error("failed to send data: %s", err);
      });
    }
  }
}

export const Transport: ITransport = WT;
