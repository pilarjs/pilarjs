import { makeEventSource, type EventSource } from "./lib/EventSource";
import { msgpack } from "./lib/MessagePack";

export type ChannelOptions = {
  id: string;
  initialPresence: Record<string, unknown>;
  sendMessages: (messages: any[]) => void;
};

export type Channel = {
  /**
   * The id of the channel.
   */
  id: string;
  /**
   * Handle an event from the channel.
   */
  handleEvent(eventType: 'joined' | 'data' | 'peer_online' | 'peer_offline' | 'peer_state', event: any): void;

  /**
   * Broadcast an event to the channel.
   */
  broadcast<T>(event: string, data: T): void;

  events: {
    peerOnline: EventSource<unknown>;
    peerOffline: EventSource<unknown>;
    peerState: EventSource<unknown>;
    data: EventSource<unknown>;
  }

  destroy(): void;
};

export function createChannel(options: ChannelOptions): Channel {
  const state = {}
  options.sendMessages([{
    t: "control",
    op: "channel_join",
    c: options.id,
  }]);

  const events = {
    peerOnline: makeEventSource(),
    peerOffline: makeEventSource(),
    peerState: makeEventSource(),
    data: makeEventSource(),
  }

  function handleEvent(eventType: 'joined' | 'data' | 'peer_online' | 'peer_offline', event: any) {
    if (eventType === 'joined') {
      options.sendMessages([{
        t: 'control',
        op: 'peer_online',
        c: options.id,
      }]);

      return
    }

    if (eventType === 'data') {
      const payload = event as Record<string, any>;
      events.data.notify(payload);
      return
    }

    if (eventType === 'peer_online') {
      const payload = event as Record<string, any>;
      syncState()
      events.peerOnline.notify(payload);
      return
    }

    if (eventType === 'peer_offline') {
      const payload = event as Record<string, any>;
      events.peerOffline.notify(payload);
      return
    }

    if (eventType === 'peer_state') {
      const payload = event as Record<string, any>;
      events.peerState.notify(payload);
      return
    }
  }

  function broadcast<T>(event: string, data: T) {
    options.sendMessages([{
      t: 'data',
      c: options.id,
      pl: msgpack.encode({
        event, data,
      }),
    }]);
  }

  function syncState() {
    options.sendMessages([{
      t: 'control',
      op: 'peer_state',
      c: options.id,
      // p: this.#state.id,
      pl: msgpack.encode(state)
    }]);
  }

  return {
    id: options.id,
    handleEvent,
    broadcast,
    events,
    destroy() {
      // Clean up the channel
    },
  };
}
