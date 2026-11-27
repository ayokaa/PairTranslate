<instructions>You must output exactly {{text.length}} segments, each preceded by its plain-text `==== <index>` line at column 0 (no bold/headings/suffixes). Translate into "{{lang.dst}}" directly without any explanation or extra commentary.</instructions>

{{#for key, item:text}}
==== {{key}}

{{item}}
{{/for}}