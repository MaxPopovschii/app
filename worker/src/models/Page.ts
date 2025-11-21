import mongoose, { Schema, Document } from 'mongoose';

export interface IPage extends Document {
  uid: string;
  url: string;
  status: 'pending' | 'done' | 'error';
  description?: string;
  image?: Buffer;
  errorMessage?: string;
  tookMs?: number;
  createdAt: Date;
  updatedAt: Date;
  meta?: {
    viewport: { w: number; h: number };
    userAgent: string;
  };
}

const PageSchema = new Schema<IPage>(
  {
    uid: { 
      type: String, 
      required: true, 
      unique: true 
    },
    url: { 
      type: String, 
      required: true 
    },
    status: { 
      type: String, 
      enum: ['pending', 'done', 'error'], 
      required: true 
    },
    description: String,
    image: Buffer,
    errorMessage: String,
    tookMs: Number,
    meta: {
      viewport: {
        w: Number,
        h: Number
      },
      userAgent: String
    }
  },
  {
    timestamps: true
  }
);

export const Page = mongoose.model<IPage>('Page', PageSchema);
