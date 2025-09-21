const { validationResult } = require("express-validator");
const { errorResponse } = require("../utils/response");

function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return errorResponse(
      res,
      errors
        .array()
        .map((e) => e.msg)
        .join(", "),
      400
    );
  }
  next();
}

module.exports = { handleValidationErrors };
