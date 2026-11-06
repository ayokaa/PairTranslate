import { describe, expect, test } from "bun:test";
import "../test/dom-setup";
import { Event as DOMEvent } from "linkedom";
import { getMarkdownFromSection } from "../markdown";
import { domListener } from "./base";
import type { DOMSection, Options } from "./types";

const collectSections = async (
	root: Element,
	expected: number,
	options: Options = {},
) => {
	const controller = new AbortController();
	const sections: DOMSection[] = [];

	for await (const section of domListener({
		...options,
		roots: [root],
		listenNew: false,
		filterInteractive: false,
		signal: controller.signal,
	})) {
		sections.push(section);
		if (sections.length === expected) controller.abort();
	}

	return sections;
};

describe("domListener", () => {
	test("promotes fully styled paragraphs by default", async () => {
		// A paragraph whose text is entirely wrapped in inline elements
		// (italics, links, highlights) has no direct text node of its own.
		// It must stay one section instead of shattering into per-element
		// fragments that translators would merge back together.
		const paragraph = document.createElement("p");
		const em1 = document.createElement("em");
		em1.textContent = " [ In ";
		const link = document.createElement("a");
		link.href = "https://example.com/iteration/";
		const em2 = document.createElement("em");
		em2.textContent = "Iteration";
		link.append(em2);
		const em3 = document.createElement("em");
		em3.textContent = ", I wrote about mistakes. ]";
		paragraph.append(em1, link, em3);
		document.body.append(paragraph);

		const sections = await collectSections(paragraph, 1);

		expect(sections).toHaveLength(1);
		const markdown = getMarkdownFromSection(sections[0]);
		expect(markdown).toContain("Iteration");
		expect(markdown).toContain("I wrote about mistakes");
	});

	test("does not promote containers that only wrap excluded descendants", async () => {
		// Hacker News comment chrome: <div style> wraps <span class="comhead">
		// (user, age, nav links). Promoting the wrapper would swallow the
		// excluded comhead into a section and translate the nav line.
		const root = document.createElement("div");
		const wrapper = document.createElement("div");
		const comhead = document.createElement("span");
		comhead.className = "comhead";
		const user = document.createElement("a");
		user.textContent = "lostlogin";
		comhead.append(
			user,
			document.createTextNode(" 1 day ago | parent | next "),
		);
		wrapper.append(comhead);
		const comment = document.createElement("div");
		comment.className = "commtext";
		comment.textContent = "Real comment text.";
		root.append(wrapper, comment);
		document.body.append(root);

		const sections = await collectSections(root, 1, {
			excludedSelectors: [".comhead"],
		});

		expect(sections).toHaveLength(1);
		expect(getMarkdownFromSection(sections[0])).toBe("Real comment text.");
	});

	test("keeps word-level inline spans in one paragraph", async () => {
		const paragraph = document.createElement("p");
		for (const [index, word] of ["Who", "can", "punch", "reality"].entries()) {
			const span = document.createElement("span");
			span.className = "hl-word";
			span.dataset.i = String(index);
			span.textContent = word;
			paragraph.append(span);
			if (index < 3) paragraph.append(document.createTextNode(" "));
		}
		document.body.append(paragraph);

		const sections = await collectSections(paragraph, 1, {
			promoteTextTags: ["P"],
		});

		expect(sections).toHaveLength(1);
		expect(getMarkdownFromSection(sections[0])).toBe("Who can punch reality");
	});

	test("still splits paragraphs at block descendants", async () => {
		const root = document.createElement("div");
		for (const text of ["First paragraph.", "Second paragraph."]) {
			const paragraph = document.createElement("p");
			paragraph.textContent = text;
			root.append(paragraph);
		}
		document.body.append(root);

		const sections = await collectSections(root, 2);

		expect(sections).toHaveLength(2);
		expect(sections.map(getMarkdownFromSection)).toEqual([
			"First paragraph.",
			"Second paragraph.",
		]);
	});

	test("keeps the judge function applied to blocks split from a text container", async () => {
		const root = document.createElement("div");
		root.append(document.createTextNode("Intro text."));
		const excluded = document.createElement("div");
		excluded.className = "selection-excluded";
		const nested = document.createElement("p");
		nested.textContent = "Outside the selected area.";
		excluded.append(nested);
		const included = document.createElement("p");
		included.textContent = "Inside the selected area.";
		root.append(excluded, included);
		document.body.append(root);

		const sections = await collectSections(root, 2, {
			judgeFn: (element) => !element.classList.contains("selection-excluded"),
		});

		expect(sections.map(getMarkdownFromSection)).toEqual([
			"Intro text.",
			"Inside the selected area.",
		]);
	});

	test("does not promote Hacker News title cells over their links", async () => {
		const root = document.createElement("table");
		const row = document.createElement("tr");
		const titleCell = document.createElement("td");
		const titleLine = document.createElement("span");
		const link = document.createElement("a");
		link.href = "https://example.com/story";
		link.textContent = "A story title";
		titleLine.className = "titleline";
		titleLine.append(link);
		titleCell.className = "title";
		titleCell.append(titleLine);
		row.append(titleCell);
		root.append(row);
		document.body.append(root);

		const sections = await collectSections(root, 1);

		expect(sections).toHaveLength(1);
		expect(sections[0][0]).toBe(link.firstChild as Node);
		expect(getMarkdownFromSection(sections[0])).toBe("A story title");
	});

	test("skips numeric table cells containing Unicode symbols", async () => {
		const root = document.createElement("table");
		const row = document.createElement("tr");
		for (const text of ["Benchmark", "56.6%", "61.1 ± 0.79", "–"]) {
			const cell = document.createElement("td");
			cell.textContent = text;
			row.append(cell);
		}
		root.append(row);
		document.body.append(root);

		const sections = await collectSections(root, 1);

		expect(sections).toHaveLength(1);
		expect(getMarkdownFromSection(sections[0])).toBe("Benchmark");
	});

	test("does not promote layout ancestors that only contain deep math", async () => {
		// Quarto-like shell: outer page-columns div wraps <main> and a formula
		// lives deep inside a paragraph. The outer div must not become one
		// giant section (which would inject the translation after </main>).
		const shell = document.createElement("div");
		shell.id = "quarto-content";
		shell.className = "quarto-container page-columns";

		const main = document.createElement("main");
		main.id = "quarto-document-content";

		const p1 = document.createElement("p");
		p1.textContent = "First body paragraph.";

		const p2 = document.createElement("p");
		p2.append(document.createTextNode("Has formula "));
		const math = document.createElement("span");
		math.className = "math inline";
		math.textContent = "x = 1";
		p2.append(math);
		p2.append(document.createTextNode(" here."));

		const p3 = document.createElement("p");
		p3.textContent = "Third paragraph.";

		main.append(p1, p2, p3);
		shell.append(main);
		document.body.append(shell);

		const sections = await collectSections(shell, 3);
		const texts = sections.map(getMarkdownFromSection);

		expect(sections).toHaveLength(3);
		expect(texts[0]).toBe("First body paragraph.");
		expect(texts[1]).toContain("Has formula");
		expect(texts[1]).toContain("here.");
		expect(texts[2]).toBe("Third paragraph.");
		// No single section spanning the whole article.
		expect(texts.some((t) => t.includes("First") && t.includes("Third"))).toBe(
			false,
		);
	});

	test("still promotes leaf containers that only wrap math", async () => {
		const paragraph = document.createElement("p");
		const math = document.createElement("span");
		math.className = "math inline";
		math.textContent = "E = mc^2";
		paragraph.append(math);
		document.body.append(paragraph);

		const sections = await collectSections(paragraph, 1);

		expect(sections).toHaveLength(1);
		expect(getMarkdownFromSection(sections[0])).toContain("E = mc^2");
	});

	test("splits at main when a parent text container wraps the document body", async () => {
		// Defense in depth: even if a parent were treated as a text container,
		// MAIN must be a block boundary so paragraphs inside stay separate.
		const shell = document.createElement("div");
		shell.append(document.createTextNode("Lead-in. "));

		const main = document.createElement("main");
		const p1 = document.createElement("p");
		p1.textContent = "Inside main one.";
		const p2 = document.createElement("p");
		p2.textContent = "Inside main two.";
		main.append(p1, p2);
		shell.append(main);
		document.body.append(shell);

		const sections = await collectSections(shell, 3);
		const texts = sections.map((s) => getMarkdownFromSection(s).trim());

		expect(texts).toEqual(["Lead-in.", "Inside main one.", "Inside main two."]);
	});
});

describe("page content semantics", () => {
	test("keeps visible aria-hidden notes, read-only text and nosnippet text", async () => {
		const root = document.createElement("main");
		root.innerHTML = `
			<aside aria-hidden="true"><p>A useful margin note.</p></aside>
			<div contenteditable="false"><p>A read-only article.</p></div>
			<div data-nosnippet><p>Text excluded from search snippets.</p></div>
		`;
		document.body.append(root);
		try {
			expect(
				(await collectSections(root, 3)).map(getMarkdownFromSection),
			).toEqual([
				"A useful margin note.",
				"A read-only article.",
				"Text excluded from search snippets.",
			]);
		} finally {
			root.remove();
		}
	});

	test("retains actual editor, explicit hidden and no-translate boundaries", async () => {
		const root = document.createElement("main");
		root.innerHTML = `
			<div contenteditable="true"><div contenteditable="false"><p>An editor island.</p></div></div>
			<div contenteditable="plaintext-only"><p>Editable plain text.</p></div>
			<div contenteditable><p>Editable text.</p></div>
			<div hidden><p>Hidden text.</p></div>
			<p translate="no">Explicitly excluded text.</p>
			<p>Ordinary article text.</p>
		`;
		document.body.append(root);
		try {
			expect(
				(await collectSections(root, 1)).map(getMarkdownFromSection),
			).toEqual(["Ordinary article text."]);
		} finally {
			root.remove();
		}
	});
});

test("attribute changes and resize recover skipped text without duplicate sections", async () => {
	const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
	const previousObserver = Object.getOwnPropertyDescriptor(
		globalThis,
		"MutationObserver",
	);
	const view = document.defaultView!;
	const originalStyle = view.getComputedStyle;
	const events = new EventTarget();
	Object.assign(globalThis, {
		window: events,
		MutationObserver: view.MutationObserver,
	});
	view.getComputedStyle = ((element: Element) => ({
		display: (element as HTMLElement).style.display || "block",
		visibility: "visible",
		opacity: "1",
		position: "static",
		clip: "auto",
	})) as typeof view.getComputedStyle;
	const root = document.createElement("main");
	root.innerHTML =
		'<p>Initially visible prose.</p><div hidden><p>Newly opened prose.</p></div><div style="display:none"><p>Responsive prose.</p></div>';
	document.body.append(root);
	const controller = new AbortController();
	const iterator = domListener({
		roots: [root],
		signal: controller.signal,
		filterInteractive: false,
	});
	try {
		const first = await iterator.next();
		expect(first.done).toBe(false);
		if (first.done) throw new Error("Expected initial section");
		expect(getMarkdownFromSection(first.value)).toBe(
			"Initially visible prose.",
		);
		const afterAttribute = iterator.next();
		root.querySelector("[hidden]")!.removeAttribute("hidden");
		const opened = await afterAttribute;
		if (opened.done) throw new Error("Expected revealed section");
		expect(getMarkdownFromSection(opened.value)).toBe("Newly opened prose.");
		const afterResize = iterator.next();
		(root.querySelector("[style]") as HTMLElement).style.display = "block";
		events.dispatchEvent(new Event("resize"));
		const responsive = await afterResize;
		if (responsive.done) throw new Error("Expected responsive section");
		expect(getMarkdownFromSection(responsive.value)).toBe("Responsive prose.");
		const end = iterator.next();
		controller.abort();
		expect((await end).done).toBe(true);
	} finally {
		controller.abort();
		await iterator.return();
		root.remove();
		view.getComputedStyle = originalStyle;
		for (const [name, descriptor] of [
			["window", previousWindow],
			["MutationObserver", previousObserver],
		] as const) {
			if (descriptor) Object.defineProperty(globalThis, name, descriptor);
			else Reflect.deleteProperty(globalThis, name);
		}
	}
});

test("inline attribute rescans retain the paragraph boundary", async () => {
	const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
	const previousObserver = Object.getOwnPropertyDescriptor(
		globalThis,
		"MutationObserver",
	);
	Object.assign(globalThis, {
		window: new EventTarget(),
		MutationObserver: document.defaultView!.MutationObserver,
	});
	const root = document.createElement("main");
	root.innerHTML =
		"<p><span>First fragment.</span><span>Second fragment.</span></p>";
	document.body.append(root);
	const controller = new AbortController();
	const iterator = domListener({
		roots: [root],
		signal: controller.signal,
		filterInteractive: false,
	});
	try {
		const first = await iterator.next();
		if (first.done) throw new Error("Expected paragraph");
		expect(getMarkdownFromSection(first.value)).toBe(
			"First fragment.Second fragment.",
		);
		const next = iterator.next();
		root.querySelectorAll("span")[1].className = "highlighted";
		const paragraph = document.createElement("p");
		paragraph.textContent = "New independent paragraph.";
		root.append(paragraph);
		const second = await next;
		if (second.done) throw new Error("Expected new paragraph");
		expect(getMarkdownFromSection(second.value)).toBe(
			"New independent paragraph.",
		);
	} finally {
		controller.abort();
		await iterator.return();
		root.remove();
		for (const [name, descriptor] of [
			["window", previousWindow],
			["MutationObserver", previousObserver],
		] as const) {
			if (descriptor) Object.defineProperty(globalThis, name, descriptor);
			else Reflect.deleteProperty(globalThis, name);
		}
	}
});

test("animation completion recovers visible text without an attribute mutation", async () => {
	const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
	const previousObserver = Object.getOwnPropertyDescriptor(
		globalThis,
		"MutationObserver",
	);
	const view = document.defaultView!;
	const originalStyle = view.getComputedStyle;
	Object.assign(globalThis, {
		window: new EventTarget(),
		MutationObserver: view.MutationObserver,
	});
	let transparent = true;
	view.getComputedStyle = ((element: Element) => ({
		display: "block",
		visibility: "visible",
		opacity: element.id === "fading-prose" && transparent ? "0" : "1",
		clip: "auto",
		position: "static",
	})) as typeof view.getComputedStyle;
	const root = document.createElement("main");
	root.innerHTML =
		'<p>Visible seed paragraph.</p><p id="fading-prose">Newly visible animated prose.</p>';
	document.body.append(root);
	const controller = new AbortController();
	const iterator = domListener({
		roots: [root],
		signal: controller.signal,
		filterInteractive: false,
	});
	try {
		await iterator.next();
		const next = iterator.next();
		// Let the initial scan finish while the animation is transparent.
		await Promise.resolve();
		await Promise.resolve();
		transparent = false;
		root
			.querySelector("#fading-prose")!
			.dispatchEvent(
				new DOMEvent("animationend", { bubbles: true }) as unknown as Event,
			);
		const control = document.createElement("p");
		control.textContent = "Later control paragraph.";
		root.append(control);
		const recovered = await next;
		if (recovered.done) throw new Error("Expected recovered animation");
		expect(getMarkdownFromSection(recovered.value)).toBe(
			"Newly visible animated prose.",
		);
	} finally {
		controller.abort();
		await iterator.return();
		root.remove();
		view.getComputedStyle = originalStyle;
		for (const [name, descriptor] of [
			["window", previousWindow],
			["MutationObserver", previousObserver],
		] as const) {
			if (descriptor) Object.defineProperty(globalThis, name, descriptor);
			else Reflect.deleteProperty(globalThis, name);
		}
	}
});

for (const nested of [false, true])
	test(`expanded ${nested ? "nested" : "sibling"} inline ranges emit only newly visible text`, async () => {
		const previousWindow = Object.getOwnPropertyDescriptor(
			globalThis,
			"window",
		);
		const previousObserver = Object.getOwnPropertyDescriptor(
			globalThis,
			"MutationObserver",
		);
		const view = document.defaultView!;
		const originalStyle = view.getComputedStyle;
		Object.assign(globalThis, {
			window: new EventTarget(),
			MutationObserver: view.MutationObserver,
		});
		view.getComputedStyle = ((element: Element) => ({
			display: (element as HTMLElement).style.display || "block",
			visibility: "visible",
			opacity: "1",
			clip: "auto",
			position: "static",
		})) as typeof view.getComputedStyle;
		const root = document.createElement("main");
		root.innerHTML = nested
			? '<p><span>First prose.<span style="display:none">Second prose.</span></span></p>'
			: '<p>First prose.<span style="display:none">Second prose.</span></p>';
		document.body.append(root);
		const controller = new AbortController();
		const iterator = domListener({
			roots: [root],
			signal: controller.signal,
			filterInteractive: false,
		});
		try {
			const first = await iterator.next();
			if (first.done) throw new Error("Expected first prose");
			expect(getMarkdownFromSection(first.value)).toBe("First prose.");
			const next = iterator.next();
			root.querySelector("[style]")!.setAttribute("style", "display:inline");
			const control = document.createElement("p");
			control.textContent = "Control prose.";
			root.append(control);
			const second = await next;
			if (second.done) throw new Error("Expected revealed prose");
			expect(getMarkdownFromSection(second.value)).toBe("Second prose.");
			expect(getMarkdownFromSection(first.value)).toBe("First prose.");
			const third = await iterator.next();
			if (third.done) throw new Error("Expected control");
			expect(getMarkdownFromSection(third.value)).toBe("Control prose.");
		} finally {
			controller.abort();
			await iterator.return();
			root.remove();
			view.getComputedStyle = originalStyle;
			for (const [name, descriptor] of [
				["window", previousWindow],
				["MutationObserver", previousObserver],
			] as const) {
				if (descriptor) Object.defineProperty(globalThis, name, descriptor);
				else Reflect.deleteProperty(globalThis, name);
			}
		}
	});
