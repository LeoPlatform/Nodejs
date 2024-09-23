
import { CronWrapper } from "../wrappers/cron";
import { enrich } from "../lib/stream/leo-stream";
import { Bot } from "../index";

const botHandler = async (event: any, context: any) => {
	const bot = new Bot();
	const stream = bot.createReadStream("sourceQueue");

	await new Promise((resolve, reject) => {
		stream
			.pipe(enrich({
				// Add your enrichment logic here
				transform: (payload, meta, done) => {
					// Example: Add a timestamp to each record
					payload.enrichedAt = new Date().toISOString();
					done(null, payload);
				}
			}))
			.pipe(bot.createWriteStream("destinationQueue"))
			.on("error", reject)
			.on("end", resolve);
	});

	console.log("Enrichment process completed");
};

export const handler = CronWrapper({
	name: "EnrichmentBot",
	time: "0 */5 * * * *", // Run every 5 minutes
}, botHandler);
