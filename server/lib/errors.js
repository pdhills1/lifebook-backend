class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
const bad = (m, extra) => new HttpError(400, m, extra);
const unauthorized = (m = 'Please sign in again.') => new HttpError(401, m);
const forbidden = (m = 'You do not have access to that.') => new HttpError(403, m);
const notFound = (m = 'Not found.') => new HttpError(404, m);
const conflict = (m, extra) => new HttpError(409, m, extra);
const invalid = (m, extra) => new HttpError(422, m, extra);

module.exports = { HttpError, bad, unauthorized, forbidden, notFound, conflict, invalid };
