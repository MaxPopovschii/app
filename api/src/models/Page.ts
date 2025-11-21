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
      unique: true,
      index: true 
    },
    url: { 
      type: String, 
      required: true,
      index: true 
    },
    status: { 
      type: String, 
      enum: ['pending', 'done', 'error'], 
      required: true,
      index: true 
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

// Compound index for idempotency check
PageSchema.index({ url: 1, status: 1 });
PageSchema.index({ createdAt: -1 });

export const Page = mongoose.model<IPage>('Page', PageSchema);
