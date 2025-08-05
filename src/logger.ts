import winston from 'winston';

// Simple console logger for now to avoid Cloud Logging issues
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { 
    service: 'streamable-mcp-server',
    version: '1.0.0',
  },
  transports: [
    // Always log to console
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
  ],
});



// Add request logging middleware for Koa
export const requestLogger = (ctx: any, next: any) => {
  const start = Date.now();
  
  return next().then(() => {
    const ms = Date.now() - start;
    logger.info('HTTP Request', {
      method: ctx.method,
      url: ctx.url,
      status: ctx.status,
      responseTime: ms,
      userAgent: ctx.headers['user-agent'],
      ip: ctx.ip,
    });
  }).catch((err: any) => {
    const ms = Date.now() - start;
    logger.error('HTTP Request Error', {
      method: ctx.method,
      url: ctx.url,
      status: ctx.status || 500,
      responseTime: ms,
      error: err.message,
      stack: err.stack,
    });
    throw err;
  });
};

export default logger; 