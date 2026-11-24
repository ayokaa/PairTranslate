import { onCleanup } from "solid-js";

export function createNodeObserver() {
	let callbacks = new WeakMap<
		Element,
		[(intersectOrRemove: boolean) => void]
	>();
	const intersectionObserver = new IntersectionObserver((entries) => {
		for (const entry of entries) {
			if (entry.isIntersecting) {
				const element = entry.target;
				triggerListener(element, true);
			}
		}
	});
	const removals = new WeakMap<Node, (() => void)[]>();
	let watchingRemovals = false;
	const notifyRemoval = (node: Node) => {
		const listeners = removals.get(node);
		if (!listeners) return;
		removals.delete(node);
		for (const listener of listeners) listener();
	};
	const mutationObserver = new MutationObserver((mutations) => {
		for (const mutation of mutations) {
			for (const removedNode of mutation.removedNodes) {
				if (watchingRemovals && !removedNode.isConnected) {
					notifyRemoval(removedNode);
					const walker = document.createTreeWalker(
						removedNode,
						NodeFilter.SHOW_ALL,
					);
					for (let child = walker.nextNode(); child; child = walker.nextNode())
						notifyRemoval(child);
				}
				if (removedNode.nodeType === Node.ELEMENT_NODE) {
					if (removedNode instanceof HTMLElement) {
						triggerListener(removedNode, false);
					}
				}
			}
		}
	});

	const triggerListener = (element: Element, intersectOrRemove: boolean) => {
		const cbs = callbacks.get(element);
		if (cbs) {
			for (const cb of cbs) {
				cb(intersectOrRemove);
			}
			if (!intersectOrRemove) {
				intersectionObserver.unobserve(element);
				callbacks.delete(element);
			}
		}
	};

	mutationObserver.observe(document.body, {
		childList: true,
		subtree: true,
	});

	const listenIntersectionOrRemove = (
		node: Node,
		callback: (intersectOrRemove: boolean) => void,
	) => {
		const element = node instanceof Element ? node : node.parentElement;
		if (!element) {
			callback(false);
			return;
		}

		const cur = callbacks.get(element);
		if (cur) cur.push(callback);
		else callbacks.set(element, [callback]);
		intersectionObserver.observe(element);
	};
	const listenRemove = (node: Node, callback: () => void) => {
		watchingRemovals = true;
		const listeners = removals.get(node);
		if (listeners) listeners.push(callback);
		else removals.set(node, [callback]);
	};

	onCleanup(() => {
		intersectionObserver.disconnect();
		mutationObserver.disconnect();
		callbacks = new WeakMap();
	});

	return [listenIntersectionOrRemove, listenRemove] as const;
}
