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
  console.error("FATAL ERROR: Missing env secrets.");
  process.exit(1);
}

// Handle unexpected process errors
process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION! 💥', err);
});
process.on('unhandledRejection', (err) => {
    console.error('UNHANDLED REJECTION! 💥', err);
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

const corsOptions = {
  origin: function (origin: any, callback: any) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`🛑 Blocked by CORS: ${origin}`);
      callback(new Error('Not allowed by CORS policy'));
    }
  },
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors(corsOptions));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} | IP: ${req.ip} | Origin: ${req.headers.origin || 'None'}`);
  next();
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Database and Jobs Initialization
connectDB();
initJobs();

// Static and Public Routes
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.get('/api/health', (req, res) => res.status(200).send("Express Server is Awake and running!"));
app.get('/health', (req, res) => res.status(200).send('OK'));
app.get("/", (req, res) => res.send("Hello World! API running"));

// Farmer API Routes
app.use('/api/farmer/auth', authLimiter, authRoutes);
app.use('/api/farmer/cattle', cattleRoutes);
app.use('/api/farmer/location', locationRoutes);
app.use('/api/farmer/user', userRoutes);

// Admin API Routes
app.use('/api/admin/auth', authLimiter, adminAuthRoutes);
app.use('/api/admin/cattle', adminCattleRoutes);
app.use('/api/admin/disputes', adminDisputeRoutes);
app.use('/api/admin/analytics', adminAnalyticsRoutes);
app.use('/api/admin/users', adminUserRoutes);

// Global Error Handler Middleware
app.use(errorHandler);

app.listen(Number(port), "localhost", () => {
  console.log(`Server is running at http://localhost:${port}`);
});