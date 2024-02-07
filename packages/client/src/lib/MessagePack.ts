import { decodeUtf8, encodeUtf8 } from "./utils";

export const msgpack = {
  encode,
  decode,
};

// Encode a value to a MessagePack byte array.
//
// data: The value to encode. This can be a scalar, array or object.
// eslint-disable-next-line
function encode(data: any): Uint8Array {
  const pow32 = 0x100000000; // 2^32
  let floatBuffer: ArrayBuffer, floatView: DataView;
  let array = new Uint8Array(128);
  let length = 0;
  append(data);
  return array.subarray(0, length);

  function append(data: any) {
    switch (typeof data) {
      case "undefined":
        appendNull();
        break;
      case "boolean":
        appendBoolean(data);
        break;
      case "number":
        appendNumber(data);
        break;
      case "string":
        appendString(data);
        break;
      case "object":
        if (data === null) appendNull();
        else if (data instanceof Date) appendDate(data);
        else if (Array.isArray(data)) appendArray(data);
        else if (
          data instanceof Uint8Array ||
          data instanceof Uint8ClampedArray
        )
          appendBinArray(data);
        else if (
          data instanceof Int8Array ||
          data instanceof Int16Array ||
          data instanceof Uint16Array ||
          data instanceof Int32Array ||
          data instanceof Uint32Array ||
          data instanceof Float32Array ||
          data instanceof Float64Array
        )
          appendArray(data);
        else appendObject(data as Record<string, any>);
        break;
      default:
        throw new Error(
          "Invalid argument type: The type '" +
            typeof data +
            "' cannot be encode."
        );
    }
  }

  function appendNull() {
    appendByte(0xc0);
  }

  function appendBoolean(data: boolean) {
    appendByte(data ? 0xc3 : 0xc2);
  }

  function appendNumber(data: number) {
    if (isFinite(data) && Math.floor(data) === data) {
      // Integer
      if (data >= 0 && data <= 0x7f) {
        appendByte(data);
      } else if (data < 0 && data >= -0x20) {
        appendByte(data);
      } else if (data > 0 && data <= 0xff) {
        // uint8
        appendBytes([0xcc, data]);
      } else if (data >= -0x80 && data <= 0x7f) {
        // int8
        appendBytes([0xd0, data]);
      } else if (data > 0 && data <= 0xffff) {
        // uint16
        appendBytes([0xcd, data >>> 8, data]);
      } else if (data >= -0x8000 && data <= 0x7fff) {
        // int16
        appendBytes([0xd1, data >>> 8, data]);
      } else if (data > 0 && data <= 0xffffffff) {
        // uint32
        appendBytes([0xce, data >>> 24, data >>> 16, data >>> 8, data]);
      } else if (data >= -0x80000000 && data <= 0x7fffffff) {
        // int32
        appendBytes([0xd2, data >>> 24, data >>> 16, data >>> 8, data]);
        // eslint-disable-next-line
      } else if (data > 0 && data <= 0xffffffffffffffff) {
        // uint64
        // Split 64 bit number into two 32 bit numbers because JavaScript only regards
        // 32 bits for bitwise operations.
        const hi = data / pow32;
        const lo = data % pow32;
        appendBytes([
          0xd3,
          hi >>> 24,
          hi >>> 16,
          hi >>> 8,
          hi,
          lo >>> 24,
          lo >>> 16,
          lo >>> 8,
          lo,
        ]);
        // eslint-disable-next-line
      } else if (data >= -0x8000000000000000 && data <= 0x7fffffffffffffff) {
        // int64
        appendByte(0xd3);
        appendInt64(data);
      } else if (data < 0) {
        // below int64
        appendBytes([0xd3, 0x80, 0, 0, 0, 0, 0, 0, 0]);
      } else {
        // above uint64
        appendBytes([0xcf, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
      }
    } else {
      // Float
      if (!floatView) {
        floatBuffer = new ArrayBuffer(8);
        floatView = new DataView(floatBuffer);
      }
      floatView.setFloat64(0, data);
      appendByte(0xcb);
      appendBytes(new Uint8Array(floatBuffer));
    }
  }

  function appendString(data: string) {
    const bytes = encodeUtf8(data);
    const length = bytes.length;

    if (length <= 0x1f) appendByte(0xa0 + length);
    else if (length <= 0xff) appendBytes([0xd9, length]);
    else if (length <= 0xffff) appendBytes([0xda, length >>> 8, length]);
    else
      appendBytes([0xdb, length >>> 24, length >>> 16, length >>> 8, length]);

    appendBytes(bytes);
  }

  function appendArray(
    data:
      | Array<any>
      | Int8Array
      | Int16Array
      | Uint16Array
      | Int32Array
      | Uint32Array
      | Float32Array
      | Float64Array
  ) {
    const length = data.length;

    if (length <= 0xf) appendByte(0x90 + length);
    else if (length <= 0xffff) appendBytes([0xdc, length >>> 8, length]);
    else
      appendBytes([0xdd, length >>> 24, length >>> 16, length >>> 8, length]);

    for (let index = 0; index < length; index++) {
      append(data[index]);
    }
  }

  function appendBinArray(data: Uint8Array | Uint8ClampedArray) {
    const length = data.length;

    if (length <= 0xf) appendBytes([0xc4, length]);
    else if (length <= 0xffff) appendBytes([0xc5, length >>> 8, length]);
    else
      appendBytes([0xc6, length >>> 24, length >>> 16, length >>> 8, length]);

    appendBytes(data);
  }

  function appendObject(data: Record<string, any>) {
    const keys = Object.keys(data);

    const length = keys.length;
    if (length <= 0xf) appendByte(0x80 + length);
    else if (length <= 0xffff) appendBytes([0xde, length >>> 8, length]);
    else
      appendBytes([0xdf, length >>> 24, length >>> 16, length >>> 8, length]);

    keys.forEach((key) => {
      // eslint-disable-next-line
      const value = data[key];
      if (value === undefined) return;

      append(key);
      append(value);
    });
  }

  function appendDate(data: Date) {
    const sec = data.getTime() / 1000;
    if (data.getMilliseconds() === 0 && sec >= 0 && sec < 0x100000000) {
      // 32 bit seconds
      appendBytes([0xd6, 0xff, sec >>> 24, sec >>> 16, sec >>> 8, sec]);
    } else if (sec >= 0 && sec < 0x400000000) {
      // 30 bit nanoseconds, 34 bit seconds
      const ns = data.getMilliseconds() * 1000000;
      appendBytes([
        0xd7,
        0xff,
        ns >>> 22,
        ns >>> 14,
        ns >>> 6,
        ((ns << 2) >>> 0) | (sec / pow32),
        sec >>> 24,
        sec >>> 16,
        sec >>> 8,
        sec,
      ]);
    } else {
      // 32 bit nanoseconds, 64 bit seconds, negative values allowed
      const ns = data.getMilliseconds() * 1000000;
      appendBytes([0xc7, 12, 0xff, ns >>> 24, ns >>> 16, ns >>> 8, ns]);
      appendInt64(sec);
    }
  }

  function appendByte(byte: number) {
    if (array.length < length + 1) {
      let newLength = array.length * 2;
      while (newLength < length + 1) newLength *= 2;
      const newArray = new Uint8Array(newLength);
      newArray.set(array);
      array = newArray;
    }
    array[length] = byte;
    length++;
  }

  function appendBytes(bytes: number[] | Uint8Array | Uint8ClampedArray) {
    if (array.length < length + bytes.length) {
      let newLength = array.length * 2;
      while (newLength < length + bytes.length) newLength *= 2;
      const newArray = new Uint8Array(newLength);
      newArray.set(array);
      array = newArray;
    }
    array.set(bytes, length);
    length += bytes.length;
  }

  function appendInt64(value: number) {
    // Split 64 bit number into two 32 bit numbers because JavaScript only regards 32 bits for
    // bitwise operations.
    let hi, lo;
    if (value >= 0) {
      // Same as uint64
      hi = value / pow32;
      lo = value % pow32;
    } else {
      // Split absolute value to high and low, then NOT and ADD(1) to restore negativity
      value++;
      hi = Math.abs(value) / pow32;
      lo = Math.abs(value) % pow32;
      hi = ~hi;
      lo = ~lo;
    }
    appendBytes([
      hi >>> 24,
      hi >>> 16,
      hi >>> 8,
      hi,
      lo >>> 24,
      lo >>> 16,
      lo >>> 8,
      lo,
    ]);
  }
}

// Decode a MessagePack byte array to a value.
//
// array: The MessagePack byte array to decode. This must be an Array or Uint8Array containing bytes, not a string.
function decode(array: Uint8Array): any {
  const pow32 = 0x100000000; // 2^32
  let pos = 0;

  if (!array.length) {
    throw new Error("Invalid argument: The byte array to decode is empty.");
  }

  return read();

  function read(): any {
    const byte = array[pos++];
    if (byte >= 0x00 && byte <= 0x7f) return byte; // positive fixint
    if (byte >= 0x80 && byte <= 0x8f) return readMap(byte - 0x80); // fixmap
    if (byte >= 0x90 && byte <= 0x9f) return readArray(byte - 0x90); // fixarray
    if (byte >= 0xa0 && byte <= 0xbf) return readStr(byte - 0xa0); // fixstr
    if (byte === 0xc0) return null; // nil
    if (byte === 0xc1) throw new Error("Invalid byte code 0xc1 found."); // never used
    if (byte === 0xc2) return false; // false
    if (byte === 0xc3) return true; // true
    if (byte === 0xc4) return readBin(-1, 1); // bin 8
    if (byte === 0xc5) return readBin(-1, 2); // bin 16
    if (byte === 0xc6) return readBin(-1, 4); // bin 32
    if (byte === 0xc7) return readExt(-1, 1); // ext 8
    if (byte === 0xc8) return readExt(-1, 2); // ext 16
    if (byte === 0xc9) return readExt(-1, 4); // ext 32
    if (byte === 0xca) return readFloat(4); // float 32
    if (byte === 0xcb) return readFloat(8); // float 64
    if (byte === 0xcc) return readUInt(1); // uint 8
    if (byte === 0xcd) return readUInt(2); // uint 16
    if (byte === 0xce) return readUInt(4); // uint 32
    if (byte === 0xcf) return readUInt(8); // uint 64
    if (byte === 0xd0) return readInt(1); // int 8
    if (byte === 0xd1) return readInt(2); // int 16
    if (byte === 0xd2) return readInt(4); // int 32
    if (byte === 0xd3) return readInt(8); // int 64
    if (byte === 0xd4) return readExt(1); // fixext 1
    if (byte === 0xd5) return readExt(2); // fixext 2
    if (byte === 0xd6) return readExt(4); // fixext 4
    if (byte === 0xd7) return readExt(8); // fixext 8
    if (byte === 0xd8) return readExt(16); // fixext 16
    if (byte === 0xd9) return readStr(-1, 1); // str 8
    if (byte === 0xda) return readStr(-1, 2); // str 16
    if (byte === 0xdb) return readStr(-1, 4); // str 32
    if (byte === 0xdc) return readArray(-1, 2); // array 16
    if (byte === 0xdd) return readArray(-1, 4); // array 32
    if (byte === 0xde) return readMap(-1, 2); // map 16
    if (byte === 0xdf) return readMap(-1, 4); // map 32
    if (byte >= 0xe0 && byte <= 0xff) return byte - 256; // negative fixint

    throw new Error(
      "Invalid byte value '" +
        byte +
        "' at index " +
        (pos - 1) +
        " in the MessagePack binary data (length " +
        array.length +
        "): Expecting a range of 0 to 255. This is not a byte array."
    );
  }

  function readInt(size: number) {
    let value = 0;
    let first = true;
    while (size-- > 0) {
      if (first) {
        const byte = array[pos++];
        value += byte & 0x7f;
        if (byte & 0x80) {
          value -= 0x80; // Treat most-significant bit as -2^i instead of 2^i
        }
        first = false;
      } else {
        value *= 256;
        value += array[pos++];
      }
    }
    return value;
  }

  function readUInt(size: number) {
    let value = 0;
    while (size-- > 0) {
      value *= 256;
      value += array[pos++];
    }
    return value;
  }

  function readFloat(size: 4 | 8) {
    const view = new DataView(array.buffer, pos + array.byteOffset, size);
    pos += size;
    if (size === 4) return view.getFloat32(0, false);
    return view.getFloat64(0, false);
  }

  function readBin(size: number, lengthSize: number = 0) {
    if (size < 0) size = readUInt(lengthSize);
    const data = array.subarray(pos, pos + size);
    pos += size;
    return data;
  }

  function readMap(size: number, lengthSize: number = 0) {
    if (size < 0) size = readUInt(lengthSize);
    const data: Record<string, any> = {};
    while (size-- > 0) {
      const key = read() as string;
      // eslint-disable-next-line
      data[key] = read();
    }
    return data;
  }

  function readArray(size: number, lengthSize: number = 0): any[] {
    if (size < 0) size = readUInt(lengthSize);
    const data: any[] = [];
    while (size-- > 0) {
      data.push(read());
    }
    return data;
  }

  function readStr(size: number, lengthSize: number = 0) {
    if (size < 0) size = readUInt(lengthSize);
    const start = pos;
    pos += size;
    return decodeUtf8(array.slice(start, pos));
  }

  function readExt(size: number, lengthSize: number = 0) {
    if (size < 0) size = readUInt(lengthSize);
    const type = readUInt(1);
    const data = readBin(size);
    switch (type) {
      case 255:
        return readExtDate(data);
    }
    return { type, data };
  }

  function readExtDate(data: Uint8Array) {
    if (data.length === 4) {
      const sec =
        ((data[0] << 24) >>> 0) +
        ((data[1] << 16) >>> 0) +
        ((data[2] << 8) >>> 0) +
        data[3];
      return new Date(sec * 1000);
    }
    if (data.length === 8) {
      const ns =
        ((data[0] << 22) >>> 0) +
        ((data[1] << 14) >>> 0) +
        ((data[2] << 6) >>> 0) +
        (data[3] >>> 2);
      const sec =
        (data[3] & 0x3) * pow32 +
        ((data[4] << 24) >>> 0) +
        ((data[5] << 16) >>> 0) +
        ((data[6] << 8) >>> 0) +
        data[7];
      return new Date(sec * 1000 + ns / 1000000);
    }
    if (data.length === 12) {
      const ns =
        ((data[0] << 24) >>> 0) +
        ((data[1] << 16) >>> 0) +
        ((data[2] << 8) >>> 0) +
        data[3];
      pos -= 8;
      const sec = readInt(8);
      return new Date(sec * 1000 + ns / 1000000);
    }
    throw new Error("Invalid data length for a date value.");
  }
}
