import { describe, expect, it } from "bun:test";
import { getRootDomain } from "./domain";

describe("getRootDomain", () => {
	it("extracts standard root domain", () => {
		expect(getRootDomain("https://github.com/ayokaa")).toBe("github.com");
		expect(getRootDomain("https://docs.github.com/pages")).toBe("github.com");
		expect(getRootDomain("https://www.example.com/path")).toBe("example.com");
	});

	it("handles common double suffixes", () => {
		expect(getRootDomain("https://www.bbc.co.uk/news")).toBe("bbc.co.uk");
		expect(getRootDomain("https://sub.domain.com.cn/path")).toBe(
			"domain.com.cn",
		);
		expect(getRootDomain("https://site.co.jp/page")).toBe("site.co.jp");
	});

	it("returns null for localhost", () => {
		expect(getRootDomain("http://localhost:3000/page")).toBeNull();
		expect(getRootDomain("https://localhost")).toBeNull();
	});

	it("returns null for IP addresses", () => {
		expect(getRootDomain("http://192.168.1.1/page")).toBeNull();
		expect(getRootDomain("http://127.0.0.1:8080")).toBeNull();
	});

	it("returns null for invalid URLs", () => {
		expect(getRootDomain("")).toBeNull();
		expect(getRootDomain("not-a-url")).toBeNull();
	});
});
