import { expect, test } from "bun:test";
import "../test/dom-setup";
import { improvesExtraction } from "./verify";

test("a candidate may remove navigation while retaining article text", () => {
	const nav = document.createElement("nav");
	const menu = document.createElement("p");
	nav.append(menu);
	const main = document.createElement("main");
	const article = document.createElement("p");
	main.append(article);
	expect(
		improvesExtraction(
			[
				{ text: "Navigation links", element: menu },
				{ text: "Useful article text", element: article },
			],
			[{ text: "Useful article text", element: article }],
		),
	).toBe(true);
});

test("a candidate that loses article text is rejected", () => {
	const main = document.createElement("main");
	const first = document.createElement("p");
	const second = document.createElement("p");
	main.append(first, second);
	expect(
		improvesExtraction(
			[
				{ text: "First article paragraph", element: first },
				{ text: "Second article paragraph", element: second },
			],
			[{ text: "First article paragraph", element: first }],
		),
	).toBe(false);
});

test("a matching untranslated candidate can validate a new extraction", () => {
	const paragraph = document.createElement("p");
	expect(
		improvesExtraction(
			[],
			[{ text: "Recovered article text", element: paragraph }],
			[{ text: "Recovered article text", element: paragraph }],
			true,
		),
	).toBe(true);
	expect(
		improvesExtraction(
			[],
			[{ text: "Unrelated navigation text", element: paragraph }],
			[{ text: "Recovered article text", element: paragraph }],
			true,
		),
	).toBe(false);
});

test("an include-only rule is rejected when it extracts no supplied candidate", () => {
	const paragraph = document.createElement("p");
	expect(
		improvesExtraction(
			[{ text: "Existing article text", element: paragraph }],
			[{ text: "Existing article text", element: paragraph }],
			[{ text: "Filtered article text", element: paragraph }],
			true,
		),
	).toBe(false);
});

test("a candidate may remove a nonsemantic menu outside retained main content", () => {
	const menu = document.createElement("ul");
	menu.className = "a11y-menu";
	const menuItem = document.createElement("li");
	menuItem.append(document.createElement("a"));
	menu.append(menuItem);
	const main = document.createElement("main");
	const article = document.createElement("p");
	main.append(article);
	expect(
		improvesExtraction(
			[
				{ text: "Skip to main content", element: menuItem },
				{ text: "Useful article text", element: article },
			],
			[{ text: "Useful article text", element: article }],
		),
	).toBe(true);
});

test("a candidate cannot remove an ordinary paragraph outside main content", () => {
	const related = document.createElement("div");
	const paragraph = document.createElement("p");
	related.append(paragraph);
	const main = document.createElement("main");
	const article = document.createElement("p");
	main.append(article);
	expect(
		improvesExtraction(
			[
				{ text: "Other useful page content", element: paragraph },
				{ text: "Useful article text", element: article },
			],
			[{ text: "Useful article text", element: article }],
		),
	).toBe(false);
});

test("a shared menu-styled wrapper does not make unrelated content safe to remove", () => {
	const layout = document.createElement("div");
	layout.className = "menu-open";
	const paragraph = document.createElement("p");
	const link = document.createElement("a");
	paragraph.append(link);
	const main = document.createElement("main");
	const article = document.createElement("p");
	main.append(article);
	layout.append(paragraph, main);
	expect(
		improvesExtraction(
			[
				{ text: "Useful text outside main", element: paragraph },
				{ text: "Useful article text", element: article },
			],
			[{ text: "Useful article text", element: article }],
		),
	).toBe(false);
});

test("a candidate can combine fragments but cannot claim no change as improvement", () => {
	const element = document.createElement("p");
	const baseline = [
		{ text: "First fragment", element },
		{ text: "Second fragment", element },
	];
	expect(
		improvesExtraction(baseline, [
			{ text: "First fragment Second fragment", element },
		]),
	).toBe(true);
	expect(improvesExtraction(baseline, baseline)).toBe(false);
});

test("a duplicated paragraph cannot mask the loss of its copy", () => {
	const main = document.createElement("main");
	const first = document.createElement("p");
	first.textContent = "Repeated body paragraph";
	const second = document.createElement("p");
	second.textContent = "Repeated body paragraph";
	const recovered = document.createElement("p");
	recovered.textContent = "Previously missed paragraph";
	main.append(first, second, recovered);
	const baseline = [
		{ text: "Repeated body paragraph", element: first },
		{ text: "Repeated body paragraph", element: second },
	];
	const candidate = [
		{ text: "Repeated body paragraph", element: first },
		{ text: "Previously missed paragraph", element: recovered },
	];
	expect(
		improvesExtraction(
			baseline,
			candidate,
			[{ text: "Previously missed paragraph", element: recovered }],
			true,
		),
	).toBe(false);
});

test("content outside the new roots still blocks a narrowing candidate", () => {
	const shell = document.createElement("div");
	const sidebar = document.createElement("div");
	const sidebarText = document.createElement("p");
	sidebarText.textContent = "Sidebar essay text";
	sidebar.append(sidebarText);
	const main = document.createElement("main");
	const body = document.createElement("p");
	body.textContent = "Article body";
	main.append(body);
	shell.append(sidebar, main);
	document.body.append(shell);
	try {
		const baseline = [
			{ text: "Sidebar essay text", element: sidebarText },
			{ text: "Article body", element: body },
		];
		const candidate = [{ text: "Article body", element: body }];
		// The sidebar is plain content outside the new root, not page chrome.
		expect(improvesExtraction(baseline, candidate, [], false, [main])).toBe(
			false,
		);
	} finally {
		shell.remove();
	}
});
