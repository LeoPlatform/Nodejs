import { gzipSync } from "zlib";

module.exports = gzipSync(JSON.stringify({
	/* EMPTY - Will be populated by post processing for webpack usage */
})).toString("base64");
