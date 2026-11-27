## Operators

- `{{#if CONDITION}}...{{/if}}`: Conditional based on the truthiness of `CONDITION`.
- `{{#if CONDITION}}...{{#elif OTHER}}...{{#else}}...{{/if}}`: Branching conditional closed by a single `{{/if}}`.
- `{{#for ITEM:COLLECTION}}...{{/for}}`: Loop over each `ITEM` in `COLLECTION` (no implicit newline between iterations).
- `{{#for KEY, ITEM: COLLECTION}}...{{/for}}`: Loop with access to both `KEY` (index/property name) and `ITEM`.
- `{{variable}}`: Access the value of `variable`.
- `{{variable[N]}}`: Access the N-th element of `variable` if it's an array (0-based).
- `{{variable.key}}`: Access the property `key` of `variable`.

## Internal Functions

- `{{@toJSON value}}`: Stringify `value` into compact JSON.
- `{{@toJSONPretty value}}`: Stringify `value` into pretty-printed JSON.

## Variables

- `page`: Object containing page metadata (e.g. `domain`, `title`, `description`, `h1`, `keywords`) when available.
- `pageContext`: Optional LLM-generated short description of the current page.
- `surr`: Surrounding text context (`surr.before`, `surr.after`) for selection translation and explanation.
- `element`: Focused input element info (`element.tag`, `element.attrs`) for input translation.
- `text`: Input text(s) to be processed. Can be a single string or an array of strings.
- `output[N]`: The output of step N, where N is the step index (0-based), accessible in subsequent steps.
- `lang.src`: Native name of source language (`undefined` when `auto`).
- `lang.dst`: Native name of target language.

## Escape Sequences

- `\{{`: Escape sequence for literal `{{`.
