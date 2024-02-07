import { msgpack } from "./lib/MessagePack";
import { Transport as WebTransport } from "./transport/WebTransport";

export function createClient(): void {
  console.log("do createClient");
  const uid = "uu1";
  const transport = new WebTransport(
    `https://lo.yomo.dev:8443/v1?publickey=kmJAUnCtkWbkNnhXYtZAGEJzGDGpFo1e1vkp6cm&id=${uid}`
  );

  const p = { t: "control", op: "channel_join", c: "room-1" };
  const buf = msgpack.encode(p);
  console.log(buf);

  setTimeout(() => {
    transport.send(buf);
  }, 200);
}
