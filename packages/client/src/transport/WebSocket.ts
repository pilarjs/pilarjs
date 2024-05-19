import {
  TransportEventType,
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
  constructor(address: string, WS: typeof WebSocket = WebSocket) {
    this.ws = new WS(address);

    this.ws.onopen = () => {
      this.readyState = TransportReadyState.OPEN;
      this.events.open.notify({ type: TransportEventType.OPEN });
    };

    this.ws.onclose = (ev) => {
      this.readyState = TransportReadyState.CLOSED;
      this.events.close.notify({
        type: TransportEventType.CLOSE,
        code: ev.code,
        reason: ev.reason,
      });
    };

    this.ws.onerror = () => {
      this.events.error.notify({ type: TransportEventType.ERROR });
    };

    this.ws.onmessage = (ev) => {
      this.events.message.notify({
        type: TransportEventType.MESSAGE,
        data: ev.data as Uint8Array,
      });
    };
  }

  close(): void {
    this.events.close.clear();
    this.events.error.clear();
    this.events.message.clear();
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
