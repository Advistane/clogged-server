import express, { Request, Response } from 'express';
import { Pool } from 'pg';
import cors from 'cors';
import dotenv from 'dotenv';
import { createNpcsRouter } from './routes/npcs';
import {createItemsRouter} from "./routes/items";
import {createClogRouter} from "./routes/clog";
import logger from './utils/logger';
import {pinoHttp} from "pino-http";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;
const httpLogger = pinoHttp({ logger })
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
		return logger.error('Error acquiring client', err.stack);
	}
	logger.info('Connected to PostgreSQL database');
	release();
});

// Routes
app.get('/', (req: Request, res: Response) => {
	res.send('API is running...');
});

app.post('/userData', (req, res) => {
	const userData = req.body;
	console.log(userData);
	res.status(200).json({ message: 'User data received successfully!', receivedData: userData });
})

// Use the NPCs router for /api/npcs routes
app.use('/api/npcs', createNpcsRouter(pool));
app.use('/api/items', createItemsRouter(pool));
app.use('/api/clog', createClogRouter(pool));

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: any) => {
	req.log.error(err, 'Unhandled error');
	res.status(500).send('Something broke!');
});


const server = app.listen(port, () => {
	console.log(`Server running on port ${port}`);
});