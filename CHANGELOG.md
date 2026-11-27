# Changelog

## Unreleased

- Configure thinking effort separately for each translation, explanation, summary, page-context, and webpage-adaptation feature, including website rules and the translator window. Feature settings inherit the model's default unless explicitly overridden; Off remains an explicit override. Changing models in the popup preserves the feature's effort. Settings migrate to v15, and translation caches, page-context caches, and adaptation cooldowns distinguish the effective effort.
- Translate long full pages progressively: loading placeholders are mounted only for batches the selected model has room for, instead of for every paragraph at once, which removes the memory spike on very long pages. Full-page batches are looked up in the cache first, in rounds as wide as the model's request concurrency, so cached batches render without taking model slots, even behind pending requests. Cache reads share one IndexedDB connection and one transaction per batch, and in-text Markdown results and the language icon no longer retain reactive state per paragraph.
- After a service rate limits a regular or streaming request (HTTP 429), hold that model's queue for 2 seconds, then let one request through at a time until one succeeds. The rate-limited request itself still fails.
- Use a website rule's in-text translation model for the translation requests themselves; previously only its batch limits were applied.

- Translate visible margin notes marked `aria-hidden`, read-only article content, and text marked `data-nosnippet`; continue excluding actual editors, explicit hidden/no-translate regions, and visually hidden duplicates.
- Recheck newly visible content after visibility attributes, CSS animations/transitions, or viewport dimensions change, and keep hidden inline text out of translation inputs. Preserve paragraph boundaries during inline attribute rescans and track visible text coverage, and split pending ranges at hidden descendants (including empty containers), preserve source-backed formulas so newly revealed inline text is recovered without overlapping translations.
- Allow webpage adaptation to recover explanatory `aside` content and reject suggestions that discard it solely because it is an `aside`.
- Retain valid entries when a model suggestion contains an invalid selector, while requiring the full retained patch to pass extraction and content-preservation checks before saving.
- Avoid repeated suffix scans when redacting email candidates in long adaptation snapshots.
- Notify Sean Goedecke's existing margin-note layout when translated notes resize, preventing stale note positions after translation.
