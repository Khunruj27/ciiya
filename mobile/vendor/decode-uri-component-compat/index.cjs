// query-string 7 expects require('decode-uri-component') to return a function.
// Keep the security-fixed upstream decoder unchanged, adapting only its export.
module.exports = require('decode-uri-component-patched').default;
