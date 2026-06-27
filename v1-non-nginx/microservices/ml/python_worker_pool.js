'use strict';

/**
 * Persistent Python Worker Pool
 *
 * Manages one or more long-lived Python inference processes.
 * The model is loaded ONCE per worker at startup; subsequent predictions
 * skip all Python interpreter and model-loading overhead (~400-500ms saved
 * per request).
 *
 * Protocol (newline-delimited JSON over stdin/stdout):
 *   startup  → worker writes {"ready":true} to stdout
 *   request  → Node writes JSON line to worker stdin
 *   response → worker writes JSON line to worker stdout
 *
 * Usage:
 *   const pool = new PythonWorkerPool({ size: 1 });
 *   await pool.initialize({ pythonCmd, workerScript, modelPath, modelType });
 *   const result = await pool.predict(inputData);
 *   pool.shutdown();
 */

const { spawn }    = require('child_process');
const readline     = require('readline');
const EventEmitter = require('events');

// ─────────────────────────────────────────────────────────────────────────────
// Single worker — wraps one long-lived python_worker.py process
// ─────────────────────────────────────────────────────────────────────────────

class PythonWorker extends EventEmitter {
  constructor({ pythonCmd, workerScript, modelPath, modelType, id }) {
    super();
    this.pythonCmd    = pythonCmd;
    this.workerScript = workerScript;
    this.modelPath    = modelPath;
    this.modelType    = modelType;
    this.id           = id;

    this.process      = null;
    this.ready        = false;
    this.busy         = false;

    this._pendingResolve = null;
    this._pendingReject  = null;
    this._startResolve   = null;
    this._startReject    = null;
  }

  /** Start the worker and wait until it signals {"ready":true}. */
  start() {
    return new Promise((resolve, reject) => {
      this._startResolve = resolve;
      this._startReject  = reject;

      this.process = spawn(this.pythonCmd, [
        this.workerScript,
        '--model',      this.modelPath,
        '--model-type', this.modelType,
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Read stdout line-by-line
      const rl = readline.createInterface({ input: this.process.stdout, crlfDelay: Infinity });

      rl.on('line', (line) => {
        if (!line.trim()) return;

        let msg;
        try {
          msg = JSON.parse(line);
        } catch (err) {
          console.error(`[WORKER-${this.id}] Unparseable output: ${line}`);
          return;
        }

        // First message must be the ready signal
        if (!this.ready) {
          if (msg.ready) {
            this.ready = true;
            console.log(`[WORKER-${this.id}] Ready (model loaded)`);
            if (this._startResolve) { this._startResolve(this); this._startResolve = null; }
          } else {
            if (this._startReject) {
              this._startReject(new Error(`[WORKER-${this.id}] Unexpected startup message: ${line}`));
              this._startReject = null;
            }
          }
          return;
        }

        // Subsequent messages are prediction responses
        if (this._pendingResolve) {
          const cb = this._pendingResolve;
          this._pendingResolve = null;
          this._pendingReject  = null;
          this.busy = false;
          this.emit('free');
          cb(msg);
        }
      });

      // Pipe stderr to Node.js stderr with worker prefix
      this.process.stderr.on('data', (data) => {
        process.stderr.write(`[WORKER-${this.id}] ${data}`);
      });

      this.process.on('close', (code) => {
        this.ready = false;
        this.busy  = false;
        console.error(`[WORKER-${this.id}] Exited with code ${code}`);

        // Fail any in-flight request
        if (this._pendingReject) {
          this._pendingReject(new Error(`Python worker ${this.id} exited unexpectedly (code ${code})`));
          this._pendingResolve = null;
          this._pendingReject  = null;
        }

        // Fail startup if it was still waiting
        if (this._startReject) {
          this._startReject(new Error(`Python worker ${this.id} exited before ready (code ${code})`));
          this._startReject  = null;
          this._startResolve = null;
        }

        this.emit('exit', code);
      });

      this.process.on('error', (err) => {
        console.error(`[WORKER-${this.id}] Spawn error: ${err.message}`);
        if (this._startReject) { this._startReject(err); this._startReject = null; }
        if (this._pendingReject) { this._pendingReject(err); this._pendingReject = null; }
      });
    });
  }

  /**
   * Send a prediction request and return a Promise for the result.
   * Caller is responsible for checking `busy` before calling.
   */
  predict(inputData) {
    return new Promise((resolve, reject) => {
      this.busy = true;
      this._pendingResolve = resolve;
      this._pendingReject  = reject;

      try {
        this.process.stdin.write(JSON.stringify(inputData) + '\n');
      } catch (err) {
        this.busy = false;
        this._pendingResolve = null;
        this._pendingReject  = null;
        reject(new Error(`[WORKER-${this.id}] Failed to write stdin: ${err.message}`));
      }
    });
  }

  shutdown() {
    if (this.process) {
      try { this.process.stdin.end(); } catch (_) {}
    }
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// Worker pool — distributes requests across N workers
// ─────────────────────────────────────────────────────────────────────────────

class PythonWorkerPool {
  /**
   * @param {object} opts
   * @param {number} [opts.size=1]  Number of persistent workers to spawn.
   */
  constructor({ size = 1 } = {}) {
    this._size    = size;
    this._workers = [];
    this._queue   = [];          // { inputData, resolve, reject }
    this._ready   = false;
  }

  /**
   * Spawn all workers and wait until every one signals ready.
   *
   * @param {object} opts
   * @param {string} opts.pythonCmd     Python executable (e.g. 'python3' or venv path)
   * @param {string} opts.workerScript  Absolute path to python_worker.py
   * @param {string} opts.modelPath     Absolute path to the model file
   * @param {string} opts.modelType     'joblib' or 'pkl'
   */
  async initialize({ pythonCmd, workerScript, modelPath, modelType }) {
    console.log(`[WORKER-POOL] Initializing ${this._size} worker(s) …`);
    console.log(`[WORKER-POOL] model=${modelPath}  type=${modelType}`);

    const startPromises = [];

    for (let i = 0; i < this._size; i++) {
      const worker = new PythonWorker({ pythonCmd, workerScript, modelPath, modelType, id: i });

      worker.on('free', () => this._dispatch());

      worker.on('exit', (code) => {
        // Restart crashed workers automatically
        if (code !== 0) {
          console.error(`[WORKER-POOL] Worker ${i} crashed (code ${code}), restarting in 1s …`);
          setTimeout(() => {
            worker.start()
              .then(() => this._dispatch())
              .catch(err => console.error(`[WORKER-POOL] Restart failed: ${err.message}`));
          }, 1000);
        }
      });

      this._workers.push(worker);
      startPromises.push(worker.start());
    }

    await Promise.all(startPromises);
    this._ready = true;
    console.log(`[WORKER-POOL] All ${this._size} worker(s) ready`);
  }

  /**
   * Submit a prediction request.
   * Returns a Promise that resolves with the result JSON from Python.
   */
  predict(inputData) {
    if (!this._ready) {
      return Promise.reject(new Error('PythonWorkerPool is not initialized yet'));
    }

    return new Promise((resolve, reject) => {
      // Try to dispatch immediately to a free worker
      const free = this._workers.find(w => w.ready && !w.busy);
      if (free) {
        free.predict(inputData).then(resolve).catch(reject);
      } else {
        // All workers busy — queue the request
        this._queue.push({ inputData, resolve, reject });
      }
    });
  }

  /** Called when a worker becomes free. Drains the queue. */
  _dispatch() {
    if (this._queue.length === 0) return;
    const free = this._workers.find(w => w.ready && !w.busy);
    if (!free) return;

    const { inputData, resolve, reject } = this._queue.shift();
    free.predict(inputData).then(resolve).catch(reject);
  }

  shutdown() {
    this._workers.forEach(w => w.shutdown());
  }

  get queueDepth() { return this._queue.length; }
  get busyCount()  { return this._workers.filter(w => w.busy).length; }
  get stats() {
    return {
      workers:    this._size,
      busy:       this.busyCount,
      queued:     this.queueDepth,
      ready:      this._ready,
    };
  }
}

module.exports = { PythonWorkerPool };
