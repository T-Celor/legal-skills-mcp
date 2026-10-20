import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import type { Embedder } from './semantic.js';

/** One request to the embedding helper, sent as one line of JSON on its input. */
export interface EmbedRequest {
  id: number;
  kind: 'query' | 'passage';
  texts: string[];
}

/** The helper's reply to one request, sent as one line of JSON on its output. */
export type EmbedReply = { id: number; vectors: number[][] } | { id: number; error: string };

/**
 * Answers embedding requests read from `input`, one at a time, and writes each reply to `output`.
 * Returns at once: requests are handled as they arrive, until `input` closes.
 */
export function serveEmbedder(embedder: Embedder, input: Readable, output: Writable): void {
  let queue: Promise<void> = Promise.resolve();
  createInterface({ input }).on('line', (line) => {
    queue = queue
      .then(() => answer(embedder, line, output))
      .catch((error: unknown) => console.error('[legal-skills] embedding helper:', error));
  });
}

async function answer(embedder: Embedder, line: string, output: Writable): Promise<void> {
  let id = -1;
  let reply: EmbedReply;
  try {
    const request = JSON.parse(line) as EmbedRequest;
    id = request.id;
    const vectors = await embedder.embed(request.texts, request.kind);
    reply = { id, vectors: vectors.map((vector) => Array.from(vector)) };
  } catch (error) {
    reply = { id, error: error instanceof Error ? error.message : String(error) };
  }
  output.write(`${JSON.stringify(reply)}\n`);
}
