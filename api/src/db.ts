import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/crawler';

export async function connectDB() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB');
    
    // Create indexes
    const { Page } = await import('./models/Page');
    await Page.createIndexes();
  } catch (error) {
    console.error('MongoDB connection error:', error);
    throw error;
  }
}

export async function checkDBHealth(): Promise<boolean> {
  try {
    if (!mongoose.connection.db) return false;
    await mongoose.connection.db.admin().ping();
    return true;
  } catch {
    return false;
  }
}
