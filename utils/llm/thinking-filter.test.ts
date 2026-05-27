import { expect, test } from "bun:test";
import { createThinkingFilter } from "./thinking-filter";

test("passes through plain text unchanged", () => {
	const f = createThinkingFilter();
	expect(f.process("hello world")).toBe("hello world");
});

test("returns undefined for empty input", () => {
	const f = createThinkingFilter();
	expect(f.process("")).toBeUndefined();
	expect(f.process(undefined as unknown as string)).toBeUndefined();
});

test("strips <thinking> block from single chunk", () => {
	const f = createThinkingFilter();
	expect(f.process("before<thinking>secret</thinking>after")).toBe(
		"beforeafter",
	);
});

test("strips <reasoning> block from single chunk", () => {
	const f = createThinkingFilter();
	expect(f.process("hello<reasoning>deep thoughts</reasoning>world")).toBe(
		"helloworld",
	);
});

test("strips <think tag block from single chunk", () => {
	const f = createThinkingFilter();
	expect(f.process("visible<think>hidden content</think>rest")).toBe(
		"visiblerest",
	);
});

test("handles multiple thinking blocks in one chunk", () => {
	const f = createThinkingFilter();
	expect(f.process("a<thinking>1</thinking>b<reasoning>2</reasoning>c")).toBe(
		"abc",
	);
});

test("handles thinking block split across two chunks", () => {
	const f = createThinkingFilter();
	expect(f.process("before<thinking>sec")).toBe("before");
	expect(f.process("ret</thinking>after")).toBe("after");
});

test("handles opening tag split across chunks", () => {
	const f = createThinkingFilter();
	expect(f.process("hello<thin")).toBe("hello");
	expect(f.process("king>secret</thinking>world")).toBe("world");
});

test("handles closing tag split across chunks", () => {
	const f = createThinkingFilter();
	expect(f.process("a<thinking>secret</think")).toBe("a");
	expect(f.process("ing>b")).toBe("b");
});

test("flush returns undefined when no buffer", () => {
	const f = createThinkingFilter();
	expect(f.flush()).toBeUndefined();
});

test("flush returns buffered partial tag as text", () => {
	const f = createThinkingFilter();
	f.process("hello<thin");
	expect(f.flush()).toBe("<thin");
});

test("flush discards content when inside thinking block", () => {
	const f = createThinkingFilter();
	f.process("a<thinking>still thinking");
	expect(f.flush()).toBeUndefined();
});

test("flush after complete thinking block returns undefined", () => {
	const f = createThinkingFilter();
	f.process("before<thinking>secret</thinking>after");
	expect(f.flush()).toBeUndefined();
});

test("full lifecycle: stream chunks then flush", () => {
	const f = createThinkingFilter();
	expect(f.process("Hello ")).toBe("Hello ");
	expect(f.process("world<thinking>let me")).toBe("world");
	expect(f.process(" think about this")).toBeUndefined();
	expect(f.process("</thinking> done")).toBe(" done");
	expect(f.flush()).toBeUndefined();
});

test("handles <think tag split across chunks", () => {
	const f = createThinkingFilter();
	expect(f.process("before<thi")).toBe("before");
	expect(f.process("nk>secret</think>after")).toBe("after");
});
