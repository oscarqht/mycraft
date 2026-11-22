// Minecraft Bedrock Edition (1.18.30+ / 1.19-1.21+) compatible seed parser.
// Valid signed 64-bit integers are used directly as int64 seeds.
// Non-numeric strings are hashed with Java's 32-bit String.hashCode() and sign-extended to int64.

const INT64_MIN = -9223372036854775808n;
const INT64_MAX = 9223372036854775807n;

export interface ParsedMinecraftSeed {
  raw: string;
  seedBigInt: bigint;
  isNumeric: boolean;
  displayInt64: string;
}

export function javaStringHashCode(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h;
}

export function parseMinecraftSeed(seedInput: string): ParsedMinecraftSeed {
  const trimmed = (seedInput ?? '').trim();
  if (trimmed.length === 0) {
    return {
      raw: seedInput,
      seedBigInt: 0n,
      isNumeric: true,
      displayInt64: '0',
    };
  }

  if (/^-?\d+$/.test(trimmed)) {
    try {
      const parsed = BigInt(trimmed);
      if (parsed >= INT64_MIN && parsed <= INT64_MAX) {
        return {
          raw: seedInput,
          seedBigInt: parsed,
          isNumeric: true,
          displayInt64: parsed.toString(),
        };
      }
    } catch {
      // Fall through to String.hashCode()
    }
  }

  const hash32 = javaStringHashCode(trimmed);
  const seedBigInt = BigInt(hash32);
  return {
    raw: seedInput,
    seedBigInt,
    isNumeric: false,
    displayInt64: seedBigInt.toString(),
  };
}
