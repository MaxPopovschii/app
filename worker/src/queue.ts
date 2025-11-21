import amqp from 'amqplib';
import { processCrawl } from './crawler';

const RABBIT_URL = process.env.RABBIT_URL || 'amqp://localhost:5672';
const EXCHANGE = 'crawl';
const QUEUE = 'crawl.requests';
const DLX_EXCHANGE = 'crawl.dlx';
const DLX_QUEUE = 'crawl.dead';

let connection: any;
let channel: any;

export async function connectRabbit() {
  try {
    connection = await amqp.connect(RABBIT_URL);
    channel = await connection.createChannel();
    
    // Setup exchanges and queues (same as API for consistency)
    await channel.assertExchange(EXCHANGE, 'direct', { durable: true });
    await channel.assertExchange(DLX_EXCHANGE, 'direct', { durable: true });
    await channel.assertQueue(DLX_QUEUE, { durable: true });
    await channel.bindQueue(DLX_QUEUE, DLX_EXCHANGE, DLX_QUEUE);
    
    await channel.assertQueue(QUEUE, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': DLX_EXCHANGE,
        'x-dead-letter-routing-key': DLX_QUEUE
      }
    });
    await channel.bindQueue(QUEUE, EXCHANGE, QUEUE);
    
    // Set prefetch to 1 (process one message at a time)
    await channel.prefetch(1);
    
    console.log('Worker connected to RabbitMQ');
  } catch (error) {
    console.error('RabbitMQ connection error:', error);
    throw error;
  }
}

export async function consumeCrawlRequests() {
  if (!channel) {
    throw new Error('RabbitMQ channel not initialized');
  }
  
  await channel.consume(QUEUE, async (msg: any) => {
    if (!msg) return;
    
    const deliveryCount = (msg.properties.headers?.['x-delivery-count'] || 0) as number;
    const maxRetries = 2;
    
    try {
      const message = JSON.parse(msg.content.toString());
      const { uid, url } = message;
      
      console.log(`Processing crawl for UID: ${uid}, URL: ${url}`);
      
      await processCrawl(uid, url);
      
      // Success - acknowledge message
      channel.ack(msg);
      console.log(`Completed crawl for UID: ${uid}`);
    } catch (error) {
      console.error('Error processing crawl:', error);
      
      // Check retry count
      if (deliveryCount >= maxRetries) {
        // Max retries reached, send to DLX
        console.error(`Max retries reached for message, sending to DLX`);
        channel.nack(msg, false, false); // Don't requeue
      } else {
        // Retry - nack with requeue
        console.log(`Retrying message (attempt ${deliveryCount + 1}/${maxRetries})`);
        channel.nack(msg, false, true);
      }
    }
  });
}
