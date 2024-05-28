import { AsyncResource } from 'async_hooks';
import { fork } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';
import { Worker } from 'worker_threads';

const kTaskInfo = Symbol('kTaskInfo');
const kWorkerFreedEvent = Symbol('kWorkerFreedEvent');

/**
 * Work to be done for a task
 * With a callback to call when the work is complete
 */
class WorkerPoolTaskInfo extends AsyncResource {
	constructor(private callback) {
		super('WorkerPoolTaskInfo');
		this.callback = callback;
	}

	done(err, result) {
		this.runInAsyncScope(this.callback, null, err, result);
		this.emitDestroy();  // `TaskInfo`s are used only once.
	}
}

/**
 * Pool of worker threads where one thread can be use per task
 */
export class WorkerPool extends EventEmitter {
	workers: Worker[];
	freeWorkers: Worker[];
	messages: Record<string, (worker: Worker, m: any) => void>;
	private onExit: (...args: any[]) => void;

	constructor(
		private id: string,
		private task,
		private numThreads,
		private workerData, messages?: Record<string, (worker: Worker, m: any) => void>
	) {
		super();
		this.task = task;
		this.numThreads = numThreads;
		this.workers = [];
		this.freeWorkers = [];
		this.messages = {
			...messages
		};
		for (let i = 0; i < numThreads; i++) {
			this.addNewWorker({ id: i + 1, ...workerData });
		}
		this.setMaxListeners(0);//(numThreads * 10);

		this.onExit = () => {
			this.close();
		};
		process.on('SIGINT', this.onExit);
		process.on('exit', this.onExit);
	}

	addNewWorker(workerData: any) {
		const worker = typeof this.task === "function" ? this.task({ workerData }) :
			new Worker(
				this.task,
				{ workerData }
			);
		worker.on('message', (result) => {
			if (result.event && this.messages[result.event]) {
				this.messages[result.event](worker, result);
				return;
			}

			// In case of success: Call the callback that was passed to `runTask`,
			// remove the `TaskInfo` associated with the Worker, and mark it as free
			// again.

			if (worker[kTaskInfo] != null) {
				worker[kTaskInfo].done(null, result);
			} else {
				console.warn(this.id, "Worker Pool missing task info in onMessage.", typeof result === "object" && result != null ? JSON.stringify(result) : result);
			}

			worker[kTaskInfo] = null;
			this.freeWorkers.push(worker);
			this.emit(kWorkerFreedEvent);
		});
		worker.on('error', (err) => {
			// In case of an uncaught exception: Call the callback that was passed to
			// `runTask` with the error.
			if (worker[kTaskInfo]) {
				worker[kTaskInfo].done(err, null);
			} else {
				this.emit('error', err);
			}
			worker[kTaskInfo] = null;
			// Remove the worker from the list and start a new Worker to replace the
			// current one.
			this.workers.splice(this.workers.indexOf(worker), 1);
			this.addNewWorker(workerData);
		});
		worker.on("close", () => {
			if (worker[kTaskInfo]) {
				worker[kTaskInfo].done(new Error("Premature Close"), null);
			}
			worker[kTaskInfo] = null;
		});
		worker.on("exit", () => {
			if (worker[kTaskInfo]) {
				worker[kTaskInfo].done(new Error("Premature Close"), null);
			}
			worker[kTaskInfo] = null;
		});
		this.workers.push(worker);
		this.freeWorkers.push(worker);
		this.emit(kWorkerFreedEvent);
	}

	listenCount = 0;
	runTask(task, callback) {
		if (this.freeWorkers.length === 0) {
			// No free threads, wait until a worker thread becomes free.
			//console.log("Listening Start", ++this.listenCount);
			this.once(kWorkerFreedEvent, () => {
				//console.log("Listening Done", --this.listenCount);
				this.runTask(task, callback);
			});
			return;
		}

		const worker = this.freeWorkers.pop();
		worker[kTaskInfo] = new WorkerPoolTaskInfo(callback);
		worker.postMessage(task);
	}

	runTaskAsync<T = void>(task) {
		return new Promise<T>((resolve, reject) => {
			this.runTask(task, (err, data) => {
				err ? reject(err) : resolve(data);
			});
		});
	}

	async close() {

		// Remove event listeners to prevent memory leaks
		process.removeListener('SIGINT', this.onExit);
		process.removeListener('exit', this.onExit);

		if (this.workers.length > 0) {
			//console.log(this.id, "Worker Pool Closing", this.workers.length);
			await Promise.allSettled(this.workers.map(w => {
				w[kTaskInfo] = null;
				w.terminate();
			}));
			this.workers = [];
			//console.log(this.id, "Worker Pool Closed");
		}
	}
}

