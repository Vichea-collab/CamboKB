import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BakongError, HttpBakongClient } from './client';

/** A stand-in for the Bakong Open API that answers like the documented endpoints. */
let base = '';
let lastRequest: { auth?: string; body?: unknown } = {};
let mode: 'found' | 'missing' | 'unauthorized' | 'broken' = 'found';
const server = express()
  .use(express.json())
  .post('/v1/check_transaction_by_md5', (req, res) => {
    lastRequest = { auth: req.get('authorization'), body: req.body };
    if (mode === 'unauthorized') return res.status(401).json({ responseCode: 1, responseMessage: 'Unauthorized', errorCode: 6, data: null });
    if (mode === 'broken') return res.status(500).send('oops');
    if (mode === 'missing') return res.json({ responseCode: 1, responseMessage: 'Transaction could not be found. Please check and try again.', errorCode: 1, data: null });
    res.json({
      responseCode: 0,
      responseMessage: 'Getting transaction successfully.',
      errorCode: null,
      data: {
        hash: 'abc123hash',
        fromAccountId: 'customer@aclb',
        toAccountId: 'cambosupply@aclb',
        currency: 'USD',
        amount: 43.5,
        description: 'CS-250001',
        createdDateMs: 1763350000000,
        acknowledgedDateMs: 1763350001000,
      },
    });
  })
  .listen(0);

beforeAll(() => {
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
});

describe('HttpBakongClient', () => {
  it('asks Bakong for a transaction by md5 with the bearer token', async () => {
    mode = 'found';
    const result = await new HttpBakongClient(base, 'secret-token').checkByMd5('d41d8cd98f00b204e9800998ecf8427e');
    expect(lastRequest).toEqual({ auth: 'Bearer secret-token', body: { md5: 'd41d8cd98f00b204e9800998ecf8427e' } });
    expect(result).toEqual({
      found: true,
      hash: 'abc123hash',
      amount: 43.5,
      currency: 'USD',
      fromAccountId: 'customer@aclb',
      toAccountId: 'cambosupply@aclb',
      paidAt: new Date(1763350001000),
      raw: expect.objectContaining({ hash: 'abc123hash' }),
    });
  });

  it('reports a transaction that does not exist yet', async () => {
    mode = 'missing';
    expect(await new HttpBakongClient(base, 't').checkByMd5('x')).toEqual({ found: false });
  });

  it('flags a rejected token so the admin can renew it', async () => {
    mode = 'unauthorized';
    await expect(new HttpBakongClient(base, 'old').checkByMd5('x')).rejects.toMatchObject({ kind: 'UNAUTHORIZED' });
  });

  it('treats server errors and unreachable hosts as temporarily unavailable', async () => {
    mode = 'broken';
    await expect(new HttpBakongClient(base, 't').checkByMd5('x')).rejects.toMatchObject({ kind: 'UNAVAILABLE' });
    await expect(new HttpBakongClient('http://127.0.0.1:9', 't').checkByMd5('x')).rejects.toBeInstanceOf(BakongError);
  });
});
