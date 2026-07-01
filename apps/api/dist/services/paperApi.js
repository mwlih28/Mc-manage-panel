"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchPaperVersions = fetchPaperVersions;
exports.fetchPaperBuilds = fetchPaperBuilds;
const axios_1 = __importDefault(require("axios"));
// PaperMC's old api.papermc.io/v2 was sunset (HTTP 410). The new API lives at
// fill.papermc.io/v3, has a different response shape, and requires a real,
// identifying User-Agent header.
const PAPER_API_BASE = 'https://fill.papermc.io/v3/projects/paper';
const PAPER_USER_AGENT = 'Kretase/1.0 (+https://kretase.com)';
async function fetchPaperVersions() {
    const { data } = await axios_1.default.get(PAPER_API_BASE, { timeout: 10000, headers: { 'User-Agent': PAPER_USER_AGENT } });
    return Object.values(data.versions).flat();
}
async function fetchPaperBuilds(version) {
    const { data } = await axios_1.default.get(`${PAPER_API_BASE}/versions/${version}/builds`, {
        timeout: 10000, headers: { 'User-Agent': PAPER_USER_AGENT },
    });
    return data.map((b) => b.id);
}
//# sourceMappingURL=paperApi.js.map