import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

export function parseCli(args, options) {
  const parsed = parseArgs({ args, allowPositionals: true, strict: true, tokens: true, options });
  const seen = new Set();
  for (const token of parsed.tokens) {
    if (token.kind !== 'option') continue;
    if (seen.has(token.name)) throw new Error(`Duplicate option --${token.name}`);
    seen.add(token.name);
  }
  return parsed;
}

export function booleanValue(value, name) {
  if (!['true', 'false'].includes(value)) throw new Error(`${name} must be true or false`);
  return value === 'true';
}

export function runCli(url, main) {
  if (!process.argv[1] || url !== pathToFileURL(process.argv[1]).href) return;
  main(process.argv.slice(2)).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
    console.error(JSON.stringify({
      error: error.message,
      ...(error.response ? { response: error.response } : {}),
      ...(error.completedActions ? { completedActions: error.completedActions } : {}),
      ...(error.failedAction ? { failedAction: error.failedAction } : {}),
    }));
    process.exitCode = 1;
  });
}
