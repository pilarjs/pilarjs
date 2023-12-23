## 🧬 Introduction

![](https://badgen.net/npm/v/@yomo/presence)

`Presencejs` is a JavaScript library that enables the creation of real-time web
applications with a secure, low-latency, and high-performance geo-distributed
architecture.

Key Features:

- **Geo-distributed Architecture**: Deploy your real-time backend close to users
  all over the world for better performance.
- **WebTransport Support**: WebTransport is an new API that offers low-latency,
  bidirectional, client-server messaging.
- **Secure**, **low-latency**, and **high-performance**: PresenceJS prioritizes
  security, speed, and performance for a seamless user experience.
- **Real-time and collaborative experience**: With PresenceJS, components
  receive data flow in real time, ensuring fast and reactive UI by offering the
  flexibility to send either unreliable or reliable data
- **Easy to use**: PresenceJS is simple to implement, making it an accessible
  solution for developers.
- **Free for self-managed hosting**: PresenceJS is free to use for self-managed
  hosting, making it an affordable choice for projects of any size.

## 🌟 Showcase

These React Serverless Components are built with `presencejs`:

### 👯‍♀️ GroupHug

> Live collaborator avatars for multiplayer web apps

<img width="800" alt="image" src="https://user-images.githubusercontent.com/65603/225336005-56f3605e-a150-4c9a-891c-fc5f51f46c5c.png">

- [Preview](https://allegrocloud.io/preview/clewfjysp0008osvwuina6qnf)
- Source code: [./components/react/grouphug-react](./components/react/group-hug)

## 🥷🏼 Quick Start

### 1. Add `presencejs` to your web app

Using npm

```
$ npm i --save @yomo/presence
```

Using bun.js

```
$ bun add @yomo/presence
```

Using pnpm

```
$ pnpm i @yomo/presence
```

#### Create a `Presence` instance

```js
import Presence from "@yomo/presence";

// create an instance.
const p = new Presence("https://prsc.yomo.dev", {
  url: process.env.NEXT_PUBLIC_PRESENCE_URL,
  publicKey: process.env.NEXT_PUBLIC_PRESENCE_PUBLIC_KEY,
  id,
  appId: process.env.NEXT_PUBLIC_APP_ID,
  debug: true,
});

p.on("connected", () => {
  console.log("Connected to server: ", p.host);
});
```

#### Create `Channel`

add subscribe to peers online event:

```js
const c = p.joinChannel('group-hug', myState);

c.subscribePeers((peers) => {
    peers.forEach((peer) => {
      console.log(peer + " is online")
    }
});
```

#### Broadcast messages to all peers in this channel

```js
const cb = () => {
  const state = document.hidden ? "away" : "online";
  c.broadcast("hidden-state-change", { state });
};
document.addEventListener("visibilitychange", cb);
```

#### Subscribe messages from the other peers

```js
const unsubscribe = channel.subscribe(
  "hidden-state-change",
  ({ payload, peerState }) => {
    console.log(`${peerState.id} change visibility to: ${payload}`);
  },
);
```

### 2. Start `prscd` backend service

see [prscd](./prscd)

## 🤹🏻‍♀️ API

### Presence

- `joinChannel`: return a `Channel` object

### Channel

- `subscribePeers`: observe peers online and offline events.
- `broadcast`: broadcast events to all other peers.
- `subscribe`: observe events indicated
- `leave`: leave from a `Channel`

## 🏡 Self-managed hosting

### Tutorial: Single node on Digital Ocean

### Tutorial: Geo-distributed system on AWS

### Tutorial: Geo-distributed system on Azure

## License

The [MIT License](./LICENSE).
