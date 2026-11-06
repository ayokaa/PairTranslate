# Changelog

## Unreleased

- Translate visible margin notes marked `aria-hidden`, read-only article content, and text marked `data-nosnippet`; continue excluding actual editors, explicit hidden/no-translate regions, and visually hidden duplicates.
- Recheck newly visible content after visibility attributes, CSS animations/transitions, or viewport dimensions change, and keep hidden inline text out of translation inputs. Preserve paragraph boundaries during inline attribute rescans and track visible text coverage so newly revealed inline text is recovered without overlapping translations.
- Allow webpage adaptation to recover explanatory `aside` content and reject suggestions that discard it solely because it is an `aside`.
- Retain valid entries when a model suggestion contains an invalid selector, while requiring the full retained patch to pass extraction and content-preservation checks before saving.
