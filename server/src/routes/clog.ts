import {Router, Request, Response, RequestHandler} from 'express';
import {Pool} from 'pg';
import {clogUpdateQueue, redisConnection} from "../queue";
import {Job} from "bullmq";
import {UserCollectionData} from "../models/UpdateCollectionLogRequest";
import {getSubcategoryAlias} from "../utils/alias";
import {StaticDataRequest} from "../models/UpdateCollectionLogStaticDataRequest";
export interface Kc {
	kc: number;
}

export interface CollectionLogItem {
	quantity: number;
	itemid: number;
	kc: number | null;
	name: string;
}

export const createClogRouter = (pool: Pool) => {
	const router = Router();

	const SECRET_KEY = process.env.ENDPOINT_SECRET_KEY;

	// Get all items
	router.post('/update', async (req, res): Promise<any> => {
		const {username, accountHash, collectedItems, subcategories}: UserCollectionData = req.body;
		req.log.info({accountHash, username}, 'Received clog update request');

		if (typeof collectedItems !== 'object' || collectedItems === null) {
			req.log.warn('Invalid request body structure or types for clog update');
			return res.status(400).json({error: 'Invalid request body. Ensure username (string), accountHash (number), collectedIds (object), and categories (array) are provided with correct types.'});
		}

		if (Object.keys(collectedItems).length === 0) {
			req.log.warn('Received request with empty collectedIds or categories.');
			return res.status(400).json({error: 'collectedIds or categories cannot be empty.'});
		}

		const jobPayload: UserCollectionData = {
			username,
			accountHash,
			collectedItems,
			subcategories
		};
		req.log.info({jobPayload}, 'Clog update job payload');

		try {
			// --- 3. Add Job to Queue ---
			const job: Job<UserCollectionData> = await clogUpdateQueue.add('clog-update-job', jobPayload); // Job name + payload
			const generatedJobId = job.id;

			req.log.info({generatedJobId, accountHash}, 'Clog update job added to queue');

			// --- 4. Respond Immediately ---
			return res.status(202).json({
				message: 'Update request received and queued for processing.',
				jobId: generatedJobId
			});

		} catch (queueError) {
			req.log.error(queueError, 'Failed to add clog update job to queue');
			return res.status(500).json({error: 'Failed to queue update request.'});
		}
	});

	router.get('/get/:username/:subcategoryName', async (req, res): Promise<any> => {
		const username: string = decodeURIComponent(req.params.username);
		const subcategoryName: string = req.params.subcategoryName;
		const subcategoryAliased: string = getSubcategoryAlias(subcategoryName);
		const log = req.log;

		log.info({username, subcategoryName}, 'Fetching collection log data request');

		if (!username || !subcategoryAliased) {
			log.warn({username, subcategoryAliased}, 'Invalid request parameters');
			res.status(400).send('Invalid username or subcategoryId');
			return;
		}

		// Check cache first
		const cacheKey = `clog:${username}:${subcategoryAliased}`;
		const cacheTTLSeconds = 10;
		// --- 1. Check Redis Cache First ---
		try {
			const cachedDataString = await redisConnection.get(cacheKey);
			if (cachedDataString) {
				log.debug({cacheKey}, 'Redis cache hit');
				try {
					const cachedData = JSON.parse(cachedDataString);
					return res.json(cachedData); // Return cached data
				} catch (parseError) {
					log.error({parseError, cacheKey}, "Failed to parse cached data from Redis");
					// Proceed to fetch from DB if parsing fails
				}
			} else {
				log.debug({cacheKey}, 'Redis cache miss');
			}
		} catch (redisError) {
			// Log Redis error but proceed to DB query as a fallback
			log.error({redisError, cacheKey}, 'Redis GET command failed, falling back to DB');
		}

		const client = await pool.connect();

		try {
			const result = await client.query<CollectionLogItem>(
				`SELECT 
								     pi.itemid, 
								     pi.quantity, 
								     pkc.kc,
								     s.name
								   FROM player_items pi
								   JOIN subcategories s ON s.name = $2
								   JOIN players p ON pi.accountHash = p.accountHash
								   JOIN subcategory_items sci ON sci.subcategoryid = s.id AND sci.itemid = pi.itemid
                                   LEFT JOIN player_kc pkc ON pkc.accountHash = p.accountHash AND pkc.subcategoryId = s.id AND pkc.kc != -1
								   WHERE p.username ILIKE $1`,
				[username, subcategoryAliased]
			);

			const items = result.rows.map(row => ({
				itemId: row.itemid,
				quantity: row.quantity,
			}));

			const kc = result.rows.length > 0 ? result.rows[0].kc || 0 : 0;
			const subcategoryName = result.rows.length > 0 ? result.rows[0].name : null;
			if (!subcategoryName) {
				log.warn({username, subcategoryName}, 'No data found for the given username and subcategory');
				res.status(404).send('No data found');
				return;
			}

			const response = {
				kc,
				subcategoryName,
				items,
			};

			try {
				const responseString = JSON.stringify(response);
				// Use 'EX' for TTL in seconds
				await redisConnection.set(cacheKey, responseString, 'EX', cacheTTLSeconds);
				log.debug({cacheKey, ttl: cacheTTLSeconds}, 'Result stored in Redis cache');
			} catch (redisSetError) {
				// Log error but don't fail the request if caching fails
				log.error(
					{err: redisSetError, cacheKey: cacheKey}, // Pino recognizes 'err'
					'Redis SET command failed' // Your descriptive message
				);
			}

			log.debug({username, subcategoryName, subcategoryAliased}, 'Data fetched and cached');
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

	const authenticateApiKey: RequestHandler = (req, res, next) => {
		const providedKey = req.headers['x-api-key'] as string | undefined;

		if (!SECRET_KEY) {
			req.log.error("Authentication check skipped: ENDPOINT_SECRET_KEY is not configured on the server.");
			res.status(500).json({ error: "Server configuration error." });
			return;
		}

		if (!providedKey) {
			req.log.warn("Access denied: Missing X-API-Key header.");
			res.status(401).json({ error: "Unauthorized: Missing API Key." });
			return;
		}

		if (providedKey === SECRET_KEY) {
			req.log.info("API Key authenticated successfully.");
			return next(); // This is already void-returning
		} else {
			req.log.warn("Access denied: Invalid API Key provided.");
			res.status(403).json({ error: "Forbidden: Invalid API Key." });
			return;
		}
	};

	router.post('/data', authenticateApiKey, async (req: Request, res: Response) => {
		// If the code reaches here, authenticateApiKey called next(), meaning the key was valid.
		const data = req.body as StaticDataRequest;

		// --- Data Validation (Basic Example) ---
		if (!data || !Array.isArray(data.subcategories) || !Array.isArray(data.categories) || data.categories === null) {
			req.log.error('Invalid data format received post-authentication.');
			// Note: Authentication succeeded, but the body is wrong.
			res.status(400).json({ error: 'Invalid data format...' });
			return;
		}

		// --- Process the Data ---
		req.log.info(`Processing authenticated request. Received ${data.subcategories.length} subcategories.`);
		req.log.info(`Received ${Object.keys(data.categories).length} categories.`);

		const client = await pool.connect();

		try {
			await client.query('BEGIN'); // Start transaction
			req.log.debug('Transaction started.');

			req.log.info('Inserting categories...');
			for (const category of data.categories) {
				const categoryId = category.id;
				const categoryName = category.name;

				const insertCategoryQuery = `
						INSERT INTO categories (id, name)
						VALUES ($1, $2)
						ON CONFLICT DO NOTHING;
					`;
				await client.query(insertCategoryQuery, [categoryId, categoryName]);
			}
			await client.query('COMMIT'); // Commit transaction

			for (const subcategory of data.subcategories) {
				req.log.info(`Inserting subcategory ${subcategory.name}...`);
				const insertSubcategoryQuery = `
					INSERT INTO subcategories (id, name, categoryId)
					VALUES ($1, $2, $3)
					ON CONFLICT DO NOTHING;
				`;
				await client.query(insertSubcategoryQuery, [
					subcategory.id,
					subcategory.name,
					subcategory.categoryId,
				]);
				await client.query('COMMIT');

				for (const item in subcategory.items) {
					const itemId = subcategory.items[item];
					const insertItemQuery = `
						INSERT INTO subcategory_items (subcategoryid, itemid)
						VALUES ($1, $2)
						ON CONFLICT DO NOTHING;
					`;
					await client.query(insertItemQuery, [subcategory.id, itemId]);
				}
			}
			await client.query('COMMIT'); // Commit transaction

		} catch (err) {
			req.log.error(err, 'Error processing data');
			res.status(500).json({ error: 'Server error' });
			return;
		} finally {
			client.release();
			req.log.debug('Database client released');
		}

		// --- Send Response ---
		res.status(200).json({
			message: 'Data received and processed successfully!',
			receivedSubcategories: data.subcategories.length,
			receivedCategories: Object.keys(data.categories).length,
		});
	});

	return router;
};
