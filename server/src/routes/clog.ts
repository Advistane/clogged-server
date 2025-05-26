import {Request, RequestHandler, Response, Router} from 'express';
import {Pool} from 'pg';
import {clogUpdateQueue, redisConnection} from "../queue";
import {Job} from "bullmq";
import {UserCollectionData} from "../models/UpdateCollectionLogRequest";
import {getKCLookupAliases, getSubcategoryAlias} from "../utils/alias";
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

interface CollectionLogItemOutput {
	itemId: number;
	quantity: number;
}

export const createClogRouter = (pool: Pool) => {
	const router = Router();

	const SECRET_KEY = process.env.ENDPOINT_SECRET_KEY;

	const authenticateApiKey: RequestHandler = (req, res, next) => {
		const providedKey = req.headers['x-api-key'] as string | undefined;

		if (!SECRET_KEY) {
			req.log.error("Authentication check skipped: ENDPOINT_SECRET_KEY is not configured on the server.");
			res.status(500).json({error: "Server configuration error."});
			return;
		}

		if (!providedKey) {
			req.log.warn("Access denied: Missing X-API-Key header.");
			res.status(401).json({error: "Unauthorized: Missing API Key."});
			return;
		}

		if (providedKey === SECRET_KEY) {
			req.log.info("API Key authenticated successfully.");
			return next(); // This is already void-returning
		} else {
			req.log.warn("Access denied: Invalid API Key provided.");
			res.status(403).json({error: "Forbidden: Invalid API Key."});
			return;
		}
	};

	// Get all items
	router.post('/update', async (req, res): Promise<any> => {
		const requestBody: UserCollectionData = req.body;
		const accountHash = requestBody.accountHash;
		const username = requestBody.username;
		const profileVisible = requestBody.profileVisible;
		const collectedItems = requestBody.collectedItems;
		const subcategories = requestBody.subcategories;

		req.log.info({accountHash, username, profileVisible}, 'Received clog update request');

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
			subcategories,
			profileVisible: profileVisible || false,
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

	router.post('/static-data', authenticateApiKey, async (req: Request, res: Response) => {
		// If the code reaches here, authenticateApiKey called next(), meaning the key was valid.
		const data = req.body as StaticDataRequest;

		// --- Data Validation (Basic Example) ---
		if (!data || !Array.isArray(data.subcategories) || !Array.isArray(data.categories) || data.categories === null) {
			req.log.error('Invalid data format received post-authentication.');
			// Note: Authentication succeeded, but the body is wrong.
			res.status(400).json({error: 'Invalid data format...'});
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
			res.status(500).json({error: 'Server error'});
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

	router.get('/:username/:subcategoryName', async (req, res): Promise<any> => {
		const log = req.log;
		const username: string = decodeURIComponent(req.params.username);
		const subcategoryName: string = req.params.subcategoryName;
		const mode: string = (req.query.mode as string) || 'owned';

		if (mode !== 'owned' && mode !== 'missing') {
			log.warn({username, mode}, 'Invalid mode parameter');
			return res.status(400).send("Invalid 'mode' parameter. Must be 'owned' or 'missing'.");
		}

		let subcategoryAliased: string = getSubcategoryAlias(subcategoryName);

		log.info({username, subcategoryAliased}, 'Fetching collection log data request');

		if (!username || !subcategoryAliased) {
			res.status(400).send('Invalid username or subcategory name');
			return;
		}

		// Check cache first
		const cacheKey = `clog:${username}:${subcategoryAliased}:${mode}`;
		const cacheTTLSeconds = 10;
		// --- 1. Check Redis Cache First ---
		try {
			const cachedDataString = await redisConnection.get(cacheKey);
			if (cachedDataString) {
				log.debug({username, cacheKey}, 'Redis cache hit');
				try {
					const cachedData = JSON.parse(cachedDataString);
					return res.json(cachedData); // Return cached data
				} catch (parseError) {
					log.error({username, parseError, cacheKey}, "Failed to parse cached data from Redis");
					// Proceed to fetch from DB if parsing fails
				}
			} else {
				log.debug({username, cacheKey}, 'Redis cache miss');
			}
		} catch (redisError) {
			// Log Redis error but proceed to DB query as a fallback
			log.error({username, redisError, cacheKey}, 'Redis GET command failed, falling back to DB');
		}

		const client = await pool.connect();
		try {
			// --- Query 1: Fetch Metadata (Player, Subcategory, KC) ---
			const metadataQuery = `
            SELECT
                p.id AS playerid,
                s.id AS subcategory_id,
                s.name AS validated_subcategory_name,
                s.total AS total,
                COALESCE(pkc.kc, 0) AS kc
            FROM
                players p
            JOIN
                subcategories s ON s.name = $2 -- Use subcategoryAliased
            LEFT JOIN
                player_kc pkc ON pkc.playerid = p.id AND pkc.subcategoryId = s.id AND pkc.kc != -1
            WHERE
                p.username ILIKE $1;
        `;
			const metadataResult = await client.query(metadataQuery, [username, subcategoryAliased]);

			if (metadataResult.rows.length === 0) {
				log.warn({ username, subcategoryAliased }, 'Metadata not found: Player or Subcategory does not exist, or combination is invalid.');
				res.status(404).send('Player or Subcategory not found.');
				return;
			}

			const { playerid: playerid, subcategory_id: subcategoryId, validated_subcategory_name: validatedSubcategoryName, total, kc } = metadataResult.rows[0];
			log.debug({ username, subcategoryAliased, playerid, subcategoryId, validatedSubcategoryName, total, kc }, 'Metadata fetched');

			// --- Query 2: Fetch Items (Owned or Missing) ---
			let itemsResult;
			const items: CollectionLogItemOutput[] = [];

			if (mode === 'owned') {
				const ownedItemsQuery = `
	                SELECT pi.itemid, pi.quantity
	                FROM player_items pi
	                JOIN subcategory_items sci ON sci.itemid = pi.itemid
	                WHERE pi.playerid = $1 AND sci.subcategoryid = $2
                    ORDER BY sci.id;
	            `;
				itemsResult = await client.query(ownedItemsQuery, [playerid, subcategoryId]);
				itemsResult.rows.forEach(row => {
					items.push({ itemId: row.itemid, quantity: row.quantity });
				});
			} else { // mode === 'missing'
				const missingItemsQuery = `
	                SELECT sci.itemid
	                FROM subcategory_items sci
	                WHERE sci.subcategoryid = $2
	                AND NOT EXISTS (
	                    SELECT 1
	                    FROM player_items pi
	                    WHERE pi.playerid = $1
	                    AND pi.itemid = sci.itemid
	                );
            	`;
				itemsResult = await client.query(missingItemsQuery, [playerid, subcategoryId]);
				itemsResult.rows.forEach(row => {
					items.push({ itemId: row.itemid, quantity: 1 }); // Missing items have quantity 0
				});
			}
			log.debug({ username, subcategoryAliased, mode, itemCount: items.length }, 'Items fetched');

			// --- Response Construction ---
			const response = {
				kc: Number(kc),
				subcategoryName: validatedSubcategoryName,
				total: Number(total),
				items,
			};

			// --- Cache Storage ---
			try {
				const responseString = JSON.stringify(response);
				await redisConnection.set(cacheKey, responseString, 'EX', cacheTTLSeconds);
				log.debug({ cacheKey, ttl: cacheTTLSeconds }, 'Result stored in Redis cache');
			} catch (redisSetError) {
				log.error({ err: redisSetError, cacheKey }, 'Redis SET command failed');
			}

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

	router.get('/kc-aliases', async (req, res): Promise<any> => {
		try {
			const aliases = getKCLookupAliases();
			res.status(200).json(aliases);
		} catch (error) {
			req.log.error(error, 'Failed to fetch KC lookup aliases');
			res.status(500).json({error: 'Failed to fetch KC lookup aliases'});
		}
	});

	return router;
};
