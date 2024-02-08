export interface ITransportEvent {
  type: string;
}

export interface ITransportCloseEvent extends ITransportEvent {
  readonly code?: number;
  readonly reason?: string;
}

export interface ITransportMessageEvent extends ITransportEvent {
  data: Uint8Array;
}

export interface ITransportInstance {
  readonly CONNECTING: number; // 0
  readonly OPEN: number; // 1
  readonly CLOSING: number; // 2
  readonly CLOSED: number; // 3

  readonly readyState: number;

  addEventListener(type: "close", listener: (this: ITransportInstance, ev: ITransportCloseEvent) => unknown): void; // prettier-ignore
  addEventListener(type: "message", listener: (this: ITransportInstance, ev: ITransportMessageEvent) => unknown): void; // prettier-ignore
  addEventListener(type: "open" | "error", listener: (this: ITransportInstance, ev: ITransportEvent) => unknown): void; // prettier-ignore

  removeEventListener(type: "close", listener: (this: ITransportInstance, ev: ITransportCloseEvent) => unknown): void; // prettier-ignore
  removeEventListener(type: "message", listener: (this: ITransportInstance, ev: ITransportMessageEvent) => unknown): void; // prettier-ignore
  removeEventListener(type: "open" | "error", listener: (this: ITransportInstance, ev: ITransportEvent) => unknown): void; // prettier-ignore

  close(): void;
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
}

export interface ITransport {
  new (address: string): ITransportInstance;
}
