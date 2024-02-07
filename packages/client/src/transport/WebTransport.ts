import type { ITransport, ITransportInstance } from ".";

class WT implements ITransportInstance {
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  readyState = 0;

  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;

  constructor(address: string) {
    const wt = new WebTransport(address);

    wt.closed
      .then(() => {
        console.log("transport closed gracefully");
        this.readyState = this.CLOSED;
        // this.onClose();
      })
      .catch((err) => {
        console.error("transport closed due to %s", err);
        // this.onError("webtransport error", err);
      });

    wt.ready
      .then(() => {
        this.readyState = this.OPEN;
        console.log("ready");
        this.writer = wt.datagrams.writable.getWriter();

        const reader = wt.datagrams.readable.getReader();

        const read = () => {
          reader
            .read()
            .then(({ done, value }) => {
              if (done) {
                console.log("session is closed");
                return;
              }
              console.log("received chunk: %o", value);
              // this.onPacket(value);
              read();
            })
            .catch((err) => {
              console.error("an error occurred while reading: %s", err);
            });
        };

        read();
      })
      .catch((err) => {
        console.error("error", err);
      });

    console.log("connect to :", address);

    WebTransport;
  }

  addEventListener(
    type: string,
    listener: (this: ITransportInstance, ev: any) => any
  ): void {
    // ...
  }

  removeEventListener(
    type: string,
    listener: (this: ITransportInstance, ev: any) => any
  ): void {
    // ...
  }

  close(): void {
    // ...
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
