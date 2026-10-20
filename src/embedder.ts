import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { EmbedReply, EmbedRequest } from './embed-protocol.js';
import type { Embedder } from './semantic.js';

/** The part of a transformers.js feature-extraction pipeline that this project uses. */
type Extractor = (
  texts: string[],
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<{ dims: number[]; data: ArrayLike<number> }>;

/**
 * Embedder backed by a transformers.js model, run locally with ONNX Runtime.
 * The model is downloaded once into `cacheDir`, and loaded on the first call only.
 */
export function createTransformersEmbedder(model: string, cacheDir: string): Embedder {
  let extractor: Promise<Extractor> | undefined;
  const load = (): Promise<Extractor> => {
    extractor ??= import('@huggingface/transformers').then(async ({ env, pipeline }) => {
      env.cacheDir = cacheDir;
      const loaded = await pipeline('feature-extraction', model, { dtype: 'q8' });
      return loaded as unknown as Extractor;
    });
    return extractor;
  };

  return {
    model,
    async embed(texts, kind) {
      if (texts.length === 0) {
        return [];
      }
      const run = await load();
      // E5 models expect a prefix that tells queries from documents.
      const prefix = kind === 'query' ? 'query: ' : 'passage: ';
      const output = await run(
        texts.map((text) => prefix + text),
        { pooling: 'mean', normalize: true },
      );
      const dims = output.dims[output.dims.length - 1] ?? 0;
      const data = output.data as Float32Array;
      return texts.map((_, row) => data.slice(row * dims, (row + 1) * dims));
    },
  };
}

/** Milliseconds without requests after which the helper process exits. */
const IDLE_MS = 60_000;
/** Milliseconds a helper gets to exit once its input has ended, before it is killed. */
const EXIT_GRACE_MS = 5_000;

export interface ProcessEmbedderOptions {
  /** Milliseconds without requests before the helper process exits. */
  idleMs?: number;
  /** Script that runs the model. Defaults to embed-worker.js next to this file. */
  script?: string;
  /** Node options for the helper process, such as a smaller young generation. */
  execArgv?: string[];
}

interface Waiting {
  resolve(vectors: Float32Array[]): void;
  reject(error: Error): void;
}

type Helper = ChildProcessByStdio<Writable, Readable, null>;

/**
 * Embedder that runs the model in a helper process. The process starts on the first call and exits after
 * `idleMs` without requests. Its memory, several hundred MB with the model loaded, goes back to the system
 * when it exits, so the server stays small between searches.
 */
export function createProcessEmbedder(model: string, cacheDir: string, options: ProcessEmbedderOptions = {}): Embedder {
  const idleMs = options.idleMs ?? IDLE_MS;
  const script = options.script ?? fileURLToPath(new URL('./embed-worker.js', import.meta.url));
  const execArgv = options.execArgv ?? [];
  const waiting = new Map<number, Waiting>();
  let helper: Helper | undefined;
  let nextId = 1;
  let idleTimer: NodeJS.Timeout | undefined;

  const startHelper = (): Helper => {
    const started: Helper = spawn(process.execPath, [...execArgv, script, model, cacheDir], {
      stdio: ['pipe', 'pipe', 'inherit'],
      windowsHide: true,
    });
    const stopped = (reason: string): void => {
      for (const pending of waiting.values()) {
        pending.reject(new Error(`Embedding helper stopped: ${reason}`));
      }
      waiting.clear();
      if (helper === started) {
        helper = undefined;
      }
    };
    createInterface({ input: started.stdout }).on('line', (line) => {
      const reply = parseReply(line);
      const pending = reply ? waiting.get(reply.id) : undefined;
      if (!reply || !pending) {
        return;
      }
      waiting.delete(reply.id);
      if ('error' in reply) {
        pending.reject(new Error(reply.error));
      } else {
        pending.resolve(reply.vectors.map((vector) => new Float32Array(vector)));
      }
    });
    started.stdin.on('error', (error) => stopped(error.message));
    started.stdout.on('error', (error) => stopped(error.message));
    started.on('error', (error) => stopped(error.message));
    started.on('exit', (code) => stopped(`exit code ${code ?? 'unknown'}`));
    helper = started;
    return started;
  };

  const stopHelper = (): void => {
    clearTimeout(idleTimer);
    const stopping = helper;
    helper = undefined;
    if (!stopping) {
      return;
    }
    // The helper exits once its input ends. It is killed if it has not exited soon after.
    stopping.stdin.end();
    const killer = setTimeout(() => stopping.kill(), EXIT_GRACE_MS);
    killer.unref();
    stopping.once('exit', () => clearTimeout(killer));
  };

  const restartIdleTimer = (): void => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (waiting.size === 0) {
        stopHelper();
      }
    }, idleMs);
    idleTimer.unref();
  };

  const request = (texts: string[], kind: 'query' | 'passage'): Promise<Float32Array[]> => {
    const current = helper ?? startHelper();
    const id = nextId++;
    const message: EmbedRequest = { id, kind, texts };
    const reply = new Promise<Float32Array[]>((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      current.stdin.write(`${JSON.stringify(message)}\n`);
    });
    return reply.finally(restartIdleTimer);
  };

  return {
    model,
    embed(texts, kind) {
      return texts.length === 0 ? Promise.resolve([]) : request(texts, kind);
    },
    close: stopHelper,
  };
}

/** The reply on one line of the helper's output, or null when the line is not a reply. */
function parseReply(line: string): EmbedReply | null {
  try {
    const reply = JSON.parse(line) as EmbedReply | null;
    return reply && typeof reply.id === 'number' ? reply : null;
  } catch {
    return null;
  }
}
