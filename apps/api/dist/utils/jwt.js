"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateAccessToken = generateAccessToken;
exports.generateRefreshToken = generateRefreshToken;
exports.verifyAccessToken = verifyAccessToken;
exports.verifyRefreshToken = verifyRefreshToken;
exports.generateTokenPair = generateTokenPair;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
if (!process.env.JWT_SECRET)
    throw new Error('JWT_SECRET environment variable is required');
if (!process.env.JWT_REFRESH_SECRET)
    throw new Error('JWT_REFRESH_SECRET environment variable is required');
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
function generateAccessToken(payload) {
    return jsonwebtoken_1.default.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}
function generateRefreshToken(payload) {
    return jsonwebtoken_1.default.sign(payload, JWT_REFRESH_SECRET, { expiresIn: JWT_REFRESH_EXPIRES_IN });
}
function verifyAccessToken(token) {
    return jsonwebtoken_1.default.verify(token, JWT_SECRET);
}
function verifyRefreshToken(token) {
    return jsonwebtoken_1.default.verify(token, JWT_REFRESH_SECRET);
}
function generateTokenPair(payload) {
    return {
        accessToken: generateAccessToken(payload),
        refreshToken: generateRefreshToken(payload),
    };
}
//# sourceMappingURL=jwt.js.map