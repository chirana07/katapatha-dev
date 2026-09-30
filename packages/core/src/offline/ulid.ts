/**
 * ULIDs.
 *
 * Every record a driver creates carries an identifier generated where the
 * record is made, and that identifier IS the database primary key. Replaying a
 * queue of them is therefore idempotent by construction: a retry writes the
 * same row rather than a duplicate.
 *
 * ULIDs sort lexicographically by creation time, so a batch replays in the
 * order the driver actually did the work — even when the device clock is
 * wrong, because ordering within one device only needs the clock to be
 * monotonic, not correct.
 *
 * About thirty lines rather than a dependency, and it runs unchanged in the
 * browser and on the server.
 */

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32
const TIME_LEN = 10;
const RANDOM_LEN = 16;

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

function encodeTime(now: number): string {
  let out = "";
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    out = ENCODING[now % 32] + out;
    now = Math.floor(now / 32);
  }
  return out;
}

function encodeRandom(): string {
  const bytes = randomBytes(RANDOM_LEN);
  let out = "";
  for (let i = 0; i < RANDOM_LEN; i++) out += ENCODING[bytes[i] % 32];
  return out;
}

let lastTime = 0;
let lastRandom = "";

/**
 * Monotonic within a millisecond: two calls in the same tick still sort in
 * call order, so a rapid sequence of taps cannot be replayed out of order.
 */
export function ulid(now = Date.now()): string {
  if (now === lastTime && lastRandom) {
    // Increment the random part rather than re-rolling it.
    const chars = lastRandom.split("");
    let i = chars.length - 1;
    while (i >= 0) {
      const next = ENCODING.indexOf(chars[i]) + 1;
      if (next < 32) {
        chars[i] = ENCODING[next];
        break;
      }
      chars[i] = ENCODING[0];
      i--;
    }
    lastRandom = chars.join("");
  } else {
    lastTime = now;
    lastRandom = encodeRandom();
  }
  return encodeTime(now) + lastRandom;
}
