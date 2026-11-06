// Tiny --flag value parser shared by the scripts.

export function parseArgs(argv: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const [key, inline] = a.slice(2).split('=', 2);
    if (inline !== undefined) out.set(key, inline);
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out.set(key, argv[++i]);
    else out.set(key, 'true');
  }
  return out;
}

export function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], flag: string): T | undefined {
  if (value === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`--${flag} must be one of: ${allowed.join(', ')} (got "${value}")`);
  }
  return value as T;
}
