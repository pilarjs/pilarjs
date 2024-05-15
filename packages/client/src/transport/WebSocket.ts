import {
  TransportReadyState,
  type ITransport,
  type ITransportCloseEvent,
  type ITransportEvent,
  type ITransportInstance,
  type ITransportMessageEvent,
} from ".";
import { makeEventSource } from "../lib/EventSource";

class WS implements ITransportInstance {
  readyState = TransportReadyState.CONNECTING;
  events = {
    open: makeEventSource<ITransportEvent>(),
    close: makeEventSource<ITransportCloseEvent>(),
    error: makeEventSource<ITransportEvent>(),
    message: makeEventSource<ITransportMessageEvent>(),
  };

  private ws: WebSocket;
  constructor(address: string) {
    this.ws = new WebSocket(address);

    this.ws.onopen = () => {
      this.readyState = TransportReadyState.OPEN;
      this.events.open.notify({ type: "open" });
    };

    this.ws.onclose = (ev) => {
      this.readyState = TransportReadyState.CLOSED;
      this.events.close.notify({
        type: "close",
        code: ev.code,
        reason: ev.reason,
      });
    };

    this.ws.onerror = () => {
      this.events.error.notify({ type: "error" });
    };

    this.ws.onmessage = (ev) => {
      this.events.message.notify({
        type: "message",
        data: ev.data as Uint8Array,
      });
    };
  }

  close(): void {
    this.ws.close();
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (this.readyState !== TransportReadyState.OPEN) {
      throw new Error("Transport not open");
    }

    this.ws.send(data);
  }
}

export const Transport: ITransport = WS;
