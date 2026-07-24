const enabled =
  process.env.NO_COLOR === undefined && process.stdout.isTTY === true;

const wrap = (code: number) => (s: string) =>
  enabled ? `\x1b[${code}m${s}\x1b[0m` : s;

export const red = wrap(31);
export const green = wrap(32);
export const yellow = wrap(33);
export const bold = wrap(1);
export const dim = wrap(2);
