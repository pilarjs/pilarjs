import { assertNever } from "./lib/assert";
import { makeEventSource, type Observable } from "./lib/EventSource";
import * as console from "./lib/fancy-console";
import { FSM, type BuiltinEvent, type Patchable, type Target } from "./lib/fsm";
import { withTimeout } from "./lib/utils";
import {
  TransportEventType,
  TransportReadyState,
  type ITransportCloseEvent,
  type ITransportEvent,
  type ITransportInstance,
  type ITransportMessageEvent,
} from "./transport";

/**
 * Returns a human-readable status indicating the current connection status of
 * a Room, as returned by `room.getStatus()`. Can be used to implement
 * a connection status badge.
 */
export type Status =
  | "initial"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

/**
 * Whether or not the status is an "idle" state. Here, idle means that nothing
 * will happen until some action is taken. Unsurprisingly, these statuses match
 * the start and end states of the state machine.
 */
export function isIdle(status: Status): status is "initial" | "disconnected" {
  return status === "initial" || status === "disconnected";
}

/**
 * Used to report about app-level reconnection issues.
 *
 * Normal (quick) reconnects won't be reported as a "lost connection". Instead,
 * the application will only get an event if the reconnection attempts by the
 * client are taking (much) longer than usual. Definitely a situation you want
 * to inform your users about, for example, by throwing a toast message on
 * screen, or show a "trying to reconnect" banner.
 */
export type LostConnectionEvent =
  | "lost" // the client is trying to reconnect to server, but it's taking (much) longer than usual
  | "restored" // the client did reconnect after all
  | "failed"; // the client was told to stop trying

/**
 * Maps internal machine state to the public Status API.
 */
function toConnectionStatus(machine: FSM<Context, Event, State>): Status {
  const state = machine.currentState;
  switch (state) {
    case "@ok.connected":
    case "@ok.awaiting-pong":
      return "connected";

    case "@idle.initial":
      return "initial";

    case "@auth.busy":
    case "@auth.backoff":
    case "@connecting.busy":
    case "@connecting.backoff":
    case "@idle.zombie":
      return machine.context.successCount > 0 ? "reconnecting" : "connecting";

    case "@idle.failed":
      return "disconnected";

    // istanbul ignore next
    default:
      return assertNever(state, "Unknown state");
  }
}

/**
 * Events that can be sent to the machine externally.
 */
type Event =
  // Public events that can be called on the connection manager
  | { type: "CONNECT" } // e.g. when trying to enter a room
  | { type: "RECONNECT" } // e.g. user asking for an explicit reconnect of the socket
  | { type: "DISCONNECT" } // e.g. leaving the room
  | { type: "WINDOW_GOT_FOCUS" } // e.g. user's browser tab is refocused
  | { type: "NAVIGATOR_ONLINE" } // e.g. browser gets back online
  | { type: "NAVIGATOR_OFFLINE" } // e.g. browser goes offline

  // Events that the connection manager will internally deal with
  | { type: "PONG" }
  | { type: "EXPLICIT_SOCKET_ERROR"; event: ITransportEvent }
  | { type: "EXPLICIT_SOCKET_CLOSE"; event: ITransportCloseEvent }

  // Only used by the E2E testing app, to simulate a pong timeout :(
  | { type: "PONG_TIMEOUT" };

type State =
  | "@idle.initial"
  | "@idle.failed"
  | "@idle.zombie"
  | "@auth.busy"
  | "@auth.backoff"
  | "@connecting.busy"
  | "@connecting.backoff"
  | "@ok.connected"
  | "@ok.awaiting-pong";

type Context = {
  /**
   * Count the number of times the machine reaches an "@ok.*" state. Once the
   * machine reaches idle state again, this count is reset to 0 again.
   *
   * This lets us distinguish:
   * - If successCount = 0, then it's an initial "connecting" state.
   * - If successCount > 0, then it's an "reconnecting" state.
   */
  successCount: number;

  /**
   * Will be populated with the last known auth authValue.
   */
  authValue: string | null;

  /**
   * The current active transport connection to the server. If this is not null
   * on the context, then the transport has successfully been opened.
   */
  transport: ITransportInstance | null;

  /**
   * The current retry delay when automatically retrying. Will get bumped to
   * the next "tier" every time a connection attempt fails. Reset every time
   * a connection succeeded.
   */
  backoffDelay: number;
};

const BACKOFF_DELAYS = [250, 500, 1_000, 2_000, 4_000, 8_000, 10_000] as const;

// Resetting the delay happens upon success. We could reset to 0, but that
// would risk no delay, which generally isn't wise. Instead, we'll reset it to
// the lowest safe delay minus 1 millisecond. The reason is that every time
// a retry happens, the retry delay will first be bumped to the next "tier".
const RESET_DELAY = BACKOFF_DELAYS[0] - 1;

/**
 * Used to back off from reconnection attempts after a known
 * server issue, like "channel full" or a "rate limit" error.
 */
const BACKOFF_DELAYS_SLOW = [2_000, 30_000, 60_000, 300_000] as const;

/**
 * The client will send a PING to the server every 28 seconds, after which it
 * must receive a PONG back within the next 2 seconds. If that doesn't happen,
 * this is interpreted as an implicit connection loss event.
 */
const HEARTBEAT_INTERVAL = 28_000;
const PONG_TIMEOUT = 2_000;

/**
 * Maximum amount of time that the authentication delegate take to return an
 * auth authValue, or else we consider authentication timed out.
 */
const AUTH_TIMEOUT = 10_000;

/**
 * Maximum amount of time that the connect delegate may take to return
 * an opened connection, or else we consider the attempt timed out.
 */
const TRANSPORT_CONNECT_TIMEOUT = 10_000;

/**
 * Special error class that can be thrown during authentication to stop the
 * connection manager from retrying.
 */
export class StopRetrying extends Error {
  constructor(reason: string) {
    super(reason);
  }
}

export class PilarjsError extends Error {
  /** @internal */
  constructor(
    message: string,
    public code: number
  ) {
    super(message);
  }
}

function nextBackoffDelay(
  currentDelay: number,
  delays: readonly number[]
): number {
  return (
    delays.find((delay) => delay > currentDelay) ?? delays[delays.length - 1]
  );
}

function increaseBackoffDelay(context: Patchable<Context>) {
  context.patch({
    backoffDelay: nextBackoffDelay(context.backoffDelay, BACKOFF_DELAYS),
  });
}

function increaseBackoffDelayAggressively(context: Patchable<Context>) {
  context.patch({
    backoffDelay: nextBackoffDelay(context.backoffDelay, BACKOFF_DELAYS_SLOW),
  });
}

function resetSuccessCount(context: Patchable<Context>) {
  context.patch({ successCount: 0 });
}

enum LogLevel {
  INFO,
  WARN,
  ERROR,
}

/**
 * Generic "log" effect. Use it in `effect` handlers of state transitions.
 */
function log(level: LogLevel, message: string) {
  const logger =
    level === LogLevel.ERROR
      ? console.error
      : level === LogLevel.WARN
        ? console.warn
        : /* black hole */ () => {};
  return () => {
    logger(message);
  };
}

function logPrematureErrorOrCloseEvent(e: ITransportEvent | Error) {
  // Produce a useful log message
  const conn = "Connection to server";
  return (ctx: Readonly<Context>) => {
    if (e instanceof Error) {
      console.warn(`${conn} could not be established. ${String(e)}`);
    } else {
      console.warn(
        isCloseEvent(e)
          ? `${conn} closed prematurely. Retrying in ${ctx.backoffDelay}ms.`
          : `${conn} could not be established.`
      );
    }
  };
}

function logCloseEvent(event: ITransportCloseEvent) {
  const details = [`code: ${event.code}`];
  if (event.reason) {
    details.push(`reason: ${event.reason}`);
  }
  return (ctx: Readonly<Context>) => {
    console.warn(
      `Connection to server closed (${details.join(", ")}). Retrying in ${ctx.backoffDelay}ms.`
    );
  };
}

const logPermanentClose = log(
  LogLevel.WARN,
  "Connection closed permanently. Won't retry."
);

function isCloseEvent(
  error: ITransportEvent | Error
): error is ITransportEvent {
  return !(error instanceof Error) && error.type === TransportEventType.CLOSE;
}

export type Delegates = {
  authenticate: () => Promise<string>;
  createTransport: () => ITransportInstance;
  canZombie: () => boolean;
};

// istanbul ignore next
function enableTracing(machine: FSM<Context, Event, State>) {
  const start = new Date().getTime();

  function log(...args: unknown[]) {
    console.warn(
      `${((new Date().getTime() - start) / 1000).toFixed(2)} [FSM #${
        machine.id
      }]`,
      ...args
    );
  }
  const unsubs = [
    machine.events.didReceiveEvent.subscribe((e) => log(`Event ${e.type}`)),
    machine.events.willTransition.subscribe(({ from, to }) =>
      log("Transitioning", from, "→", to)
    ),
    machine.events.didIgnoreEvent.subscribe((e) =>
      log("Ignored event", e.type, e, "(current state won't handle it)")
    ),
    // machine.events.willExitState.subscribe((s) => log("Exiting state", s)),
    // machine.events.didEnterState.subscribe((s) => log("Entering state", s)),
  ];
  return () => {
    for (const unsub of unsubs) {
      unsub();
    }
  };
}

function defineConnectivityEvents(machine: FSM<Context, Event, State>) {
  // Emitted whenever a new WebSocket connection attempt succeeds
  const statusDidChange = makeEventSource<Status>();
  const didConnect = makeEventSource<void>();
  const didDisconnect = makeEventSource<void>();

  let lastStatus: Status | null = null;

  const unsubscribe = machine.events.didEnterState.subscribe(() => {
    const currStatus = toConnectionStatus(machine);
    if (currStatus !== lastStatus) {
      statusDidChange.notify(currStatus);
    }

    if (lastStatus === "connected" && currStatus !== "connected") {
      didDisconnect.notify();
    } else if (lastStatus !== "connected" && currStatus === "connected") {
      didConnect.notify();
    }
    lastStatus = currStatus;
  });

  return {
    statusDidChange: statusDidChange.observable,
    didConnect: didConnect.observable,
    didDisconnect: didDisconnect.observable,
    unsubscribe,
  };
}

const assign = (patch: Partial<Context>) => (ctx: Patchable<Context>) =>
  ctx.patch(patch);

function createConnectionStateMachine(
  delegates: Delegates,
  options: {
    enableDebugLogging: boolean;
  }
) {
  // Create observable event sources, which this machine will call into when
  // specific events happen
  const onMessage = makeEventSource<Uint8Array>();
  onMessage.pause(); // Pause all message delivery until status is OPEN

  // Emitted whenever the server deliberately closes the connection for
  // a specific Pilarjs reason
  const onPilarjsError = makeEventSource<PilarjsError>();

  function fireErrorEvent(errmsg: string, errcode: number) {
    return () => {
      const err = new PilarjsError(errmsg, errcode);
      onPilarjsError.notify(err);
    };
  }

  const initialContext: Context & { authValue: string | null } = {
    successCount: 0,
    authValue: null,
    transport: null,
    backoffDelay: RESET_DELAY,
  };

  // The `machine` is the actual finite state machine instance that will
  // maintain the WebSocket's connection
  const machine = new FSM<Context, Event, State>(initialContext)
    .addState("@idle.initial")
    .addState("@idle.failed")
    .addState("@idle.zombie")
    .addState("@auth.busy")
    .addState("@auth.backoff")
    .addState("@connecting.busy")
    .addState("@connecting.backoff")
    .addState("@ok.connected")
    .addState("@ok.awaiting-pong");

  //
  // Configure events that can happen from anywhere
  //
  // It's always possible to explicitly get a .reconnect() or .disconnect()
  // from the user.
  //
  machine.addTransitions("*", {
    RECONNECT: {
      target: "@auth.backoff",
      effect: [increaseBackoffDelay, resetSuccessCount],
    },

    DISCONNECT: "@idle.initial",
  });

  //
  // Configure the @idle.* states
  //
  machine
    .onEnter("@idle.*", resetSuccessCount)

    .addTransitions("@idle.*", {
      CONNECT: (_, ctx) =>
        // If we still have a known authValue, try to reconnect to the socket directly,
        // otherwise, try to obtain a new authValue
        ctx.authValue !== null ? "@connecting.busy" : "@auth.busy",
    });

  //
  // Configure the @auth.* states
  //
  machine
    .addTransitions("@auth.backoff", {
      NAVIGATOR_ONLINE: {
        target: "@auth.busy",
        effect: assign({ backoffDelay: RESET_DELAY }),
      },
    })
    .addTimedTransition(
      "@auth.backoff",
      (ctx) => ctx.backoffDelay,
      "@auth.busy"
    )

    .onEnterAsync(
      "@auth.busy",

      () =>
        withTimeout(
          delegates.authenticate(),
          AUTH_TIMEOUT,
          "Timed out during auth"
        ),

      // On successful authentication
      (okEvent) => ({
        target: "@connecting.busy",
        effect: assign({
          authValue: okEvent.data,
        }),
      }),

      // Auth failed
      (failedEvent) => {
        if (failedEvent.reason instanceof StopRetrying) {
          return {
            target: "@idle.failed",
            effect: [
              log(LogLevel.ERROR, failedEvent.reason.message),
              fireErrorEvent(failedEvent.reason.message, -1),
            ],
          };
        }

        return {
          target: "@auth.backoff",
          effect: [
            increaseBackoffDelay,
            log(
              LogLevel.ERROR,
              `Authentication failed: ${
                failedEvent.reason instanceof Error
                  ? failedEvent.reason.message
                  : String(failedEvent.reason)
              }`
            ),
          ],
        };
      }
    );

  //
  // Configure the @connecting.* states
  //

  // Function references
  const onSocketError = (event: ITransportEvent) =>
    machine.send({ type: "EXPLICIT_SOCKET_ERROR", event });

  const onSocketClose = (event: ITransportCloseEvent) =>
    machine.send({ type: "EXPLICIT_SOCKET_CLOSE", event });

  const onSocketMessage = (event: ITransportMessageEvent) =>
    // event.data === "pong"
    //   ? machine.send({ type: "PONG" })
    //   :
    onMessage.notify(event.data);

  function teardownTransport(transport: ITransportInstance | null) {
    transport?.close();
  }

  machine
    .addTransitions("@connecting.backoff", {
      NAVIGATOR_ONLINE: {
        target: "@connecting.busy",
        effect: assign({ backoffDelay: RESET_DELAY }),
      },
    })
    .addTimedTransition(
      "@connecting.backoff",
      (ctx) => ctx.backoffDelay,
      "@connecting.busy"
    )

    .onEnterAsync(
      "@connecting.busy",

      //
      // Use the "createTransport" delegate function (provided to the
      // ManagedSocket) to create the actual transport instance.
      // Then, set up all the necessary event listeners, and wait for the
      // "open" event to occur.
      //
      // When the "open" event happens, we're ready to transition to the
      // OK state. This is done by resolving the Promise.
      //
      async (ctx, signal) => {
        let capturedPrematureEvent: ITransportEvent | null = null;
        let unconfirmedSocket: ITransportInstance | null = null;

        const connect$ = new Promise<[ITransportInstance, () => void]>(
          (resolve, rej) => {
            const socket = delegates.createTransport();
            unconfirmedSocket = socket;

            function reject(event: ITransportEvent) {
              capturedPrematureEvent = event;
              socket.events.message.clear();
              rej(event);
            }

            //
            // Part 1:
            // The `error` and `close` event handlers marked (*) are installed
            // here only temporarily, just to handle this promise-based state.
            // When those get triggered, we reject this promise.
            //
            socket.events.message.subscribe(onSocketMessage);
            const unsubError = socket.events.error.subscribe(reject); // (*)
            const unsubClose = socket.events.close.subscribe(reject); // (*)
            socket.events.open.subscribe(() => {
              //
              // Part 2:
              // The "open" event just fired, so the server accepted our
              // attempt to connect. We'll go on and resolve() our promise as
              // a result.
              //
              // However, we cannot safely remove our error/close rejection
              // handlers _just yet_. There is a small, unlikely-but-possible
              // edge case: if (and only if) any close/error events are
              // _already_ queued up in the event queue before this handler is
              // invoked, then those will fire before our promise will be
              // resolved.
              //
              // Scenario:
              // - Event queue is empty, listeners are installed
              // - Two events synchronously get scheduled in the event queue: [<open event>, <close event>]
              // - The open handler is invoked (= this very callback)
              // - Event queue now looks like: [<close event>]
              // - We happily continue and resolve the promise
              // - Event queue now looks like: [<close event>, <our resolved promise>]
              // - Close event handler fires, but we already resolved promise! 😣
              //
              // This is what's called a "premature" event here, we'll deal
              // with it in part 3.
              //

              socket.events.error.subscribe(onSocketError);
              socket.events.close.subscribe(onSocketClose);
              const unsub = () => {
                unsubError(); // Remove (*)
                unsubClose(); // Remove (*)
              };

              // All messages received in the mean time while waiting for the
              // green light will be played back to the client after the
              // transition to "connected".
              resolve([socket, unsub]);
            });
          }
        );

        return withTimeout(
          connect$,
          TRANSPORT_CONNECT_TIMEOUT,
          "Timed out during websocket connection"
        )
          .then(
            //
            // Part 3:
            // By now, our "open" event has fired, and the promise has been
            // resolved. Two possible scenarios:
            //
            // 1. The happy path. Most likely.
            // 2. Uh-oh. A premature close/error event has been observed. Let's
            //    reject the promise after all.
            //
            // Any close/error event that will get scheduled after this point
            // onwards, will be caught in the OK state, and dealt with
            // accordingly.
            //
            ([socket, unsub]) => {
              unsub();

              if (signal.aborted) {
                // Trigger cleanup logic in .catch() below. At this point, the
                // promise is already cancelled, so none of the ok/err
                // transitions will take place.
                throw new Error("Aborted");
              }

              if (capturedPrematureEvent) {
                throw capturedPrematureEvent; // Take failure transition
              }

              return socket;
            }
          )
          .catch((e) => {
            teardownTransport(unconfirmedSocket);
            throw e;
          });
      },

      // Only transition to OK state after a successfully opened WebSocket connection
      (okEvent) => ({
        target: "@ok.connected",
        effect: assign({
          transport: okEvent.data,
          backoffDelay: RESET_DELAY,
        }),
      }),

      // If the WebSocket connection cannot be established
      (failure) => {
        const err = failure.reason as ITransportEvent | StopRetrying | Error;

        // Stop retrying if this promise explicitly tells us so. This should,
        // in the case of a WebSocket connection attempt only be the case if
        // there is a configuration error.
        if (err instanceof StopRetrying) {
          return {
            target: "@idle.failed",
            effect: [
              log(LogLevel.ERROR, err.message),
              fireErrorEvent(err.message, -1),
            ],
          };
        }

        // If the server actively refuses the connection attempt, stop trying.
        if (isCloseEvent(err)) {
          const e = err as ITransportCloseEvent;
          return {
            target: "@idle.failed",
            effect: [
              log(LogLevel.ERROR, e.reason),
              fireErrorEvent(e.reason, e.code),
            ],
          };
        }

        // In all other (unknown) cases, always re-authenticate (but after a back-off)
        return {
          target: "@auth.backoff",
          effect: [increaseBackoffDelay, logPrematureErrorOrCloseEvent(err)],
        };
      }
    );

  //
  // Configure the @ok.* states
  //
  // Keeps a heartbeat alive with the server whenever in the @ok.* state group.
  // 30 seconds after entering the "@ok.connected" state, it will emit
  // a heartbeat, and awaits a PONG back that should arrive within 2 seconds.
  // If this happens, then it transitions back to normal "connected" state, and
  // the cycle repeats. If the PONG is not received timely, then we interpret
  // it as an implicit connection loss, and transition to reconnect (throw away
  // this socket, and open a new one).
  //

  const sendHeartbeat: Target<Context, Event | BuiltinEvent, State> = {
    target: "@ok.awaiting-pong",
    effect: (ctx) => {
      ctx.transport?.send("ping");
    },
  };

  const maybeHeartbeat: Target<Context, Event | BuiltinEvent, State> = () => {
    // If the browser tab isn't visible currently, ask the application if going
    // zombie is fine
    const doc = typeof document !== "undefined" ? document : undefined;
    const canZombie =
      doc?.visibilityState === "hidden" && delegates.canZombie();
    return canZombie ? "@idle.zombie" : sendHeartbeat;
  };

  // machine
  //   .addTimedTransition("@ok.connected", HEARTBEAT_INTERVAL, maybeHeartbeat)
  //   .addTransitions("@ok.connected", {
  //     NAVIGATOR_OFFLINE: maybeHeartbeat, // Don't take the browser's word for it when it says it's offline. Do a ping/pong to make sure.
  //     WINDOW_GOT_FOCUS: sendHeartbeat,
  //   });

  machine.addTransitions("@idle.zombie", {
    WINDOW_GOT_FOCUS: "@connecting.backoff", // When in zombie state, the client will try to wake up automatically when the window regains focus
  });

  machine
    .onEnter("@ok.*", (ctx) => {
      ctx.patch({ successCount: ctx.successCount + 1 });

      const timerID = setTimeout(
        // On the next tick, start delivering all messages that have already
        // been received, and continue synchronous delivery of all future
        // incoming messages.
        onMessage.unpause,
        0
      );

      // ...but when *leaving* OK state, always tear down the old socket. It's
      // no longer valid.
      return (ctx) => {
        teardownTransport(ctx.transport);
        ctx.patch({ transport: null });
        clearTimeout(timerID);
        onMessage.pause();
      };
    })

    // .addTransitions("@ok.awaiting-pong", { PONG: "@ok.connected" })
    // .addTimedTransition("@ok.awaiting-pong", PONG_TIMEOUT, {
    //   target: "@connecting.busy",
    //   // Log implicit connection loss and drop the current open socket
    //   effect: log(
    //     LogLevel.WARN,
    //     "Received no pong from server, assume implicit connection loss."
    //   ),
    // })

    .addTransitions("@ok.*", {
      // When a socket receives an error, this can cause the closing of the
      // socket, or not. So always check to see if the socket is still OPEN or
      // not. When still OPEN, don't transition.
      EXPLICIT_SOCKET_ERROR: (_, context) => {
        if (context.transport?.readyState === TransportReadyState.OPEN) {
          // TODO Do we need to forward this error to the client?
          return null; /* Do not leave OK state, socket is still usable */
        }

        return {
          target: "@connecting.backoff",
          effect: increaseBackoffDelay,
        };
      },

      EXPLICIT_SOCKET_CLOSE: (e) => {
        return {
          target: "@connecting.backoff",
          effect: [increaseBackoffDelay, logCloseEvent(e.event)],
        };
      },
    });

  // Lastly, register an event handler to listen for window-focus events as
  // soon as the machine starts, and use it to send itself "WINDOW_GOT_FOCUS"
  // events.
  if (typeof document !== "undefined") {
    const doc = typeof document !== "undefined" ? document : undefined;
    const win = typeof window !== "undefined" ? window : undefined;
    const root = win ?? doc;

    machine.onEnter("*", (ctx) => {
      function onNetworkOffline() {
        machine.send({ type: "NAVIGATOR_OFFLINE" });
      }

      function onNetworkBackOnline() {
        machine.send({ type: "NAVIGATOR_ONLINE" });
      }

      function onVisibilityChange() {
        if (doc?.visibilityState === "visible") {
          machine.send({ type: "WINDOW_GOT_FOCUS" });
        }
      }

      win?.addEventListener("online", onNetworkBackOnline);
      win?.addEventListener("offline", onNetworkOffline);
      root?.addEventListener("visibilitychange", onVisibilityChange);
      return () => {
        root?.removeEventListener("visibilitychange", onVisibilityChange);
        win?.removeEventListener("online", onNetworkBackOnline);
        win?.removeEventListener("offline", onNetworkOffline);

        // Also tear down the old socket when stopping the machine, if there is one
        teardownTransport(ctx.transport);
      };
    });
  }

  const cleanups = [];

  const { statusDidChange, didConnect, didDisconnect, unsubscribe } =
    defineConnectivityEvents(machine);
  cleanups.push(unsubscribe);

  // Install debug logging
  // istanbul ignore next
  if (options.enableDebugLogging) {
    cleanups.push(enableTracing(machine));
  }

  // Start the machine
  machine.start();

  return {
    machine,
    cleanups,

    // Observable events that will be emitted by this machine
    events: {
      statusDidChange,
      didConnect,
      didDisconnect,
      onMessage: onMessage.observable,
      onPilarjsError: onPilarjsError.observable,
    },
  };
}

/**
 * The ManagedSocket will set up a WebSocket connection to a room, and maintain
 * that connection over time.
 *
 * It's a light wrapper around the actual FSM that implements the logic,
 * exposing just a few safe actions and events that can be called or observed
 * from the outside.
 */
export class ManagedSocket {
  /** @internal */
  private machine: FSM<Context, Event, State>;
  private cleanups: (() => void)[];

  public readonly events: {
    /**
     * Emitted when the WebSocket connection goes in or out of "connected"
     * state.
     */
    readonly statusDidChange: Observable<Status>;
    /**
     * Emitted when the WebSocket connection is first opened.
     */
    readonly didConnect: Observable<void>;
    /**
     * Emitted when the current WebSocket connection is lost and the socket
     * becomes useless. A new WebSocket connection must be made after this to
     * restore connectivity.
     */
    readonly didDisconnect: Observable<void>; // Deliberate close, a connection loss, etc.

    /**
     * Emitted for every incoming message from the currently active WebSocket
     * connection.
     */
    readonly onMessage: Observable<Uint8Array>;

    /**
     * Emitted whenever a connection gets closed for a known error reason, e.g.
     * max number of connections, max number of messages, etc.
     */
    readonly onPilarjsError: Observable<PilarjsError>;
  };

  constructor(delegates: Delegates, enableDebugLogging: boolean = false) {
    const { machine, events, cleanups } = createConnectionStateMachine(
      delegates,
      { enableDebugLogging }
    );
    this.machine = machine;
    this.events = events;
    this.cleanups = cleanups;
  }

  getStatus(): Status {
    try {
      return toConnectionStatus(this.machine);
    } catch {
      return "initial";
    }
  }

  /**
   * Returns the current auth authValue.
   */
  get authValue(): string | null {
    return this.machine.context.authValue;
  }

  /**
   * Call this method to try to connect to a WebSocket. This only has an effect
   * if the machine is idle at the moment, otherwise this is a no-op.
   */
  public connect(): void {
    this.machine.send({ type: "CONNECT" });
  }

  /**
   * If idle, will try to connect. Otherwise, it will attempt to reconnect to
   * the socket, potentially obtaining a new authValue first, if needed.
   */
  public reconnect(): void {
    this.machine.send({ type: "RECONNECT" });
  }

  /**
   * Call this method to disconnect from the current WebSocket. Is going to be
   * a no-op if there is no active connection.
   */
  public disconnect(): void {
    this.machine.send({ type: "DISCONNECT" });
  }

  /**
   * Call this to stop the machine and run necessary cleanup functions. After
   * calling destroy(), you can no longer use this instance. Call this before
   * letting the instance get garbage collected.
   */
  public destroy(): void {
    this.machine.stop();

    let cleanup: (() => void) | undefined;
    while ((cleanup = this.cleanups.pop())) {
      cleanup();
    }
  }

  /**
   * Safely send a message to the current WebSocket connection. Will emit a log
   * message if this is somehow impossible.
   */
  public send(data: Uint8Array): void {
    const socket = this.machine.context?.transport;
    if (socket === null) {
      console.warn("Cannot send: not connected yet", data);
    } else if (
      socket.readyState !== TransportReadyState.OPEN /* WebSocket.OPEN */
    ) {
      console.warn("Cannot send: connection no longer open", data);
    } else {
      socket.send(data);
    }
  }

  /**
   * NOTE: Used by the E2E app only, to simulate explicit events.
   * Not ideal to keep exposed :(
   */
  public _privateSendMachineEvent(event: Event): void {
    this.machine.send(event);
  }
}
