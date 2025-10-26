import pino from 'pino';

const isDevelopment = process.env.NODE_ENV !== 'production';
const logLevel = process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info');

const logger = pino({
	level: logLevel
});

logger.info(`Logger initialized in environment: ${process.env.NODE_ENV} with level: ${logLevel}`);
export default logger;