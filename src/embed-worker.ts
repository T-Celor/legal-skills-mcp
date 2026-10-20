// Helper process that runs the embedding model for the server. The server starts it on the first semantic search and
// ends it after a while without requests, so the model's memory goes back to the system.
// Usage: node embed-worker.js <model> <cacheDir>
import { serveEmbedder } from './embed-protocol.js';
import { createTransformersEmbedder } from './embedder.js';

const [model, cacheDir] = process.argv.slice(2);
if (!model || !cacheDir) {
  console.error('Usage: node embed-worker.js <model> <cacheDir>');
  process.exit(2);
}

// stdout carries the replies only, so anything a library logs goes to stderr.
console.log = console.error;
serveEmbedder(createTransformersEmbedder(model, cacheDir), process.stdin, process.stdout);
// The server closes the pipe to stop the helper, so the helper ends when its input does.
process.stdin.on('end', () => process.exit(0));
