// Stands in for embed-worker.js in tests: it speaks the same protocol with the hashing embedder, so no model is needed.
import { serveEmbedder } from '../embed-protocol.js';
import { hashingEmbedder } from './hashing-embedder.js';

serveEmbedder(hashingEmbedder(), process.stdin, process.stdout);
process.stdin.on('end', () => process.exit(0));
