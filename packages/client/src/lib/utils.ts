/**
 * Returns a pair of a Promise, and a flagger function that can be passed
 * around to resolve the promise "from anywhere".
 *
 * The Promise will remain unresolved, until the flagger function is called.
 * Once the flagger function is called with a value, the Promise will resolve
 * to that value.
 *
 * Calling the flagger function beyond the first time is a no-op.
 */
export function controlledPromise<T>(): [
  promise: Promise<T>,
  flagger: (value: T) => void,
] {
  let flagger: ((value: T) => void) | undefined;
  const promise = new Promise<T>((res) => {
    flagger = res;
  });
  if (!flagger) {
    throw new Error("Should never happen");
  }
  return [promise, flagger];
}

/**
 * Represents an indefinitely deep arbitrary JSON data structure. There are
 * four types that make up the Json family:
 *
 * - Json         any legal JSON value
 * - JsonScalar   any legal JSON leaf value (no lists or objects)
 * - JsonArray    a JSON value whose outer type is an array
 * - JsonObject   a JSON value whose outer type is an object
 *
 */
export type Json = JsonScalar | JsonArray | JsonObject;
export type JsonScalar = string | number | boolean | null;
export type JsonArray = Json[];
export type JsonObject = { [key: string]: Json | undefined };

export function isJsonScalar(data: Json): data is JsonScalar {
  return (
    data === null ||
    typeof data === "string" ||
    typeof data === "number" ||
    typeof data === "boolean"
  );
}

export function isJsonArray(data: Json): data is JsonArray {
  return Array.isArray(data);
}

export function isJsonObject(data: Json): data is JsonObject {
  return !isJsonScalar(data) && !isJsonArray(data);
}

/**
 * Throw an error, but as an expression instead of a statement.
 */
export function raise(msg: string): never {
  throw new Error(msg);
}

export function isPlainObject(
  blob: unknown
): blob is { [key: string]: unknown } {
  // Implementation borrowed from pojo decoder, see
  // https://github.com/nvie/decoders/blob/78849f843193647eb6b5307240387bdcff7161fb/src/lib/objects.js#L10-L41
  return (
    blob !== null &&
    typeof blob === "object" &&
    Object.prototype.toString.call(blob) === "[object Object]"
  );
}

/**
 * Drop-in replacement for Object.entries() that retains better types.
 */
export function entries<
  O extends { [key: string]: unknown },
  K extends keyof O,
>(obj: O): [K, O[K]][] {
  return Object.entries(obj) as [K, O[K]][];
}

/**
 * Drop-in replacement for Object.keys() that retains better types.
 */
export function keys<O extends { [key: string]: unknown }, K extends keyof O>(
  obj: O
): K[] {
  return Object.keys(obj) as K[];
}

/**
 * Drop-in replacement for Object.values() that retains better types.
 */
export function values<O extends Record<string, unknown>>(
  obj: O
): O[keyof O][] {
  return Object.values(obj) as O[keyof O][];
}

/**
 * Creates a new object by mapping a function over all values. Keys remain the
 * same. Think Array.prototype.map(), but for values in an object.
 */
export function mapValues<V, O extends Record<string, unknown>>(
  obj: O,
  mapFn: (value: O[keyof O], key: keyof O) => V
): { [K in keyof O]: V } {
  const result = {} as { [K in keyof O]: V };
  for (const pair of Object.entries(obj)) {
    const key: keyof O = pair[0];
    if (key === "__proto__") {
      // Avoid setting dangerous __proto__ keys
      continue;
    }
    const value = pair[1] as O[keyof O];
    result[key] = mapFn(value, key);
  }
  return result;
}

/**
 * Alternative to JSON.parse() that will not throw in production. If the passed
 * string cannot be parsed, this will return `undefined`.
 */
export function tryParseJson(rawMessage: string): Json | undefined {
  try {
    // eslint-disable-next-line no-restricted-syntax
    return JSON.parse(rawMessage) as Json;
  } catch (e) {
    return undefined;
  }
}

/**
 * Deep-clones a JSON-serializable value.
 *
 * NOTE: We should be able to replace `deepClone` by `structuredClone` once
 * we've upgraded to Node 18.
 */
export function deepClone<T extends Json>(value: T): T {
  // NOTE: In this case, the combination of JSON.parse() and JSON.stringify
  // won't lead to type unsafety, so this use case is okay.
  // eslint-disable-next-line no-restricted-syntax
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Mutates the array in-place by removing the first occurrence of `item` from
 * the array.
 */
export function remove<T>(array: T[], item: T): void {
  for (let i = 0; i < array.length; i++) {
    if (array[i] === item) {
      array.splice(i, 1);
      break;
    }
  }
}

/**
 * Removes null and undefined values from the array, and reflects this in the
 * output type.
 */
export function compact<T>(items: readonly T[]): NonNullable<T>[] {
  return items.filter(
    (item: T): item is NonNullable<T> => item !== null && item !== undefined
  );
}

/**
 * Returns a new object instance where all explictly-undefined values are
 * removed.
 */
export function compactObject<O extends Record<string, unknown>>(obj: O): O {
  const newObj = { ...obj };
  Object.keys(obj).forEach((k) => {
    const key = k as keyof O;
    if (newObj[key] === undefined) {
      delete newObj[key];
    }
  });
  return newObj;
}

/**
 * Returns whatever the given promise returns, but will be rejected with
 * a "Timed out" error if the given promise does not return or reject within
 * the given timeout period (in milliseconds).
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  millis: number,
  errmsg: string
): Promise<T> {
  let timerID: ReturnType<typeof setTimeout> | undefined;
  const timer$ = new Promise<never>((_, reject) => {
    timerID = setTimeout(() => {
      reject(new Error(errmsg));
    }, millis);
  });
  return (
    Promise
      // Race the given promise against the timer. Whichever one finishes
      // first wins the race.
      .race([promise, timer$])

      // Either way, clear the timeout, no matter who won
      .finally(() => clearTimeout(timerID))
  );
}

/**
 * Decode base64 string.
 */
export function b64decode(b64value: string): string {
  try {
    const formattedValue = b64value.replace(/-/g, "+").replace(/_/g, "/");
    const decodedValue = decodeURIComponent(
      atob(formattedValue)
        .split("")
        .map(function (c) {
          return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
        })
        .join("")
    );

    return decodedValue;
  } catch (err) {
    return atob(b64value);
  }
}

/**
 * Decode utf8 string.
 */
const decoder =
  typeof TextDecoder !== "undefined" ? new TextDecoder() : undefined;
export function decodeUtf8(bytes: Uint8Array): string {
  if (decoder !== undefined) {
    return decoder.decode(bytes);
  }

  let i;
  const s = [];
  for (i = 0; i < bytes.length; i++) s.push(String.fromCharCode(bytes[i]));
  return decodeURIComponent(escape(s.join("")));
}

/**
 * Encode utf8 string.
 */
const encoder =
  typeof TextEncoder !== "undefined" ? new TextEncoder() : undefined;
export function encodeUtf8(s: string): Uint8Array {
  if (encoder !== undefined) {
    return encoder.encode(s);
  }

  let i;
  const d = unescape(encodeURIComponent(s)),
    b = new Uint8Array(d.length);
  for (i = 0; i < d.length; i++) b[i] = d.charCodeAt(i);
  return b;
}
