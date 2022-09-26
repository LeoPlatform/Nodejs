import { readdirSync, statSync, unlinkSync, Stats, mkdirSync } from "fs";
import path, { dirname } from "path";

const logger = require("leo-logger")("leo-s3-local-helper");

const BASE_DIR = "/tmp/rstream-sdk";

export function tryPurgeS3Files(
	start: string,
	maxStorage: number = (512 * 1024 * 1024) * 0.6,
	end: string = "",
	directory: string = BASE_DIR
) {

	try {
		verifyLocalDirectory(directory);
		let startTime = Date.now();
		let cachedFiles = getAllFiles(directory).sort((a, b) => a.mtimeMs - b.mtimeMs);

		let startEidTimestamp = parseInt(start.replace(/^z\/\d+\/\d+\/\d+\/\d+\/\d+\//g, "").split("-")[0]) || 0;
		let endEidTimestamp = parseInt(end.replace(/^z\/\d+\/\d+\/\d+\/\d+\/\d+\//g, "").split("-")[0]) || startEidTimestamp;

		let size = 0;
		let saved = 0;
		let purgeSize = 0;
		let deleted = 0;
		let toDelete = [];
		for (const file of cachedFiles) {
			let eidTimestamp = parseInt((file.filename.match(/^\d+-\d+/) || [])[0]);
			if (!eidTimestamp || eidTimestamp < startEidTimestamp || (eidTimestamp >= endEidTimestamp && size >= maxStorage)) {
				unlinkSync(file.fullpath);
				deleted++;
				purgeSize += file.size;
				logger.debug("Would delete:", file.fullpath, eidTimestamp, startEidTimestamp, endEidTimestamp, size, maxStorage, eidTimestamp < startEidTimestamp, eidTimestamp > endEidTimestamp && size > maxStorage);
				toDelete.push({
					path: file.fullpath,
					eidTimestamp,
					startEidTimestamp,
					fileSize: file.size,
					totalSize: size,
					maxStorage,
					noEid: !eidTimestamp,
					'eid<start': eidTimestamp < startEidTimestamp,
					'eid>end&noSpace': eidTimestamp > endEidTimestamp && size > maxStorage
				});
			} else {
				size += file.size;
				saved++;
			}
		}
		logger.debug(`Purged files: ${deleted} (${convertBytes(purgeSize)}), Remaining files: ${saved} (${convertBytes(size)}), duration: ${Date.now() - startTime}`);
		if (toDelete.length > 0) {
			logger.debug("Purge Summary:", JSON.stringify(toDelete, null, 2));
		}
	} catch (err) {
		logger.error("Error purging S3 files:", err);
	}
}

let verified = {};
export function verifyLocalDirectory(dir = BASE_DIR) {
	if (!verified[dir]) {
		mkdirSync(dir, { recursive: true });
		verified[dir] = true;
	}
}

export function clearVerifiedLocalDirectories() {
	verified = {};
}

export function buildLocalFilePath(file: S3File, eid = ""): string {
	let bucket = file.bucket || file.Bucket;
	let key = file.key || file.Key;

	let ext = key.split(".").pop();
	let extReplace = new RegExp(`\\.${ext}$`);
	if (file.uncompressed) {
		ext = "jsonl";
	}
	let eidPart = eid.replace(/^z\/\d+\/\d+\/\d+\/\d+\/\d+\//g, "");
	let localFilename = path.resolve(`${BASE_DIR}/${bucket}/${eidPart}_${key.replace(/[/\\]/g, "_").replace(extReplace, "")}_${file.range}.${ext || "gz"}`);
	verifyLocalDirectory(dirname(localFilename));
	return localFilename;
}

interface S3File {
	Bucket?: string;
	Key?: string;

	bucket?: string;
	key?: string;

	range: string;

	uncompressed?: boolean
}


interface StatsPlus extends Stats {
	filename: string;
	fullpath: string
}

export function convertBytes(bytes) {
	const sizes = ["Bytes", "KB", "MB", "GB", "TB"];

	if (bytes == 0) {
		return "n/a";
	}

	const i = parseInt((Math.floor(Math.log(bytes) / Math.log(1024))) as any);

	if (i == 0) {
		return bytes + " " + sizes[i];
	}

	return (bytes / Math.pow(1024, i)).toFixed(1) + " " + sizes[i];
}

function getAllFiles(dirPath: string, arrayOfFiles?: StatsPlus[]) {
	let files = readdirSync(dirPath);

	arrayOfFiles = arrayOfFiles || [];

	files.forEach(function (file) {
		let stat = statSync(dirPath + "/" + file) as StatsPlus;
		if (stat.isDirectory()) {
			arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
		} else {
			stat.filename = file;
			stat.fullpath = path.resolve(dirPath, file);
			arrayOfFiles.push(stat);
		}
	});

	return arrayOfFiles;
}
