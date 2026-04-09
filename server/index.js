import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import authRoutes from './routes/auth.js';
import analyzeRoutes from './routes/analyze.js';
import optimizeRoutes from './routes/optimize.js';
import historyRoutes from './routes/history.js';
import shareRoutes from './routes/share.js';
import errorHandler from './middleware/errorHandler.js';

dotenv.config();

const app=express();

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/analyze', analyzeRoutes);
app.use('/api/optimize', optimizeRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/share', shareRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use(errorHandler);

const PORT=process.env.PORT||3001;

app.listen(PORT,()=>{
    console.log(`Server is running on https://localhost:${PORT}`);
});