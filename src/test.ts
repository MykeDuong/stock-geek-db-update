import { getMultipleTickersAsMap, handler, fetchTickersFromHoldings, config } from './app';
import { Pool, PoolConfig } from 'pg';
import yahooFinance from "yahoo-finance2"

const main = async () => {
  // @ts-ignore
  handler(null, null);
}

main()
