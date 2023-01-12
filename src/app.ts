import { Context, APIGatewayProxyResult, APIGatewayEvent } from 'aws-lambda';
import * as dotenv from 'dotenv'
import { Pool, PoolConfig } from 'pg';
import yahooFinance from "yahoo-finance2"

/*
  Strategy:
  - Fetch all tickers from the Database
  - Get price of all tickers from Yahoo Finance
  - Update back to the Database
*/

// Configurations and Constants
dotenv.config();

interface HoldingsInterface {
  user_id: number;
  ticker: string;
  quantity: string;
}

interface HoldingsValueInterface {
  [key: number]: number;
}

interface YHErrorInterface {
  errors: any;
  result: any;
}

const config: PoolConfig = {
  connectionString: `postgres://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_DATABASE}?options`,
}

const sql = {
  getAllTickers: `
    SELECT DISTINCT(ticker)
    FROM holdings;`,
  getAllHoldings: `
    SELECT user_id, ticker, SUM(quantity) AS quantity FROM holdings
    GROUP BY user_id, ticker;
  `,
  updateOrInsertPortfolio: `
    INSERT INTO portfolio (user_id,date,value)
    VALUES ($1, (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::DATE, $2)
    ON CONFLICT (user_id, date)
    DO 
    UPDATE SET value = $2
    RETURNING *;
  `,
  getAllUsers: `
    SELECT user_id, cash
    FROM users;
  `
}

function isYHError(value: unknown): value is YHErrorInterface {
  return (!!value && !!(value as YHErrorInterface).result && !!(value as YHErrorInterface).errors)
}

const sqlQuery = async (props: { pool: Pool, query: string, queryArguments: any[] }) => {
  const { pool, query, queryArguments } = props
  let success = true;

  const client = await pool.connect()

  const result = await client
    .query(query, queryArguments)
    .then(res => {
      return res
    })
    .catch((e) => {
      success = false;
      return e;
    }
    )

  client.release(true)

  if (success) return result;
  else throw result;
}

const fetchTickersFromHoldings = async (pool: Pool) => {
  const result = await sqlQuery({
    pool,
    query: sql.getAllTickers,
    queryArguments: []
  })

  return result.rows.map((row: { ticker: string }) => (row.ticker))
}

const updateOrInsertPortfolio = async (pool: Pool, userId: string, value: number) => {
  const result = await sqlQuery({
    pool,
    query: sql.updateOrInsertPortfolio,
    queryArguments: [userId, value]
  })
}

const getHoldingsFromUsers = async (pool: Pool) => {
  const result: HoldingsInterface[] = (await sqlQuery({
    pool,
    query: sql.getAllHoldings,
    queryArguments: []
  })).rows

  return result;
}

const getAllUsers = async (pool: Pool) => {
  const result = (await sqlQuery({
    pool,
    query: sql.getAllUsers,
    queryArguments: []
  })).rows;
  const userList = result.map((row: { user_id: number, cash: number }) => [row.user_id, row.cash]);
  return new Map<number, number>(userList)
}

const getMultipleTickersAsMap = async (tickers: string[]) => {
  if (tickers.length === 0) return new Map();
  try {
    const result = await yahooFinance.quote(tickers, { return: 'map' });
    return result;
  } catch (err) {
    if (isYHError(err)) {
      console.log(err.errors);
      return {
        ...err.result,
      }
    }
    return null
  }
}

export const handler = async (event: APIGatewayEvent, context: Context): Promise<APIGatewayProxyResult> => {
  const pool = new Pool(config);
  const tickers = await fetchTickersFromHoldings(pool);

  const tickersInfo = await getMultipleTickersAsMap(tickers)

  if (!tickersInfo) {
    throw new Error("Error retrieving tickers");
  }

  const holdings = await getHoldingsFromUsers(pool);

  let holdingsValue: HoldingsValueInterface = {};

  holdings.forEach((holdingsRow) => {
    const { user_id: userId, ticker, quantity: quantityString } = holdingsRow;
    const quantity = parseInt(quantityString);

    if ((userId in holdingsValue) === false) {
      holdingsValue = { ...holdingsValue, [userId]: 0 }
    }

    let price: number = 0;
    if (tickersInfo.has(ticker) && tickersInfo.get(ticker).regularMarketPrice) {
      price = tickersInfo.get(ticker).regularMarketPrice
    } else {
      console.log("Warning: unknown ticker or price");
      console.log(ticker)
      console.log(tickersInfo);
    }
    holdingsValue[userId] += price * quantity
  })

  const userMap = await getAllUsers(pool);

  for (const userId in holdingsValue) {
    const cash: number = userMap.has(parseInt(userId)) ? userMap.get(parseInt(userId))! : 0;
    await updateOrInsertPortfolio(pool, userId, holdingsValue[userId] + cash);
    userMap.delete(parseInt(userId));
    console.log("Update user with id " + userId.toString());
  }

  userMap.forEach(async (value: number, key: number) => {
    await updateOrInsertPortfolio(pool, key.toString(), value)
    console.log("Update user with id " + key.toString());
  })
  console.log("completed");
  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'completed',
    }),
  };
}