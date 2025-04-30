import {Router} from 'express';
import {Pool} from 'pg';
import {clogUpdateQueue, redisConnection} from "../queue";
import {Job} from "bullmq";

export interface Kc {
	kc: number;
}

export interface CollectionLogItem {
	accounthash: number;
	subcategoryid: number;
	itemid: number;
}
export const createClogRouter = (pool: Pool) => {
	const router = Router();

	// Get all items
	router.post('/update', async (req, res): Promise<any> => {
		const {username, accountHash, collectedIds, categories} = req.body;
		req.log.info({ accountHash, username }, 'Received clog update request');

		if (typeof accountHash !== 'number' || typeof collectedIds !== 'object' || !Array.isArray(categories)) {
			req.log.warn('Invalid request body structure for clog update');
			return res.status(400).json({error: 'Invalid request body structure. Missing or incorrect types for accountHash, collectedIds, or categories.'});
		}

		if (Object.keys(collectedIds).length === 0 || categories.length === 0) {
			req.log.warn('Received request with empty collectedIds or categories.');
			return res.status(400).json({error: 'collectedIds or categories cannot be empty.'});
		}

		const jobPayload = {
			username,
			accountHash,
			collectedIds,
			categories
		};

		try {
			// --- 3. Add Job to Queue ---
			const job: Job = await clogUpdateQueue.add('clog-update-job', jobPayload); // Job name + payload
			const generatedJobId = job.id;

			req.log.info({ generatedJobId, accountHash }, 'Clog update job added to queue');

			// --- 4. Respond Immediately ---
			return res.status(202).json({
				message: 'Update request received and queued for processing.',
				jobId: generatedJobId
			});

		} catch (queueError) {
			req.log.error(queueError, 'Failed to add clog update job to queue');
			return res.status(500).json({ error: 'Failed to queue update request.' });
		}
	});

	router.get('/get/:username/:subcategoryId', async (req, res): Promise<any> => {
		const username: string = decodeURIComponent(req.params.username);
		const subcategoryId: number = parseInt(req.params.subcategoryId, 10);
		const log = req.log;

		log.info({ username, subcategoryId }, 'Fetching collection log data request');

		if (!username || isNaN(subcategoryId)) {
			log.warn({ username, subcategoryId }, 'Invalid request parameters');
			res.status(400).send('Invalid username or subcategoryId');
			return;
		}

		// Check cache first
		const cacheKey = `clog:${username}:${subcategoryId}`;
		const cacheTTLSeconds = 30;
		// --- 1. Check Redis Cache First ---
		try {
			const cachedDataString = await redisConnection.get(cacheKey);
			if (cachedDataString) {
				log.debug({ cacheKey }, 'Redis cache hit');
				try {
					const cachedData = JSON.parse(cachedDataString);
					return res.json(cachedData); // Return cached data
				} catch (parseError) {
					log.error({parseError, cacheKey }, "Failed to parse cached data from Redis");
					// Proceed to fetch from DB if parsing fails
				}
			} else {
				log.debug({ cacheKey }, 'Redis cache miss');
			}
		} catch (redisError) {
			// Log Redis error but proceed to DB query as a fallback
			log.error({redisError, cacheKey }, 'Redis GET command failed, falling back to DB');
		}


		const client = await pool.connect();
		try {
			const [itemsResult, kcResult] = await Promise.all([
				client.query<CollectionLogItem>(
					'SELECT itemid FROM collection_logs cl JOIN players p ON cl.accountHash = p.accountHash WHERE p.username ilike $1 AND cl.subcategoryId = $2',
					[username, subcategoryId]
				),
				client.query<Kc>(
					'SELECT pkc.kc FROM player_kc pkc JOIN players p ON pkc.accountHash = p.accountHash WHERE p.username ilike $1 AND pkc.subcategoryId = $2',
					[username, subcategoryId]
				)
			]);

			if (itemsResult.rows.length === 0) {
				res.status(404).send('No items found for the given username and subcategoryId');
				return;
			}

			const kc = kcResult.rows.length > 0 ? kcResult.rows[0].kc : 0;
			const items = itemsResult.rows.map(row => row.itemid);

			const response = {
				kc: kc,
				items: items
			};

			try {
				const responseString = JSON.stringify(response);
				// Use 'EX' for TTL in seconds
				await redisConnection.set(cacheKey, responseString, 'EX', cacheTTLSeconds);
				log.debug({ cacheKey, ttl: cacheTTLSeconds }, 'Result stored in Redis cache');
			} catch (redisSetError) {
				// Log error but don't fail the request if caching fails
				log.error(
					{ err: redisSetError, cacheKey: cacheKey }, // Pino recognizes 'err'
					'Redis SET command failed' // Your descriptive message
				);
			}

			log.debug({ username, subcategoryId }, 'Data fetched and cached');
			res.json(response);
		} catch (err) {
			log.error(err, 'Error querying items');
			res.status(500).send('Server error');
		} finally {
			if (client) {
				client.release();
				log.debug('Database client released');
			}
		}
	});

	return router;
};
