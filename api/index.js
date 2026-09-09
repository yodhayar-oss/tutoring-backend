// Vercel serverless entry point.
//
// `vercel.json` rewrites every request that doesn't match a static file in
// public/ to this function, and the Express app in ../server.js does the
// routing from there — so the same app serves both `npm start` locally and
// production on Vercel, with no second copy of the route table.
//
// The app opens its database connection lazily on the first request each
// instance handles (see ensureReady in ../server.js), which is what a
// serverless runtime needs: there is no process-wide startup hook to hang it on.
module.exports = require('../server');
