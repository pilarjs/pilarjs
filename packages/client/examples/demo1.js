import { createClient } from "../dist/index.mjs";

const uid = Math.random().toString(36).slice(2);
const client = createClient({
  url: "wss://lo.yomo.dev:8443/v1",
  publicKey: "kmJAUnCtkWbkNnhXYtZAGEJzGDGpFo1e1vkp6cm",
  uid: uid,
});

const { channel } = client.join("room-1");
setTimeout(() => {
  channel.broadcast("speak", { msg: "world" });
}, 10);
