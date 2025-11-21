import mongoose from 'mongoose';
import { connectRabbit, consumeCrawlRequests } from './queue';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/crawler';

async function connectDB() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Worker connected to MongoDB');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    throw error;
  }
}

async function startWorker() {
  await connectDB();
  await connectRabbit();
  await consumeCrawlRequests();
  
  console.log('Worker started and consuming messages');
}

startWorker().catch((err) => {
  console.error('Failed to start worker:', err);
  process.exit(1);
});
