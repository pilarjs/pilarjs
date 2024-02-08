import type {
  ITransport,
  ITransportCloseEvent,
  ITransportEvent,
  ITransportInstance,
  ITransportMessageEvent,
} from ".";
import { makeEventSource, type UnsubscribeCallback } from "../lib/EventSource";

class WT implements ITransportInstance {
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  readyState = 0;

  private wt: WebTransport | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private events = {
    open: makeEventSource<ITransportEvent>(),
    close: makeEventSource<ITransportCloseEvent>(),
    error: makeEventSource<ITransportEvent>(),
    message: makeEventSource<ITransportMessageEvent>(),
  };
  private unsubs = new Map<any, UnsubscribeCallback>();

  constructor(address: string) {
    this.wt = new WebTransport(address);

    this.wt.closed
      .then(() => {
        console.log("transport closed gracefully");
        this.readyState = this.CLOSED;
        // this.onClose();
      })
      .catch((err) => {
        console.error("transport closed due to %s", err);
        // this.onError("webtransport error", err);
      });

    this.wt.ready
      .then(() => {
        this.readyState = this.OPEN;
        console.log("ready");
        this.events.open.notify({ type: "open" });
        this.writer = this.wt!.datagrams.writable.getWriter();

        const reader = this.wt!.datagrams.readable.getReader();

        const read = () => {
          reader
            .read()
            .then(({ done, value }) => {
              if (done) {
                this.events.close.notify({ type: "close" });
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

  addEventListener(
    type: "open" | "error" | "close" | "message",
    listener: (this: ITransportInstance, ev: any) => unknown
  ): void {
    if (type === "open") {
      const unsub = this.events.open.subscribe(listener.bind(this));
      this.unsubs.set(listener, unsub);
    }
    if (type === "close") {
      const unsub = this.events.close.subscribe(listener.bind(this));
      this.unsubs.set(listener, unsub);
    }
    if (type === "error") {
      const unsub = this.events.error.subscribe(listener.bind(this));
      this.unsubs.set(listener, unsub);
    }
    if (type === "message") {
      const unsub = this.events.message.subscribe(listener.bind(this));
      this.unsubs.set(listener, unsub);
    }
  }

  removeEventListener(
    type: string,
    listener: (this: ITransportInstance, ev: any) => any
  ): void {
    this.unsubs.get(listener)?.();
  }

  close(): void {
    this.wt?.close();
  }

  send(data: Uint8Array): void {
    if (this.writer) {
      console.log("do write");
      this.writer.write(data).catch((err) => {
        console.error("failed to send data: %s", err);
      });
    }
  }
}

export const Transport: ITransport = WT;
