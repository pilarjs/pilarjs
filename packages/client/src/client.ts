import { createChannel, type Channel } from "./channel";
import { ManagedSocket, type Status } from "./connection";
import { msgpack } from "./lib/MessagePack";
import { Transport as WsTransport } from './transport/WebSocket';

const MIN_THROTTLE = 16;
const MAX_THROTTLE = 1_000;
const DEFAULT_THROTTLE = 100;

const MIN_BACKGROUND_KEEP_ALIVE_TIMEOUT = 15_000;
const MIN_LOST_CONNECTION_TIMEOUT = 200;
const RECOMMENDED_MIN_LOST_CONNECTION_TIMEOUT = 1_000;
const MAX_LOST_CONNECTION_TIMEOUT = 30_000;
const DEFAULT_LOST_CONNECTION_TIMEOUT = 5_000;

export type Client = {
  join(
    channelId: string
  ): {
    channel: Channel;
    leave: () => void;
  };

  getChannel(channelId: string): Channel | null;

  /**
   * Purges all cached auth tokens and reconnects all rooms that are still
   * connected, if any.
   *
   * Call this whenever you log out a user in your application.
   */
  logout(): void;
};

export type ClientOptions = {
  url: string;
  publicKey: string;
  uid: string;
  throttle?: number; // in milliseconds
  lostConnectionTimeout?: number; // in milliseconds
  backgroundKeepAliveTimeout?: number; // in milliseconds
  
  autoConnect?: boolean;
};

export function createClient(options: ClientOptions): Client {
  const throttle = checkBounds(
    "throttle",
    options.throttle ?? DEFAULT_THROTTLE,
    MIN_THROTTLE,
    MAX_THROTTLE
  );

  const lostConnectionTimeout = checkBounds(
    "lostConnectionTimeout",
    options.lostConnectionTimeout ?? DEFAULT_LOST_CONNECTION_TIMEOUT,
    MIN_LOST_CONNECTION_TIMEOUT,
    MAX_LOST_CONNECTION_TIMEOUT,
    RECOMMENDED_MIN_LOST_CONNECTION_TIMEOUT
  );

  const backgroundKeepAliveTimeout = options.backgroundKeepAliveTimeout
    ? checkBounds(
        "backgroundKeepAliveTimeout",
        options.backgroundKeepAliveTimeout,
        MIN_BACKGROUND_KEEP_ALIVE_TIMEOUT
      )
    : undefined;

  const messageBuffer: any[] = []
  function doSendMessages() {
    const messages = messageBuffer.splice(0, messageBuffer.length);
    for (const message of messages) {
      managedSocket.send(msgpack.encode(message));
    }
  }

  const managedSocket = new ManagedSocket({
    authenticate:  () => Promise.resolve('no_auth'),
    createTransport: () => new WsTransport(`${options.url}?publickey=${options.publicKey}&id=${options.uid}`),
    canZombie: () => false,
  }, true)

  function onStatusDidChange(newStatus: Status) {}

  function onDidConnect() {
    doSendMessages()
  }

  function onDidDisconnect() {}

  managedSocket.events.onMessage.subscribe(handleServerMessage);
  managedSocket.events.statusDidChange.subscribe(onStatusDidChange);
  managedSocket.events.didConnect.subscribe(onDidConnect);
  managedSocket.events.didDisconnect.subscribe(onDidDisconnect);

  managedSocket.connect()

  function handleServerMessage(data: Uint8Array) {
    const event  = msgpack.decode(data) as Record<string, any>
    console.log(event);
    if (event.op === 'channel_join') {
      const channelId = event.c as string
      const channel = getChannel(channelId)
      if (channel) {
        channel.handleEvent('joined', event)
      }

      return
    }

    if (event.op === 'peer_online') {
      if (event.p !== options.uid) {
        const channelId = event.c as string
        const channel = getChannel(channelId)
        if (channel) {
          channel.handleEvent('peer_online', event)
        }
      }
    }

    if (event.op === 'peer_offline') {
      if (event.p !== options.uid) {
        const channelId = event.c as string
        const channel = getChannel(channelId)
        if (channel) {
          channel.handleEvent('peer_offline', event)
        }
      }
    }

    if (event.t === 'data') {
      const channelId = event.c as string
      const channel = getChannel(channelId)
      if (channel) {
        const payload = msgpack.decode(event.pl as Uint8Array) as Record<string, any>
        channel.handleEvent('data', { p: event.p as string, pl: payload})
      }

      return
    }

    if (event.op === 'peer_state') {
      const channelId = event.c as string
      const channel = getChannel(channelId)
      if (channel) {
        channel.handleEvent('peer_state', event)
      }
    }
  }

  function sendMessages(messages: any[]) {
    for (const message of messages) {
      messageBuffer.push(message);
    }

    if (managedSocket.getStatus() === "connected") {
      doSendMessages();
    }
  }

  type ChannelInfo = {
    channel: Channel;
    unsubs: Set<() => void>;
  };

  const channelsById = new Map<string, ChannelInfo>();

  function teardownChannel(channel: Channel) {
    channelsById.delete(channel.id);
    channel.destroy();
  }

  function leaseChannel(info: ChannelInfo): {
    channel: Channel;
    leave: () => void;
  } {
    // Create a new self-destructing leave function
    const leave = () => {
      const self = leave; // A reference to the currently executing function itself

      if (!info.unsubs.delete(self)) {
        console.warn(
          "This leave function was already called. Calling it more than once has no effect."
        );
      } else {
        // Was this the last channel lease? If so, tear down the channel
        if (info.unsubs.size === 0) {
          teardownChannel(info.channel);
        }
      }
    };

    info.unsubs.add(leave);
    return {
      channel: info.channel,
      leave,
    };
  }

  function join(
    channelId: string,
  ): {
    channel: Channel;
    leave: () => void;
  } {
    const existing = channelsById.get(channelId);
    if (existing !== undefined) {
      return leaseChannel(existing);
    }

    const newChannel = createChannel({
      id: channelId,
      initialPresence: {},
      sendMessages,
    });

    const newChannelInfo: ChannelInfo = {
      channel: newChannel,
      unsubs: new Set(),
    };

    channelsById.set(channelId, newChannelInfo);

    return leaseChannel(newChannelInfo);
  }

  function getChannel(channelId: string): Channel | null {
    const channel = channelsById.get(channelId)?.channel;
    return channel ? channel : null;
  }


  function logout() {
    // TODO
  }

  return {
    join,
    getChannel,
    logout,
  };
}

function checkBounds(
  option: string,
  value: unknown,
  min: number,
  max?: number,
  recommendedMin?: number
): number {
  if (
    typeof value !== "number" ||
    value < min ||
    (max !== undefined && value > max)
  ) {
    throw new Error(
      max !== undefined
        ? `${option} should be between ${recommendedMin ?? min} and ${max}.`
        : `${option} should be at least ${recommendedMin ?? min}.`
    );
  }
  return value;
}
