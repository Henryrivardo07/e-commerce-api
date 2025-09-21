const jwt = require("jsonwebtoken");
const { errorResponse } = require("../utils/response");

function authenticateToken(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return errorResponse(res, "Unauthorized", 401);

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id }
    next();
  } catch {
    return errorResponse(res, "Invalid token", 401);
  }
}

module.exports = { authenticateToken };
