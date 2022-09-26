import * as crypto from "crypto";
import bigInt = require("big-integer");
import { Ref } from "./reference";
import { RStreamsSdk } from "../index";

export interface ShardDef {
	//index: string;
	shard_id: string;
	explicit_hash_key: string;
	explicit_hash_end_key: string,
	start: bigInt.BigInteger,
	end: bigInt.BigInteger
}

/**
 * Is this right?
 * Do i need this still?
 * Can this data come from the queue?
 */
interface WriteEventShard {
	event: string;
	explicit_hash_key?: string;
	partition_key?: string;
}

interface ShardDataCache {
	data: ShardDef[];
	last_polled: number;
	no_poll?: boolean;
}

interface ShardDdbData {
	value: {
		data: AWS.Kinesis.ShardList,
		last_polled: number;
	}
}

export class ShardManager {
	static kinesisShardsDataSettingId = "sdk.kinesis_shards";
	static kinesisShardDataCacheDuration = 1000 * 60 * 60 + Math.floor(Math.random() * 300); // Random offset for noise
	static kinesisShardsDataCache: ShardDataCache = {
		data: [],
		last_polled: 0,
		no_poll: false
	};

	kinesisShards: ShardDef[];
	kinesisShardCount: {
		[key: string]: number;
	};

	calculatedHashes: {
		[key: string]: string
	} = {};


	constructor(private sdk: RStreamsSdk) {
		this.kinesisShardCount = { total: 0 };
	}

	setDeliveryShards(shards: ShardDef[]) {
		this.kinesisShards = shards;
		ShardManager.kinesisShardsDataCache = {
			data: shards,
			last_polled: Date.now(),
			no_poll: true
		};
	}

	convertStreamShards(shards: AWS.Kinesis.ShardList): ShardDef[] {
		return shards
			.filter(s => s.SequenceNumberRange.EndingSequenceNumber == null)
			.map((s, index) => {
				this.kinesisShardCount[index] = 0;
				return {
					//index: index.toString(),
					shard_id: s.ShardId,
					explicit_hash_key: s.HashKeyRange.StartingHashKey,
					explicit_hash_end_key: s.HashKeyRange.EndingHashKey,
					start: bigInt(s.HashKeyRange.StartingHashKey, 10),
					end: bigInt(s.HashKeyRange.EndingHashKey, 10)
				};
			});
	}

	async populateShards() {

		this.kinesisShardCount = { total: 0 };
		this.calculatedHashes = {};

		// Check if global local cache has expired
		if (!ShardManager.kinesisShardsDataCache.no_poll && ShardManager.kinesisShardsDataCache.last_polled <= Date.now() - ShardManager.kinesisShardDataCacheDuration) {
			// Get from dynamodb
			let kinesisShardsDataDB = (await this.sdk.aws.dynamodb.getSettingPromise<ShardDdbData>(ShardManager.kinesisShardsDataSettingId) || { value: { data: [], last_polled: 0 } }).value;
			ShardManager.kinesisShardsDataCache = {
				data: kinesisShardsDataDB.data.length > 0 ? this.convertStreamShards(kinesisShardsDataDB.data) : ShardManager.kinesisShardsDataCache.data,
				last_polled: kinesisShardsDataDB.last_polled
			};

			//Check if dynamodb cache has expired
			if (ShardManager.kinesisShardsDataCache.last_polled <= Date.now() - ShardManager.kinesisShardDataCacheDuration) {
				// Get from stream
				let configure = this.sdk.configuration;
				let AWS = require("aws-sdk");
				let kinesis = new AWS.Kinesis({
					region: configure.aws.region,
					credentials: configure.credentials
				});

				try {
					// Can be called 1000 times per second.Accross the account
					let data = await kinesis.listShards({
						StreamName: configure.resources.LeoKinesisStream
					}).promise();

					ShardManager.kinesisShardsDataCache = {
						data: this.convertStreamShards(data.Shards),
						last_polled: Date.now()
					};
					await this.sdk.aws.dynamodb.setSettingPromise(ShardManager.kinesisShardsDataSettingId, {
						data: data.Shards,
						last_polled: Date.now()
					});
				} catch (err) {
					// Got an error trying to fetch the kinesis shard data so cache the results 
					// and try again after the the cache expires
					console.error("Error Populating Kinesis Shard Data. Using existing cache.", err);
				}
			}
		}

		this.kinesisShards = ShardManager.kinesisShardsDataCache.data;
	}

	getKinesisShardData(event: WriteEventShard) {
		return this.getShardData(event, this.kinesisShards, this.kinesisShardCount);
	}

	getShardData(event: WriteEventShard, shardSet?: ShardDef[], shardCount?) {

		shardSet = shardSet || this.kinesisShards;
		shardCount = shardCount || this.kinesisShardCount;

		let queueName = new Ref(event.event).toString();

		let key = event.partition_key ? `${queueName}/${event.partition_key}` : queueName;
		let shard_data = {
			shard_id: undefined,
			partition_key: undefined,
			explicit_hash_key: undefined,
			group: undefined,
		};
		let shard: ShardDef = null;
		if (event.explicit_hash_key) {
			shard_data.explicit_hash_key = event.explicit_hash_key;

			// TODO: is it a good idea to use partition key if just using queue?
			//} else if (event.partition_key == null || shardSet.length <= 1) {
			//	shard_data.partition_key = queueName;
		} else {
			let value;
			// TODO: determine how this cache gets cleared so it doesn't grow forever
			if (key in this.calculatedHashes) {
				value = this.calculatedHashes[key];
			} else {
				value = bigInt(crypto.createHash("md5").update(key).digest("hex"), 16);
				this.calculatedHashes[key] = value;
			}
			shard = shardSet.find(s => s.start <= value && s.end >= value) || shardSet[0];
			shard_data.explicit_hash_key = shard.explicit_hash_key || "0";
		}

		shard_data.group = shard_data.explicit_hash_key || shard_data.partition_key;
		if (shard == null && shard_data.explicit_hash_key) {
			shard = shardSet.find(s => s.start <= shard_data.explicit_hash_key && s.end >= shard_data.explicit_hash_key) || shardSet[0];
		}
		if (shard == null) {
			shard = {
				//index: shard_data.group,
				shard_id: shard_data.group,
				explicit_hash_key: "",
				explicit_hash_end_key: "",
				start: bigInt.zero,
				end: bigInt.zero
			};
		}

		shardCount[shard.shard_id] = (shardCount[shard.shard_id] || 0) + 1;
		shardCount.total = (shardCount.total || 0) + 1;

		console.log(key, shard_data.explicit_hash_key, shard.shard_id, JSON.stringify(shardCount));
		shard_data.shard_id = shard.shard_id;
		return shard_data;

		////////////////////////////
		// if (this.kinesis_shards.length == 1) {
		// 	return "0"
		// }
		// let value = bigInt(crypto.createHash("md5").update(key).digest("hex"), 16);
		// let shard = this.kinesis_shards.find(s => s.start <= value && s.end >= value) || {};
		// this.shardCount[shard.index || 0]++;
		// this.shardCount.total++;
		// console.log(key, value.toString(), shard.index || 0, shard.shard_id || "shardId-000000000000", JSON.stringify(this.shardCount));
		// return shard.explicit_hash_key || "0";
	}
}
