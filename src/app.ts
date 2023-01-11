import * as dotenv from 'dotenv'
import { Pool, PoolConfig } from 'pg';


dotenv.config()

/*
  Strategy:
  - Fetch all tickers from the Database
  - Get price of all tickers from Yahoo Finance
  - Update back to the Database
*/

const config: PoolConfig = {
  connectionString: `postgres://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_DATABASE}?options`,
}

const fetchTickersFromHoldings = () => {

}


const main = () => {

}

main();
