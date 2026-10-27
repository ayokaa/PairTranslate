// Content scripts inline dynamic imports, so defer KaTeX's initialization itself.
exports.loadKatex = () => require("katex");
