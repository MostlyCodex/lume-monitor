const encoder = new TextEncoder();

export function canonicalMessage(timestamp: string, nonce: string, body: string): string {
  return `${timestamp}\n${nonce}\n${body}`;
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
}

export function parseNodeKeys(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("NODE_KEYS is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("NODE_KEYS must be a JSON object");
  }
  const result: Record<string, string> = {};
  const entries = Object.entries(parsed);
  if (entries.length > 256) throw new Error("NODE_KEYS contains too many nodes");
  for (const [node, secret] of entries) {
    if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(node) || typeof secret !== "string" || secret.length < 32 || secret.length > 256) {
      throw new Error("NODE_KEYS contains an invalid node or secret");
    }
    result[node] = secret;
  }
  return result;
}
