import { tryPurgeS3Files, verifyLocalDirectory, buildLocalFilePath, convertBytes, clearVerifiedLocalDirectories } from "../lib/stream/s3_local_file_helper";
import fs, { Stats } from "fs";
import path from "path";
import sinon from "sinon";
import chai, { expect, assert } from "chai";
import sinonchai from "sinon-chai";
chai.use(sinonchai);

describe('lib.stream.s3_local_file_helper', function () {
	let sandbox: sinon.SinonSandbox;
	beforeEach(() => {
		clearVerifiedLocalDirectories();
		sandbox = sinon.createSandbox();
	});
	afterEach(() => {
		sandbox.restore();
	});
	after(() => {
		clearVerifiedLocalDirectories();
	});

	describe('tryPurgeS3Files', function () {

		it('default', async function () {
			sandbox.stub(fs, 'mkdirSync').callsFake(() => undefined);
			sandbox.stub(fs, "readdirSync")
				.onFirstCall().callsFake(() => [
					"file1.gz",
					"file2.gz",
					"myDir"
				] as any)
				.onSecondCall().callsFake(() => [
					"file3.gz"
				] as any);
			let stats: Record<string, Stats> = {
				"./someDir/file1.gz": buildStats({ isDir: false, mtime: new Date("2022-09-07T00:47:00Z") }),
				"./someDir/file2.gz": buildStats({ isDir: false, mtime: new Date("2022-09-07T00:47:00Z") }),
				"./someDir/myDir": buildStats({ isDir: true, mtime: new Date("2022-09-07T00:47:00Z") }),
				"./someDir/myDir/file3.gz": buildStats({ isDir: false, mtime: new Date("2022-09-07T00:47:00Z") }),
			};
			sandbox.stub(fs, "statSync").callsFake((file) => stats[file.toString()]);

			sandbox.stub(path, "resolve").callsFake((...args) => args.join("/"));
			let deleted = [];
			sandbox.stub(fs, "unlinkSync").callsFake((file) => deleted.push(file));

			tryPurgeS3Files("z/2022/09/07/00/47/1662511674511-0000160", undefined, undefined, "./someDir");

			assert.deepEqual(deleted, [
				"./someDir/file1.gz",
				"./someDir/file2.gz",
				"./someDir/myDir/file3.gz"
			]);

		});

		it('remove prev files', async function () {
			sandbox.stub(fs, 'mkdirSync').callsFake(() => undefined);
			sandbox.stub(fs, "readdirSync")
				.onFirstCall().callsFake(() => [
					"1662511674510-0000001_file1.gz",
					"1662511674511-0000002_file2.gz",
					"1662511674511-0000161_file3.gz"
				] as any);
			let stats: Record<string, Stats> = {
				"./someDir/1662511674510-0000001_file1.gz": buildStats({ mtime: new Date("2022-09-07T00:47:00Z") }),
				"./someDir/1662511674511-0000002_file2.gz": buildStats({ mtime: new Date("2022-09-07T00:47:00Z") }),
				"./someDir/1662511674511-0000161_file3.gz": buildStats({ mtime: new Date("2022-09-07T00:47:00Z") }),
			};
			sandbox.stub(fs, "statSync").callsFake((file) => stats[file.toString()]);
			sandbox.stub(path, "resolve").callsFake((...args) => args.join("/"));

			let deleted = [];
			sandbox.stub(fs, "unlinkSync").callsFake((file) => deleted.push(file));

			tryPurgeS3Files("z/2022/09/07/00/47/1662511674511-0000160", undefined, undefined, "./someDir");

			assert.deepEqual(deleted, [
				"./someDir/1662511674510-0000001_file1.gz",
			]);

		});


		it('remove size too big', async function () {
			sandbox.stub(fs, 'mkdirSync').callsFake(() => undefined);
			sandbox.stub(fs, "readdirSync")
				.onFirstCall().callsFake(() => [
					"1662511674511-0000001_file1.gz",
					"1662511674511-0000002_file2.gz",
					"1662511674513-0000161_file3.gz"
				] as any);
			let stats: Record<string, Stats> = {
				"./someDir/1662511674511-0000001_file1.gz": buildStats({ size: 1000, mtime: new Date("2022-09-07T00:47:00Z"), }),
				"./someDir/1662511674511-0000002_file2.gz": buildStats({ size: 1000, mtime: new Date("2022-09-07T00:47:00Z") }),
				"./someDir/1662511674513-0000161_file3.gz": buildStats({ size: 1000, mtime: new Date("2022-09-07T00:47:00Z") }),
			};
			sandbox.stub(fs, "statSync").callsFake((file) => stats[file.toString()]);
			sandbox.stub(path, "resolve").callsFake((...args) => args.join("/"));

			let deleted = [];
			sandbox.stub(fs, "unlinkSync").callsFake((file) => deleted.push(file));

			tryPurgeS3Files("z/2022/09/07/00/47/1662511674511-0000160", 1001, undefined, "./someDir");

			assert.deepEqual(deleted, [
				"./someDir/1662511674513-0000161_file3.gz",
			]);

		});

		it('remove size too big 2', async function () {
			sandbox.stub(fs, 'mkdirSync').callsFake(() => undefined);
			sandbox.stub(fs, "readdirSync")
				.onFirstCall().callsFake(() => [
					"1662511674511-0000001_file1.gz",
					"1662511674511-0000002_file2.gz",
					"1662511674513-0000161_file3.gz"
				] as any);
			let stats: Record<string, Stats> = {
				"./someDir/1662511674511-0000001_file1.gz": buildStats({ size: 1000, mtime: new Date("2022-09-07T00:47:00Z"), }),
				"./someDir/1662511674511-0000002_file2.gz": buildStats({ size: 1000, mtime: new Date("2022-09-07T00:47:00Z") }),
				"./someDir/1662511674513-0000161_file3.gz": buildStats({ size: 1000, mtime: new Date("2022-09-07T00:47:00Z") }),
			};
			sandbox.stub(fs, "statSync").callsFake((file) => stats[file.toString()]);
			sandbox.stub(path, "resolve").callsFake((...args) => args.join("/"));

			let deleted = [];
			sandbox.stub(fs, "unlinkSync").callsFake((file) => deleted.push(file));

			tryPurgeS3Files("z/2022/09/07/00/47/1662511674511-0000160", 1000, undefined, "./someDir");

			assert.deepEqual(deleted, [
				"./someDir/1662511674511-0000002_file2.gz",
				"./someDir/1662511674513-0000161_file3.gz",
			]);

		});

		it('remove error', async function () {
			sandbox.stub(fs, 'mkdirSync').callsFake(() => undefined);
			sandbox.stub(fs, "readdirSync")
				.onFirstCall().callsFake(() => [
					"1662511674511-0000001_file1.gz",
					"1662511674511-0000002_file2.gz",
					"1662511674513-0000161_file3.gz"
				] as any);
			let stats: Record<string, Stats> = {
				"./someDir/1662511674511-0000001_file1.gz": buildStats({ size: 1000, mtime: new Date("2022-09-07T00:47:00Z"), }),
				"./someDir/1662511674511-0000002_file2.gz": buildStats({ size: 1000, mtime: new Date("2022-09-07T00:47:00Z") }),
				"./someDir/1662511674513-0000161_file3.gz": buildStats({ size: 1000, mtime: new Date("2022-09-07T00:47:00Z") }),
			};
			sandbox.stub(fs, "statSync").callsFake((file) => stats[file.toString()]);
			sandbox.stub(path, "resolve").callsFake((...args) => args.join("/"));

			sandbox.stub(fs, "unlinkSync").throws(new Error("bad stuff"));

			tryPurgeS3Files("z/2022/09/07/00/47/1662511674511-0000160", 1000, undefined, "./someDir");

		});
	});

	describe('buildLocalFilePath', function () {

		it('default', async function () {
			sandbox.stub(fs, 'mkdirSync').callsFake(() => undefined);
			sandbox.stub(path, "resolve").callsFake((...args) => args.join("/"));

			let path1 = buildLocalFilePath({
				bucket: "my-bucket",
				key: "key/goes/here/suff1.gz",
				range: "0-1000",
				uncompressed: false
			}, "z/2022/09/07/00/47/1662511674511-0000001");

			let path2 = buildLocalFilePath({
				Bucket: "my-bucket",
				Key: "key/goes/here/suff2.gz",
				range: "0-1001",
				uncompressed: false
			}, "z/2022/09/07/00/47/1662511674512-0000002");


			let path3 = buildLocalFilePath({
				Bucket: "my-bucket",
				Key: "key/goes/here/suff2.gz",
				range: "0-1002",
				uncompressed: true
			}, "z/2022/09/07/00/47/1662511674513-0000003");

			assert.equal(path1, "/tmp/rstreams-sdk/my-bucket/1662511674511-0000001_key_goes_here_suff1_0-1000.gz");
			assert.equal(path2, "/tmp/rstreams-sdk/my-bucket/1662511674512-0000002_key_goes_here_suff2_0-1001.gz");
			assert.equal(path3, "/tmp/rstreams-sdk/my-bucket/1662511674513-0000003_key_goes_here_suff2_0-1002.jsonl");

		});

	});
});

interface SimpleStat {
	atime?: Date;
	mtime?: Date;
	ctime?: Date;
	birthtime?: Date;
	isDir?: boolean;
	size?: number;
}
function buildStats(opts: SimpleStat): Stats {
	let time = opts.atime || opts.mtime || opts.ctime || opts.birthtime || new Date();
	let atime = opts.atime || time;
	let mtime = opts.mtime || time;
	let ctime = opts.ctime || time;
	let birthtime = opts.birthtime || time;

	return {
		isFile: () => !opts.isDir,
		isDirectory: () => !!opts.isDir,
		isBlockDevice: () => false,
		isCharacterDevice: () => false,
		isSymbolicLink: () => false,
		isFIFO: () => false,
		isSocket: () => false,
		dev: 0,
		ino: 0,
		mode: 0,
		nlink: 0,
		uid: 0,
		gid: 0,
		rdev: 0,
		size: opts.size || 0,
		blksize: 0,
		blocks: 0,
		atimeMs: atime.valueOf(),
		mtimeMs: mtime.valueOf(),
		ctimeMs: ctime.valueOf(),
		birthtimeMs: birthtime.valueOf(),
		atime: atime,
		mtime: mtime,
		ctime: ctime,
		birthtime: birthtime,
	};
}
