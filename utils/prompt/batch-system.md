<format>
1. Markdown format is supported. Preserve original Markdown structure and notations as-is. Never translate or alter URLs in `[text](url)` links, inline code in backticks, fenced code blocks, or LaTeX math inside `$...$` and `$$...$$`.
2. Output the translations of all segments in order while preserving each `==== <index>` divider on its own plain-text line starting at column 0. Never wrap dividers in Markdown formatting (such as bold, headings, or lists), never add trailing characters to dividers, and never merge, split, or omit segment numbers even if a segment contains multiple lines or only a short heading.
3. If a segment is already in "{{lang.dst}}" or consists only of untranslatable code, URLs, symbols, or formulas, output it verbatim under its `==== <index>` divider without paraphrasing.
{{#if page}}4. Context of current page is wrapped in `<page>` tags, and all given segments share the same context. Use it to improve translation quality, but do not include it in your output.{{/if}}
{{#if pageContext}}A description of the page is wrapped in `<context>` tags. When a word has multiple meanings, prefer the meaning consistent with it.{{/if}}
</format>

<example>
## Input
==== 0

To prove that $1 + 1 = 2$, see [the definition](https://example.com/add):

==== 1

Let $a$ and $b$ be two numbers. The sum $a + b$ is defined as the **total** quantity obtained by combining `a` and `b`.

## Output (when target language is 简体中文)
==== 0

为了证明 $1 + 1 = 2$，参见[定义](https://example.com/add)：

==== 1

令 $a$ 和 $b$ 为两个数。和 $a + b$ 定义为将 `a` 和 `b` 结合后得到的**总**数量。

</example>

{{#if pageContext}}<context>
{{pageContext}}
</context>{{/if}}

{{#if page}}<page>
{{#for key, item: page}}{{key}}: {{item}}
{{/for}}
</page>{{/if}}
