import dotenv from "dotenv";
dotenv.config();

import express from "express";
import path from "path";
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import connectDB from "./config/db";
import { initJobs } from "./jobs";
import { errorHandler } from "./middleware/errorHandler";
import { noSqlSanitize } from "./middleware/sanitize";

import pinoHttp from 'pino-http';
import logger from './utils/logger';

// Farmer Routes
import authRoutes from './routes/farmer/auth';
import cattleRoutes from './routes/farmer/cattle';
import locationRoutes from './routes/farmer/location';
import userRoutes from './routes/farmer/user';

// Admin Routes
import adminAuthRoutes from './routes/admin/auth';
import adminCattleRoutes from './routes/admin/cattle';
import adminDisputeRoutes from './routes/admin/disputes';
import adminAnalyticsRoutes from './routes/admin/analytics';
import adminUserRoutes from './routes/admin/user';

if (!process.env.JWT_SECRET || !process.env.MONGO_URI) {
  logger.fatal("FATAL ERROR: Missing env secrets.");
  process.exit(1);
}

// Handle unexpected process errors
process.on('uncaughtException', (err) => {
  logger.fatal(err, 'UNCAUGHT EXCEPTION! 💥');
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  logger.fatal(err, 'UNHANDLED REJECTION! 💥');
  process.exit(1);
});

const app = express();
app.set('trust proxy', 1);
const port = process.env.PORT || 2424;

const allowedOrigins = [
  'http://localhost:5173',
  'capacitor://localhost',
  'http://localhost',
  'https://localhost',
  process.env.CLIENT_LINK || '',
  process.env.ADMIN_CLIENT_LINK || ''
];

const corsOptionsDelegate = (req: any, callback: any) => {
  const origin = req.header('Origin');
  
  // Allow health checks from Render/internal without origin, bypass for tests, and allow webhooks
  if (
    process.env.NODE_ENV === 'test' || 
    (!origin && (req.path === '/' || req.path === '/api/health')) ||
    req.path.includes('/webhook/')
  ) {
    return callback(null, { origin: true });
  }

  // Strict check for all other requests
  if (origin && allowedOrigins.includes(origin)) {
    callback(null, { origin: true });
  } else {
    logger.warn(`🛑 Blocked by CORS: Origin ${origin} on path ${req.path}`);
    callback(new Error('Not allowed by CORS policy'));
  }
};

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
// Global payload limit set to 2mb to prevent DDoS memory exhaustion. 
// Biometric upload endpoints will override this locally if needed.
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ limit: '2mb', extended: true }));
app.use(noSqlSanitize); // Sanitize ALL incoming payloads before they hit routers
app.use(cors(corsOptionsDelegate));

app.use(pinoHttp({ logger }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { success: false, message: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Database and Jobs Initialization
if (process.env.NODE_ENV !== 'test') {
  connectDB();
  initJobs();
}

// Static and Public Routes
app.get('/api/health', generalLimiter, (req, res) => res.status(200).send("Express Server is Awake and running!"));
app.get("/", generalLimiter, (req, res) => res.send("Hello World! API running"));

// Farmer API Routes
app.use('/api/farmer/auth', authLimiter, authRoutes);
app.use('/api/farmer/cattle', generalLimiter, cattleRoutes);
app.use('/api/farmer/location', generalLimiter, locationRoutes);
app.use('/api/farmer/user', generalLimiter, userRoutes);

// Admin API Routes
app.use('/api/admin/auth', authLimiter, adminAuthRoutes);
app.use('/api/admin/cattle', generalLimiter, adminCattleRoutes);
app.use('/api/admin/disputes', generalLimiter, adminDisputeRoutes);
app.use('/api/admin/analytics', generalLimiter, adminAnalyticsRoutes);
app.use('/api/admin/users', generalLimiter, adminUserRoutes);

// Global Error Handler Middleware
app.use(errorHandler);

if (process.env.NODE_ENV !== 'test') {
  app.listen(Number(port), "0.0.0.0", () => {
    logger.info(`Server is running on port ${port}`);
  });
}

export default app;