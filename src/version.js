// The library's version, as a literal.
//
// It has to be a literal: `src/` is loaded directly by browsers as ES modules, so it cannot read
// `package.json` at run time, and the browser bundle is plain concatenation with nothing to
// substitute. The copy in `package.json` is what npm publishes, so there are necessarily two, and
// `dev/check-bundle.mjs` fails the build if they ever disagree.
export const VERSION = "0.1.1";
