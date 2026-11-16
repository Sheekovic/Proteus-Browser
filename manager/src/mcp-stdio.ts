// For AI assistants that start a program and talk to it over standard input and
// output: forwards each Model Context Protocol message to the running manager's
// /mcp endpoint and prints the reply. The manager must be running.
//
// usage: node src/mcp-stdio.ts [--port 5310]
//
// Example entry for an assistant's MCP configuration:
//   { "command": "node", "args": ["<path>/manager/src/mcp-stdio.ts"] }

import { createInterface } from 'node:readline';

const argv = process.argv.slice(2);
const at = argv.indexOf('--port');
const port = Number(at >= 0 ? argv[at + 1] : process.env.PROTEUS_PORT ?? 5310);
const endpoint = `http://127.0.0.1:${port}/mcp`;

async function forward(line: string): Promise<void> {
  let id: unknown = null;
  try {
    const message = JSON.parse(line) as { id?: unknown };
    id = message.id ?? null;
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: line });
    // Notifications are accepted without a reply.
    if (response.status === 202) return;
    process.stdout.write((await response.text()).replace(/\n/g, ' ') + '\n');
  } catch (error) {
    if (id === null) return;
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0', id,
      error: { code: -32000, message: `The Proteus manager does not answer at ${endpoint}. Start it first. (${(error as Error).message})` },
    }) + '\n');
  }
}

// One message per line, answered in the order they arrive.
let queue = Promise.resolve();
createInterface({ input: process.stdin }).on('line', (line) => {
  if (line.trim() !== '') queue = queue.then(() => forward(line));
});
