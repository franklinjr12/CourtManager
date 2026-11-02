import { ensureTable } from './apps/api/src/db.js';

export default async function setup() {
  // Match the settings forced by the integration tests so the table is
  // created on DynamoDB Local, never on a real AWS endpoint.
  process.env.DYNAMODB_ENDPOINT = 'http://localhost:8120';
  process.env.DYNAMODB_TABLE = 'court-manager-integration';
  process.env.AWS_REGION = 'us-east-1';
  await ensureTable();
}
