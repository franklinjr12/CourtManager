import './env.js';
import {
  CreateTableCommand,
  DynamoDBClient,
  DescribeTableCommand,
} from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { EntityType } from '@court-manager/contracts';
import { AppError } from './errors.js';

export type RecordItem = Record<string, unknown> & {
  PK: string;
  SK: string;
  entity?: EntityType;
  expiresAt?: number;
};
export type Key = { PK: string; SK: string };
export type Write =
  | { type: 'put'; item: RecordItem; condition?: string }
  | { type: 'delete'; key: Key; condition?: string };
export interface Repository {
  get<T extends RecordItem = RecordItem>(key: Key): Promise<T | undefined>;
  put(item: RecordItem, condition?: string): Promise<void>;
  update(
    key: Key,
    updateExpression: string,
    values: Record<string, unknown>,
    names?: Record<string, string>,
    condition?: string,
  ): Promise<void>;
  delete(key: Key, condition?: string): Promise<void>;
  query<T extends RecordItem = RecordItem>(
    pk: string,
    opts?: { beginsWith?: string; limit?: number },
  ): Promise<T[]>;
  scan<T extends RecordItem = RecordItem>(
    filter?: (item: T) => boolean,
  ): Promise<T[]>;
  transactWrite(writes: Write[]): Promise<void>;
  batchGet<T extends RecordItem = RecordItem>(keys: Key[]): Promise<T[]>;
  batchWrite(writes: Write[]): Promise<void>;
}

export class MemoryRepository implements Repository {
  private readonly items = new Map<string, RecordItem>();
  private mutex = Promise.resolve();
  private key(key: Key) {
    return `${key.PK}|${key.SK}`;
  }
  async get<T extends RecordItem>(key: Key) {
    return this.items.get(this.key(key)) as T | undefined;
  }
  async put(item: RecordItem, condition?: string) {
    if (
      condition === 'attribute_not_exists(PK)' &&
      this.items.has(this.key(item))
    )
      throw new AppError('CONFLICT', 'Conditional write failed.');
    this.items.set(this.key(item), structuredClone(item));
  }
  async update(key: Key, expression: string, values: Record<string, unknown>) {
    const item = await this.get(key);
    if (!item) throw new AppError('NOT_FOUND', 'Record was not found.');
    const fields = expression
      .replace(/^SET\s+/, '')
      .split(',')
      .map((v) => v.trim());
    for (const field of fields) {
      const [name, value] = field.split('=').map((v) => v.trim());
      if (name && value && value.startsWith(':'))
        item[name] = values[value.slice(1)];
    }
    this.items.set(this.key(key), item);
  }
  async delete(key: Key, _condition?: string) {
    this.items.delete(this.key(key));
  }
  async query<T extends RecordItem>(
    pk: string,
    opts?: { beginsWith?: string; limit?: number },
  ) {
    return [...this.items.values()]
      .filter(
        (i) =>
          i.PK === pk &&
          (!opts?.beginsWith || i.SK.startsWith(opts.beginsWith)),
      )
      .slice(0, opts?.limit ?? 100) as T[];
  }
  async scan<T extends RecordItem>(filter?: (item: T) => boolean) {
    const items = [...this.items.values()] as T[];
    return filter ? items.filter(filter) : items;
  }
  async transactWrite(writes: Write[]) {
    let release!: () => void;
    const previous = this.mutex;
    this.mutex = new Promise((r) => {
      release = r;
    });
    await previous;
    try {
      for (const write of writes) {
        if (
          write.type === 'put' &&
          write.condition === 'attribute_not_exists(PK)' &&
          this.items.has(this.key(write.item))
        )
          throw new AppError(
            'SCHEDULE_CONFLICT',
            'Court is no longer available.',
          );
      }
      for (const write of writes) {
        if (write.type === 'put')
          this.items.set(this.key(write.item), structuredClone(write.item));
        else this.items.delete(this.key(write.key));
      }
    } finally {
      release();
    }
  }
  async batchGet<T extends RecordItem>(keys: Key[]) {
    const result: T[] = [];
    for (const item of keys) {
      const value = await this.get<T>(item);
      if (value) result.push(value);
    }
    return result;
  }
  async batchWrite(writes: Write[]) {
    for (const w of writes) {
      if (w.type === 'put') await this.put(w.item, w.condition);
      else await this.delete(w.key, w.condition);
    }
  }
}

export class DynamoRepository implements Repository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly table: string,
  ) {}
  async get<T extends RecordItem>(key: Key) {
    return (
      await this.client.send(
        new GetCommand({ TableName: this.table, Key: key }),
      )
    ).Item as T | undefined;
  }
  async put(item: RecordItem, ConditionExpression?: string) {
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.table,
          Item: item,
          ...(ConditionExpression ? { ConditionExpression } : {}),
        }),
      );
    } catch {
      throw new AppError('CONFLICT', 'Conditional write failed.', {}, 409);
    }
  }
  async update(
    key: Key,
    UpdateExpression: string,
    ExpressionAttributeValues: Record<string, unknown>,
    ExpressionAttributeNames?: Record<string, string>,
    ConditionExpression?: string,
  ) {
    await this.client.send(
      new UpdateCommand({
        TableName: this.table,
        Key: key,
        UpdateExpression,
        ExpressionAttributeValues,
        ExpressionAttributeNames,
        ConditionExpression,
      }),
    );
  }
  async delete(key: Key, ConditionExpression?: string) {
    await this.client.send(
      new DeleteCommand({
        TableName: this.table,
        Key: key,
        ConditionExpression,
      }),
    );
  }
  async query<T extends RecordItem>(
    pk: string,
    opts?: { beginsWith?: string; limit?: number },
  ) {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: opts?.beginsWith
          ? 'PK = :pk AND begins_with(SK, :sk)'
          : 'PK = :pk',
        ExpressionAttributeValues: opts?.beginsWith
          ? { ':pk': pk, ':sk': opts.beginsWith }
          : { ':pk': pk },
        Limit: opts?.limit ?? 100,
      }),
    );
    return (result.Items ?? []) as T[];
  }
  async scan<T extends RecordItem>(filter?: (item: T) => boolean) {
    const result = await this.client.send(
      new ScanCommand({ TableName: this.table }),
    );
    const items = (result.Items ?? []) as T[];
    return filter ? items.filter(filter) : items;
  }
  async transactWrite(writes: Write[]) {
    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: writes.map((w) =>
            w.type === 'put'
              ? {
                  Put: {
                    TableName: this.table,
                    Item: w.item,
                    ...(w.condition
                      ? { ConditionExpression: w.condition }
                      : {}),
                  },
                }
              : {
                  Delete: {
                    TableName: this.table,
                    Key: w.key,
                    ...(w.condition
                      ? { ConditionExpression: w.condition }
                      : {}),
                  },
                },
          ),
        }),
      );
    } catch {
      throw new AppError(
        'SCHEDULE_CONFLICT',
        'Court is no longer available.',
        {},
        409,
      );
    }
  }
  async batchGet<T extends RecordItem>(keys: Key[]) {
    const result = await this.client.send(
      new ScanCommand({ TableName: this.table }),
    );
    const wanted = new Set(keys.map((k) => `${k.PK}|${k.SK}`));
    return ((result.Items ?? []) as T[]).filter((x) =>
      wanted.has(`${x.PK}|${x.SK}`),
    );
  }
  async batchWrite(writes: Write[]) {
    await this.transactWrite(writes);
  }
}

export const dynamo = () => {
  const endpoint = process.env.DYNAMODB_ENDPOINT;
  const config = {
    region: process.env.AWS_REGION ?? 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'local',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'local',
    },
    ...(endpoint ? { endpoint } : {}),
  };
  const client = DynamoDBDocumentClient.from(new DynamoDBClient(config));
  return new DynamoRepository(
    client,
    process.env.DYNAMODB_TABLE ?? 'court-manager-dev',
  );
};
export const ensureTable = async () => {
  const endpoint = process.env.DYNAMODB_ENDPOINT;
  const config = {
    region: process.env.AWS_REGION ?? 'us-east-1',
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    ...(endpoint ? { endpoint } : {}),
  };
  const raw = new DynamoDBClient(config);
  const table = process.env.DYNAMODB_TABLE ?? 'court-manager-dev';
  try {
    await raw.send(new DescribeTableCommand({ TableName: table }));
  } catch {
    await raw.send(
      new CreateTableCommand({
        TableName: table,
        KeySchema: [
          { AttributeName: 'PK', KeyType: 'HASH' },
          { AttributeName: 'SK', KeyType: 'RANGE' },
        ],
        AttributeDefinitions: [
          { AttributeName: 'PK', AttributeType: 'S' },
          { AttributeName: 'SK', AttributeType: 'S' },
        ],
        BillingMode: 'PAY_PER_REQUEST',
        Tags: [
          { Key: 'Environment', Value: process.env.NODE_ENV ?? 'development' },
        ],
      }),
    );
  }
};
