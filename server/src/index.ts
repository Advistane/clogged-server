import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import cors from 'cors';
import dotenv from 'dotenv';
import {createClogRouter} from "./routes/clog";
import logger from './utils/logger';
import {pinoHttp} from "pino-http";

import {redisConnection} from "./queue";
import {createGroupsRouter} from "./routes/groups";
import {createUserRouter} from "./routes/users";
import {getKCLookupAliases} from "./utils/alias";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;
const httpLogger = pinoHttp({
	logger,
	autoLogging: {
		ignore: (req) => {
			return req.url === '/';
		}
	}
});

logger.info('Server starting...');

// Middleware
app.use(httpLogger);
app.use(cors());
app.use(express.json());

// Database connection
const pool = new Pool({
	host: process.env.DB_HOST,
	port: parseInt(process.env.DB_PORT || '5432'),
	user: process.env.DB_USER,
	password: process.env.DB_PASSWORD,
	database: process.env.DB_NAME,
	max: 50, // Maximum number of clients in the pool
	connectionTimeoutMillis: 5000, // Timeout after 5 seconds
	idleTimeoutMillis: 10000, // Close idle clients after 10 seconds
	statement_timeout: 5000, // Timeout after 5 seconds for each query
});

pool.on('error', (err) => {
	logger.fatal('Unexpected error on idle client', err);
});

// Test database connection
pool.connect((err, client, release) => {
	if (err) {
		return logger.error('Error acquiring client', err.stack, err);
	}
	logger.info('Connected to PostgreSQL database');
	release();
});

// Routes
app.get('/', (req: Request, res: Response) => {
	res.send('API is running...');
});

// In your Express app (server.ts or similar)
app.get('/healthz', async (req, res) => {
	const client = await pool.connect();
	try {
		// Check DB connection (e.g., run a simple query like 'SELECT 1')
		await client.query('SELECT 1'); // Replace with your actual DB client method
		// Check Redis connection (e.g., run a PING command)
		await redisConnection.ping(); // Replace with your actual Redis client method
		res.status(200).send('OK');
	} catch (error) {
		console.error('Health check failed:', error);
		res.status(503).send('Service Unavailable'); // 503 Service Unavailable
	} finally {
		client.release();
	}
});

app.get('/kc-aliases', async (req, res): Promise<any> => {
	try {
		const aliases = getKCLookupAliases();
		res.status(200).json(aliases);
	} catch (error) {
		req.log.error(error, 'Failed to fetch KC lookup aliases');
		res.status(500).json({error: 'Failed to fetch KC lookup aliases'});
	}
});

app.use('/api/clog', createClogRouter(pool));
app.use('/groups', createGroupsRouter(pool));
app.use('/users', createUserRouter(pool));

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: any) => {
	req.log.error(err, 'Unhandled error');
	res.status(500).send('Something broke!');
});

app.listen(port, () => {
	console.log(`Server running on port ${port}`);
});