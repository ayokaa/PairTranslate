import type { Key } from "./types";

/**
 * Point-in-time snapshot of a translation cache, used by the statistics and
 * maintenance UI. `bytes` is an approximation derived from the serialized
 * values, not the browser's on-disk allocation.
 */
export interface LRUStats {
	/** Number of entries currently held in the data store. */
	entries: number;
	/** Approximate UTF-8 size of the stored keys and values. */
	bytes: number;
	/** Configured maximum number of entries before eviction kicks in. */
	maxSize: number;
	/** `lastUsed` of the least recently used entry, or 0 when empty. */
	oldestUsedAt: number;
}

const byteEncoder = new TextEncoder();

const measureValue = (value: unknown): number => {
	try {
		return byteEncoder.encode(JSON.stringify(value) ?? "").length;
	} catch {
		// Non-serializable values are not expected, but a cache readout must
		// never throw.
		return 0;
	}
};

export function createLRUStorage<TSchema>(
	dbName: string = "pair-translate",
	storeName: string,
	maxSize: number,
) {
	let connection: Promise<IDBDatabase> | undefined;
	const usageStoreName = `__${storeName}_usage`;

	const open = (): Promise<IDBDatabase> => {
		if (connection) return connection;
		const opening = new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open(dbName, 1);

			request.onupgradeneeded = (event) => {
				const targetDb = (event.target as IDBOpenDBRequest).result;
				if (!targetDb.objectStoreNames.contains(storeName)) {
					targetDb.createObjectStore(storeName);
				}
				if (!targetDb.objectStoreNames.contains(usageStoreName)) {
					const usageStore = targetDb.createObjectStore(usageStoreName, {
						keyPath: "key",
					});
					usageStore.createIndex("lastUsed", "lastUsed", { unique: false });
				}
			};

			request.onsuccess = () => {
				const db = request.result;
				const forget = () => {
					if (connection === opening) connection = undefined;
				};
				db.onclose = forget;
				db.onversionchange = () => {
					forget();
					db.close();
				};
				resolve(db);
			};

			request.onerror = () => reject(request.error);
		});
		connection = opening;
		void opening.catch(() => {
			if (connection === opening) connection = undefined;
		});
		return opening;
	};

	// Helper to remove a single item (used by set)
	const evict = async (): Promise<void> => {
		const db = await open();
		return new Promise((resolve, reject) => {
			const transaction = db.transaction(
				[storeName, usageStoreName],
				"readwrite",
			);
			const dataStore = transaction.objectStore(storeName);
			const usageStore = transaction.objectStore(usageStoreName);
			const usageIndex = usageStore.index("lastUsed");

			const openCursorRequest = usageIndex.openCursor();

			openCursorRequest.onsuccess = (event) => {
				const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
				if (cursor) {
					const lruKey = cursor.value.key;
					dataStore.delete(lruKey);
					usageStore.delete(lruKey);
				}
				resolve();
			};

			openCursorRequest.onerror = () => {
				reject(openCursorRequest.error);
			};
		});
	};

	const getMany = async (
		keys: readonly Key[],
	): Promise<(TSchema | undefined)[]> => {
		if (!keys.length) return [];
		const db = await open();
		return new Promise((resolve, reject) => {
			const transaction = db.transaction(
				[storeName, usageStoreName],
				"readwrite",
			);
			const data = transaction.objectStore(storeName);
			const usage = transaction.objectStore(usageStoreName);
			const values = new Array<TSchema | undefined>(keys.length);
			keys.forEach((key, i) => {
				const request = data.get(key);
				request.onsuccess = () => {
					values[i] = request.result;
					if (request.result !== undefined)
						usage.put({ key, lastUsed: Date.now() });
				};
			});
			transaction.oncomplete = () => resolve(values);
			transaction.onabort = () =>
				reject(transaction.error ?? new Error("Cache read aborted"));
		});
	};
	const get = async (key: Key) => (await getMany([key]))[0];

	const set = async (key: Key, value: TSchema): Promise<void> => {
		const db = await open();
		return new Promise((resolve, reject) => {
			const transaction = db.transaction(
				[storeName, usageStoreName],
				"readwrite",
			);
			const dataStore = transaction.objectStore(storeName);
			const usageStore = transaction.objectStore(usageStoreName);

			dataStore.put(value, key);
			usageStore.put({ key, lastUsed: Date.now() });

			const countRequest = dataStore.count();

			countRequest.onsuccess = () => {
				if (countRequest.result > maxSize) {
					// Eviction is chained to the transaction completion
					transaction.oncomplete = () => {
						evict().then(resolve).catch(reject);
					};
				} else {
					transaction.oncomplete = () => resolve();
				}
			};

			countRequest.onerror = () => reject(countRequest.error);
			transaction.onerror = () => reject(transaction.error);
		});
	};

	const resize = async (newSize: number): Promise<void> => {
		// Update the closure variable so future sets respect the new limit
		if (maxSize === newSize) return;
		maxSize = newSize;

		const db = await open();
		return new Promise((resolve, reject) => {
			const transaction = db.transaction(
				[storeName, usageStoreName],
				"readwrite",
			);
			const dataStore = transaction.objectStore(storeName);
			const usageStore = transaction.objectStore(usageStoreName);
			const usageIndex = usageStore.index("lastUsed");

			// 1. Check current count
			const countRequest = dataStore.count();

			countRequest.onsuccess = () => {
				const currentCount = countRequest.result;
				let excess = currentCount - maxSize;

				if (excess <= 0) {
					// No eviction needed, let transaction complete
					return;
				}

				// 2. Iterate through oldest items and delete them
				const cursorRequest = usageIndex.openCursor();

				cursorRequest.onsuccess = (event) => {
					const cursor = (event.target as IDBRequest<IDBCursorWithValue>)
						.result;

					// As long as we have excess items and a valid cursor
					if (cursor && excess > 0) {
						const lruKey = cursor.value.key;

						// Delete data and usage entry
						dataStore.delete(lruKey);
						cursor.delete(); // Removes from usageStore efficiently

						excess--;
						cursor.continue(); // Move to next oldest
					}
				};

				cursorRequest.onerror = () => reject(cursorRequest.error);
			};

			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
			countRequest.onerror = () => reject(countRequest.error);
		});
	};

	const del = async (key: Key): Promise<void> => {
		const db = await open();
		return new Promise((resolve, reject) => {
			const transaction = db.transaction(
				[storeName, usageStoreName],
				"readwrite",
			);
			const dataStore = transaction.objectStore(storeName);
			const usageStore = transaction.objectStore(usageStoreName);

			dataStore.delete(key);
			usageStore.delete(key);

			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
		});
	};

	/**
	 * Snapshot entry count and approximate size.
	 *
	 * Only the data store is walked: the usage store keeps one metadata record
	 * per key, so counting it would double every entry. The usage index is read
	 * separately and stops at its first hit, because it is ordered by `lastUsed`.
	 */
	const stats = async (): Promise<LRUStats> => {
		const db = await open();
		return new Promise((resolve, reject) => {
			const transaction = db.transaction(
				[storeName, usageStoreName],
				"readonly",
			);
			const dataStore = transaction.objectStore(storeName);

			let entries = 0;
			let bytes = 0;

			const cursorRequest = dataStore.openCursor();
			cursorRequest.onsuccess = (event) => {
				const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
				if (!cursor) return;
				entries++;
				bytes +=
					(cursor.key instanceof ArrayBuffer ? cursor.key.byteLength : 0) +
					measureValue(cursor.value);
				cursor.continue();
			};

			let oldestUsedAt = 0;
			let oldestRead = false;
			const usageCursorRequest = transaction
				.objectStore(usageStoreName)
				.index("lastUsed")
				.openCursor();
			usageCursorRequest.onsuccess = (event) => {
				const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
				if (!cursor || oldestRead) return;
				oldestRead = true;
				oldestUsedAt = (cursor.value as { lastUsed?: number }).lastUsed ?? 0;
			};

			transaction.oncomplete = () => {
				resolve({ entries, bytes, maxSize, oldestUsedAt });
			};
			transaction.onerror = () => reject(transaction.error);
			cursorRequest.onerror = () => reject(cursorRequest.error);
			usageCursorRequest.onerror = () => reject(usageCursorRequest.error);
		});
	};

	const clear = async (): Promise<void> => {
		const db = await open();
		return new Promise((resolve, reject) => {
			const transaction = db.transaction(
				[storeName, usageStoreName],
				"readwrite",
			);
			const dataStore = transaction.objectStore(storeName);
			const usageStore = transaction.objectStore(usageStoreName);

			dataStore.clear();
			usageStore.clear();

			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
		});
	};

	const close = (): void => {
		const current = connection;
		connection = undefined;
		void current?.then(
			(db) => db.close(),
			() => {},
		);
	};

	return {
		open: async () => {
			await open();
		},
		getMany,
		get,
		set,
		del,
		clear,
		close,
		resize,
		stats,
	};
}
