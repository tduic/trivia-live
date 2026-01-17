export function randomCode(len = 6) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  crypto.getRandomValues(new Uint32Array(len)).forEach((n) => {
    out += alphabet[n % alphabet.length];
  });
  return out;
}

export function randomSecret(len = 32) {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";
  let out = "";
  crypto.getRandomValues(new Uint32Array(len)).forEach((n) => {
    out += alphabet[n % alphabet.length];
  });
  return out;
}

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function safeTrim(s: string, max = 2000) {
  const t = (s ?? "").trim();
  return t.length > max ? t.slice(0, max) : t;
}
