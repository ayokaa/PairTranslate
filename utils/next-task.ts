/**
 * Run `callback` in a new task, without a timer. Returns a function that
 * cancels it.
 *
 * Browsers check the timers of a hidden page only once per second, so work
 * that advances through `setTimeout(…, 0)` slows down as soon as the user
 * switches to another tab. A posted message is an ordinary task and is not
 * held back.
 */
export function nextTask(callback: () => void): () => void {
	const { port1, port2 } = new MessageChannel();
	// Closing the port also lets a script that only waits on it exit.
	port1.onmessage = () => {
		port1.close();
		callback();
	};
	port2.postMessage(undefined);
	return () => port1.close();
}
