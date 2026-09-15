import './env.js';
import {
  CreateTableCommand,
  DynamoDBClient,
  DescribeTableCommand,
} from '@aws-sdk/client-dynamodb';
import {
  BatchGetCommand,
  type BatchGetCommandInput,
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
  // Business records may use an ISO expiration timestamp; session/token TTL
  // records use epoch seconds. Both are valid stored representations.
  expiresAt?: number | string | undefined;
};
export type Key = { PK: string; SK: string };
export type Write =
  | {
      type: 'put';
      item: RecordItem;
      condition?: string;
      expected?: Record<string, unknown>;
    }
  | { type: 'check'; key: Key; expected: Record<string, unknown> }
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
    opts?: { beginsWith?: string; limit?: number; between?: [string, string] },
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
    if (_condition === 'attribute_exists(PK)' && !this.items.has(this.key(key)))
      throw new AppError('CONFLICT', 'Conditional write failed.');
    this.items.delete(this.key(key));
  }
  async query<T extends RecordItem>(
    pk: string,
    opts?: { beginsWith?: string; limit?: number; between?: [string, string] },
  ) {
    const result = [...this.items.values()]
      .filter(
        (i) =>
          i.PK === pk &&
          (!opts?.beginsWith || i.SK.startsWith(opts.beginsWith)) &&
          (!opts?.between ||
            (i.SK >= opts.between[0] && i.SK <= opts.between[1])),
      )
      .sort((a, b) => a.SK.localeCompare(b.SK));
    return (
      opts?.limit === undefined ? result : result.slice(0, opts.limit)
    ) as T[];
  }
  async scan<T extends RecordItem>(filter?: (item: T) => boolean) {
    const items = [...this.items.values()] as T[];
    return filter ? items.filter(filter) : items;
  }
  async transactWrite(writes: Write[]) {
    if (writes.length > 100)
      throw new AppError(
        'VALIDATION_ERROR',
        'A DynamoDB transaction cannot contain more than 100 actions.',
      );
    let release!: () => void;
    const previous = this.mutex;
    this.mutex = new Promise((r) => {
      release = r;
    });
    await previous;
    try {
      for (const write of writes) {
        if (write.type !== 'delete' && write.expected) {
          const current = this.items.get(
            this.key(write.type === 'put' ? write.item : write.key),
          );
          if (
            !current ||
            Object.entries(write.expected).some(
              ([name, value]) => current[name] !== value,
            )
          )
            throw new AppError('CONFLICT', 'Record changed. Please reload.');
        }
        if (
          write.type === 'put' &&
          write.condition === 'attribute_not_exists(PK)' &&
          this.items.has(this.key(write.item))
        )
          throw new AppError(
            'SCHEDULE_CONFLICT',
            'Court is no longer available.',
          );
        if (
          write.type === 'delete' &&
          write.condition === 'attribute_exists(PK)' &&
          !this.items.has(this.key(write.key))
        )
          throw new AppError('CONFLICT', 'Conditional write failed.');
      }
      for (const write of writes) {
        if (write.type === 'put')
          this.items.set(this.key(write.item), structuredClone(write.item));
        else if (write.type === 'delete')
          this.items.delete(this.key(write.key));
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
      else if (w.type === 'delete') await this.delete(w.key, w.condition);
      else await this.transactWrite([w]);
    }
  }
}

function expectedCondition(expected: Record<string, unknown>) {
  const entries = Object.entries(expected);
  return {
    ConditionExpression: entries.map((_, i) => `#e${i} = :e${i}`).join(' AND '),
    ExpressionAttributeNames: Object.fromEntries(
      entries.map(([name], i) => [`#e${i}`, name]),
    ),
    ExpressionAttributeValues: Object.fromEntries(
      entries.map(([, value], i) => [`:e${i}`, value]),
    ),
  };
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
    opts?: { beginsWith?: string; limit?: number; between?: [string, string] },
  ) {
    const items: T[] = [];
    let ExclusiveStartKey: Key | undefined;
    do {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.table,
          KeyConditionExpression: opts?.between
            ? 'PK = :pk AND SK BETWEEN :from AND :to'
            : opts?.beginsWith
              ? 'PK = :pk AND begins_with(SK, :sk)'
              : 'PK = :pk',
          ExpressionAttributeValues: opts?.between
            ? { ':pk': pk, ':from': opts.between[0], ':to': opts.between[1] }
            : opts?.beginsWith
              ? { ':pk': pk, ':sk': opts.beginsWith }
              : { ':pk': pk },
          ...(opts?.limit
            ? { Limit: Math.max(1, opts.limit - items.length) }
            : {}),
          ...(ExclusiveStartKey ? { ExclusiveStartKey } : {}),
        }),
      );
      items.push(...((result.Items ?? []) as T[]));
      ExclusiveStartKey = result.LastEvaluatedKey as Key | undefined;
    } while (
      ExclusiveStartKey &&
      (opts?.limit === undefined || items.length < opts.limit)
    );
    return opts?.limit === undefined ? items : items.slice(0, opts.limit);
  }
  async scan<T extends RecordItem>(filter?: (item: T) => boolean) {
    const items: T[] = [];
    let ExclusiveStartKey: Key | undefined;
    do {
      const result = await this.client.send(
        new ScanCommand({
          TableName: this.table,
          ...(ExclusiveStartKey ? { ExclusiveStartKey } : {}),
        }),
      );
      items.push(...((result.Items ?? []) as T[]));
      ExclusiveStartKey = result.LastEvaluatedKey as Key | undefined;
    } while (ExclusiveStartKey);
    return filter ? items.filter(filter) : items;
  }
  async transactWrite(writes: Write[]) {
    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: writes.map((w) =>
            w.type === 'check'
              ? {
                  ConditionCheck: {
                    TableName: this.table,
                    Key: w.key,
                    ...expectedCondition(w.expected),
                  },
                }
              : w.type === 'put'
                ? {
                    Put: {
                      TableName: this.table,
                      Item: w.item,
                      ...(w.expected ? expectedCondition(w.expected) : {}),
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
    } catch (error) {
      const name = String((error as { name?: unknown }).name ?? '');
      if (name === 'ValidationException')
        throw new AppError(
          'VALIDATION_ERROR',
          'A DynamoDB transaction cannot contain more than 100 actions.',
        );
      if (
        writes.some(
          (w) => w.type === 'check' || (w.type === 'put' && w.expected),
        )
      )
        throw new AppError(
          'CONFLICT',
          'Record changed. Please reload.',
          {},
          409,
        );
      throw new AppError(
        'SCHEDULE_CONFLICT',
        'Court is no longer available.',
        {},
        409,
      );
    }
  }
  async batchGet<T extends RecordItem>(keys: Key[]) {
    if (!keys.length) return [];
    if (keys.length > 100)
      throw new AppError(
        'VALIDATION_ERROR',
        'A DynamoDB batch get cannot contain more than 100 keys.',
      );
    let pending: NonNullable<BatchGetCommandInput['RequestItems']> = {
      [this.table]: { Keys: keys },
    };
    const items: T[] = [];
    for (
      let attempt = 0;
      Object.keys(pending).length && attempt < 3;
      attempt++
    ) {
      const result = await this.client.send(
        new BatchGetCommand({ RequestItems: pending }),
      );
      items.push(...((result.Responses?.[this.table] ?? []) as T[]));
      pending = result.UnprocessedKeys ?? {};
    }
    if (Object.keys(pending).length)
      throw new AppError('CONFLICT', 'Unable to read all requested records.');
    return items;
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
