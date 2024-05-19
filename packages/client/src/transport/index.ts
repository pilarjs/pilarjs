import type { EventSource } from "../lib/EventSource";

export enum TransportReadyState {
  CONNECTING = 0,
  OPEN = 1,
  CLOSING = 2,
  CLOSED = 3,
}

export enum TransportEventType {
  OPEN = 0,
  ERROR = 1,
  CLOSE = 2,
  MESSAGE = 3,
}

export interface ITransportEvent {
  type: TransportEventType;
}

export interface ITransportCloseEvent extends ITransportEvent {
  readonly code: number;
  readonly reason: string;
}

export interface ITransportMessageEvent extends ITransportEvent {
  data: Uint8Array;
}

export interface ITransportInstance {
  readonly readyState: TransportReadyState;

  readonly events: {
    open: EventSource<ITransportEvent>;
    close: EventSource<ITransportCloseEvent>;
    error: EventSource<ITransportEvent>;
    message: EventSource<ITransportMessageEvent>;
  };

  close(): void;
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
}

export interface ITransport {
  new (address: string): ITransportInstance;
}
