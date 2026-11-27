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

test("strips <thinking> envelope from single chunk", () => {
	const f = createThinkingFilter();
	expect(f.process("<thinking>secret</thinking>after")).toBe("after");
});

test("strips <reasoning> envelope from single chunk", () => {
	const f = createThinkingFilter();
	expect(f.process("<reasoning>deep thoughts</reasoning>world")).toBe("world");
});

test("strips <think> envelope from single chunk", () => {
	const f = createThinkingFilter();
	expect(f.process("<think>hidden content</think>rest")).toBe("rest");
});

test("handles consecutive reasoning envelopes in one chunk", () => {
	const f = createThinkingFilter();
	expect(f.process("<thinking>1</thinking><reasoning>2</reasoning>c")).toBe(
		"c",
	);
});

test("preserves literal thinking tags in Markdown and plain text", () => {
	const f = createThinkingFilter();
	const text =
		"使用 `<think>` 启用推理。\n```html\n<thinking>literal</thinking>\n<reasoning>literal</reasoning>\n```\n普通文本 <think> 保留。";
	expect(f.process(text)).toBe(text);
	expect(f.flush()).toBeUndefined();
});

test("preserves a literal opening tag split across chunks", () => {
	const f = createThinkingFilter();
	expect(f.process("普通文本 <thi")).toBe("普通文本 <thi");
	expect(f.process("nk> 保留")).toBe("nk> 保留");
	expect(f.flush()).toBeUndefined();
});

test("handles thinking envelope split across two chunks", () => {
	const f = createThinkingFilter();
	expect(f.process("<thinking>sec")).toBeUndefined();
	expect(f.process("ret</thinking>after")).toBe("after");
});

test("handles opening tag split across chunks", () => {
	const f = createThinkingFilter();
	expect(f.process("<thin")).toBeUndefined();
	expect(f.process("king>secret</thinking>world")).toBe("world");
});

test("handles closing tag split across chunks", () => {
	const f = createThinkingFilter();
	expect(f.process("<thinking>secret</think")).toBeUndefined();
	expect(f.process("ing>b")).toBe("b");
});

test("flush returns undefined when no buffer", () => {
	const f = createThinkingFilter();
	expect(f.flush()).toBeUndefined();
});

test("flush returns buffered partial tag as text", () => {
	const f = createThinkingFilter();
	f.process("<thin");
	expect(f.flush()).toBe("<thin");
});

test("flush discards content when inside thinking envelope", () => {
	const f = createThinkingFilter();
	f.process("<thinking>still thinking");
	expect(f.flush()).toBeUndefined();
});

test("flush after complete thinking envelope returns undefined", () => {
	const f = createThinkingFilter();
	f.process("<thinking>secret</thinking>after");
	expect(f.flush()).toBeUndefined();
});

test("full lifecycle: stream chunks then flush", () => {
	const f = createThinkingFilter();
	expect(f.process("<thinking>let me")).toBeUndefined();
	expect(f.process(" think about this")).toBeUndefined();
	expect(f.process("</thinking>Hello ")).toBe("Hello ");
	expect(f.process("world")).toBe("world");
	expect(f.flush()).toBeUndefined();
});

test("handles <think> tag split across chunks after leading whitespace", () => {
	const f = createThinkingFilter();
	expect(f.process(" \n<thi")).toBe(" \n");
	expect(f.process("nk>secret</think>after")).toBe("after");
});
