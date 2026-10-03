export type TokenBucket = {
	update(tokensPerMinute: number): void;
	consume(tokens: number): boolean;
	forceConsume(tokens: number): void;
	msUntil(tokens: number): number;
	available(): number;
};

export type TokenBucketOptions = {
	now?: () => number;
};

export const createTokenBucket = (
	tokensPerMinute: number,
	options?: TokenBucketOptions,
): TokenBucket => {
	let capacity = tokensPerMinute;
	let tokens = tokensPerMinute;
	const now = options?.now ?? (() => Date.now());
	let lastRefill = now();

	const refill = () => {
		const current = now();
		const elapsed = current - lastRefill;
		if (elapsed <= 0) return;
		const rate = capacity / 60000;
		tokens = Math.min(capacity, tokens + elapsed * rate);
		lastRefill = current;
	};

	return {
		update(next) {
			refill();
			capacity = next;
			tokens = Math.min(tokens, next);
		},
		consume(requested) {
			refill();
			if (tokens >= requested) {
				tokens -= requested;
				return true;
			}
			return false;
		},
		forceConsume(requested) {
			refill();
			// Charging more than the balance would put the bucket into debt, and
			// the next request would then wait for that debt *plus* its own tokens:
			// one batch that over-reports its usage could stall the model's whole
			// queue for minutes, invisibly, because `available()` reads 0 either
			// way. The balance therefore floors at zero — an over-reported batch is
			// charged what the bucket still holds and no more.
			tokens = Math.max(0, tokens - requested);
		},
		msUntil(requested) {
			refill();
			if (tokens >= requested) return 0;
			const deficit = requested - tokens;
			const rate = capacity / 60000;
			return rate <= 0 ? 1000 : Math.ceil(deficit / rate);
		},
		available() {
			refill();
			return Math.max(0, tokens);
		},
	};
};
