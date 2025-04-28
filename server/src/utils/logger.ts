import pino from 'pino';

const isDevelopment = process.env.NODE_ENV !== 'production';

const logger = pino({
	level: isDevelopment ? 'debug' : 'info'
});

logger.info('Logger initialized in environment: ' + process.env.NODE_ENV);
export default logger;