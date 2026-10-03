import { expect, test } from "bun:test";
import { createTokenBucket } from "./token-bucket";

test("consumes available tokens", () => {
	let now = 0;
	const bucket = createTokenBucket(60, { now: () => now });
	expect(bucket.consume(30)).toBe(true);
	expect(bucket.available()).toBe(30);
	expect(bucket.consume(40)).toBe(false);
});

test("refills tokens over time", () => {
	let now = 0;
	const bucket = createTokenBucket(60, { now: () => now });
	bucket.consume(60);
	expect(bucket.consume(1)).toBe(false);
	now += 30000;
	expect(bucket.consume(30)).toBe(true);
});

test("reports wait time for deficit", () => {
	let now = 0;
	const bucket = createTokenBucket(120, { now: () => now });
	bucket.consume(120);
	now += 15000;
	expect(bucket.msUntil(60)).toBe(15000);
});

test("an over-reported batch leaves the bucket empty, not in debt", () => {
	let now = 0;
	const bucket = createTokenBucket(60000, { now: () => now });
	expect(bucket.consume(60000)).toBe(true); // the whole minute is spent
	bucket.forceConsume(3400); // the batch reported more than estimated

	expect(bucket.available()).toBe(0);
	// The next request waits for its own tokens, not for the over-report.
	expect(bucket.msUntil(600)).toBe(600);
});

test("debt is bounded by one minute of budget", () => {
	let now = 0;
	const bucket = createTokenBucket(60000, { now: () => now });
	// Twenty batches estimated at 600 tokens that each reported 4000: even so,
	// asking for the whole minute of budget waits at most that minute, instead
	// of for minutes of accumulated debt.
	for (let i = 0; i < 20; i++) {
		bucket.consume(600);
		bucket.forceConsume(3400);
	}

	expect(bucket.available()).toBe(0);
	expect(bucket.msUntil(60000)).toBe(60000);
});
