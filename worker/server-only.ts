/**
 * The app's server modules are marked "server-only" so a browser bundle
 * can never include them. The worker is a server too: this lets them load
 * here. It has to be the worker's first import.
 */
const id = require.resolve("server-only");
require.cache[id] = { id, filename: id, loaded: true, exports: {} } as NodeJS.Module;
