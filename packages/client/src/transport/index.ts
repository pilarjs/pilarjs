import type { Observable } from "../lib/EventSource";

export interface ITransportEvent {
  type: "open" | "error" | "close" | "message";
}

export interface ITransportCloseEvent extends ITransportEvent {
  readonly code: number;
  readonly reason: string;
}

export interface ITransportMessageEvent extends ITransportEvent {
  data: Uint8Array;
}

export enum TransportReadyState {
  CONNECTING = 0,
  OPEN = 1,
  CLOSING = 2,
  CLOSED = 3,
}

export interface ITransportInstance {
  readonly readyState: TransportReadyState;

  readonly events: {
    open: Observable<ITransportEvent>;
    close: Observable<ITransportCloseEvent>;
    error: Observable<ITransportEvent>;
    message: Observable<ITransportMessageEvent>;
  };

  close(): void;
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
}

export interface ITransport {
  new (address: string): ITransportInstance;
}
