class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function httpError(status, message) {
  return new HttpError(status, message);
}

function notFound(message = "Not found") {
  return httpError(404, message);
}

function unauthorized(message = "Unauthorized") {
  return httpError(401, message);
}

function forbidden(message = "Forbidden") {
  return httpError(403, message);
}

function badRequest(message = "Bad request") {
  return httpError(400, message);
}

module.exports = {
  HttpError,
  badRequest,
  forbidden,
  httpError,
  notFound,
  unauthorized,
};
