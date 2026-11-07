# CommonJS decoder compatibility adapter

Expo Router 57 uses query-string 7.1.3, which calls the result of
`require('decode-uri-component')` directly. Its decoder 0.2.2 is affected by
[GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr).
The patched [upstream 0.5.0 release](https://github.com/SamVerschueren/decode-uri-component/tree/v0.5.0)
is ESM-only, so directly overriding that version would return a module namespace
instead of the function expected by the existing consumer.

This package adapts only the export shape. It depends on the exact, unmodified
upstream decoder via an npm alias, then exports its default function as CommonJS.
It does not copy, alter, or maintain decoding code. The override is scoped to
query-string 7.1.3, not every consumer in the dependency tree. A direct file
dependency supplies the stable root location, and the scoped override refers to
that dependency with `$decode-uri-component`; do not replace the reference with
a consumer-relative `file:` path.

Node tooling must use Node 22.13.0 or later, matching the minimum required by
[Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/), for synchronous
`require()` of this ESM dependency. Metro handles the same dependency in native
bundles. Compatibility, deep-link parsing, and malformed-input termination are
covered in `tests/dependency-compat.test.cjs`; both native exports must also pass.

Remove this adapter and override when upgrading to an Expo Router release that
uses a patched decoder with a compatible import directly. Do not replace the
upstream package with a fabricated version to suppress an audit finding.
