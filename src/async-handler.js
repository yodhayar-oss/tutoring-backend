// Express 4 doesn't automatically catch rejected promises from async route
// handlers/middleware — without this, a thrown error inside an `async`
// handler would just hang the request instead of returning an error.
// Wrap every async handler/middleware with this before passing it to a router.
module.exports = function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
