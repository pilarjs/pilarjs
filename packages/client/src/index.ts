import { msgpack } from "./lib/MessagePack";
import { Transport as WebTransport } from "./transport/WebTransport";

export function createClient(): void {
  console.log("do createClient");
  const uid = "uu1";
  const transport = new WebTransport(
    `https://lo.yomo.dev:8443/v1?publickey=kmJAUnCtkWbkNnhXYtZAGEJzGDGpFo1e1vkp6cm&id=${uid}`
  );

  transport.addEventListener("open", function (a) {
    console.log("in open events", a);
    console.log(this);
  });

  transport.addEventListener("message", function (e) {
    console.log("get message");
    console.log(e);
  });

  const socket = new WebSocket(
    "wss://lo.yomo.dev:8443/v1?publickey=kmJAUnCtkWbkNnhXYtZAGEJzGDGpFo1e1vkp6cm&id=uu2"
  );

  socket.binaryType = "arraybuffer";

  socket.onopen = function (e) {
    console.log("socket open", e);
  };

  socket.onmessage = function (e) {
    console.log("socket message", e);
  };

  socket.addEventListener("close", (ev) => {
    console.log("socket close");
    console.log(ev);
  });

  setTimeout(() => {
    const p = {
      t: "control",
      op: "channel_join",
      c: "room-1",
    };
    const buf = msgpack.encode(p);
    console.log(buf);
    transport.send(buf);
    socket.send(buf);

    socket.close(3002, "233");
  }, 200);
}
