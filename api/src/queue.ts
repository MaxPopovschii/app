import amqp from 'amqplib';

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
    
    await channel.assertExchange(EXCHANGE, 'direct', { durable: true });
    
    // setup DLX
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
    
    console.log('Connected to RabbitMQ');
  } catch (error) {
    console.error('RabbitMQ connection error:', error);
    throw error;
  }
}

export async function publishCrawlRequest(message: { uid: string; url: string; requestedAt: string }) {
  if (!channel) {
    throw new Error('RabbitMQ channel not initialized');
  }
  
  const content = Buffer.from(JSON.stringify(message));
  channel.publish(EXCHANGE, QUEUE, content, {
    persistent: true,
    contentType: 'application/json'
  });
}

export async function checkRabbitHealth(): Promise<boolean> {
  return !!(connection && channel);
}
