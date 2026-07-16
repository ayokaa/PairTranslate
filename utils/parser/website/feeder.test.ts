import { describe, expect, test } from "bun:test";
import "../../test/dom-setup";
import { getState } from "../base";
import feeder, { FEEDER_READER_EXCLUDED_SELECTORS } from "./feeder";

describe("Feeder parser", () => {
	test("matches the online reader host", () => {
		expect(feeder().urlPatterns).toEqual(["feeder.co"]);
	});

	test("keeps post content outside reader chrome boundaries", () => {
		const root = document.createElement("main");
		root.innerHTML = `
			<div class="sidebar-navigation--inner">
				<div id="sidebar-text">All feeds</div>
			</div>
			<div id="feed-header" class="post-feed-header">Latest posts</div>
			<article class="reader--post-list-item">
				<a id="post-title" class="reader--post-list-item--title">A release worth reading</a>
				<div class="reader--post-list-item--meta">
					<div id="feed-name">Engineering feed</div>
					<div class="item-date">Five minutes ago</div>
				</div>
				<div id="post-summary" class="item-summary">The release includes several important changes.</div>
				<div class="expanded-content-wrapper">
					<p id="post-body">This is the expanded article body.</p>
				</div>
				<div class="reader--post-list-item--quick-action-bar">
					<div id="post-action">Share post</div>
				</div>
				<div class="expanded-bottom-bar">
					<a id="read-more">Read more</a>
				</div>
			</article>
			<div id="caller-text" class="caller-excluded">Excluded by the caller</div>
		`;
		const state = getState({
			roots: [root],
			filterInteractive: false,
			excludedSelectors: [
				".caller-excluded",
				...FEEDER_READER_EXCLUDED_SELECTORS,
			],
		});

		for (const id of ["post-title", "post-summary", "post-body"]) {
			expect(
				root.querySelector(`#${id}`)?.closest(state.excludedSelector),
			).toBe(null);
		}

		for (const id of [
			"sidebar-text",
			"feed-header",
			"feed-name",
			"post-action",
			"read-more",
			"caller-text",
		]) {
			expect(
				root.querySelector(`#${id}`)?.closest(state.excludedSelector),
			).not.toBe(null);
		}
	});
});
