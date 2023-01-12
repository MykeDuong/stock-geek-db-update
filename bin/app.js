"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const dotenv = __importStar(require("dotenv"));
const pg_1 = require("pg");
const yahoo_finance2_1 = __importDefault(require("yahoo-finance2"));
/*
  Strategy:
  - Fetch all tickers from the Database
  - Get price of all tickers from Yahoo Finance
  - Update back to the Database
*/
// Configurations and Constants
dotenv.config();
const config = {
    connectionString: `postgres://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_DATABASE}?options`,
};
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
};
function isYHError(value) {
    return (!!value && !!value.result && !!value.errors);
}
const sqlQuery = (props) => __awaiter(void 0, void 0, void 0, function* () {
    const { pool, query, queryArguments } = props;
    let success = true;
    const client = yield pool.connect();
    const result = yield client
        .query(query, queryArguments)
        .then(res => {
        return res;
    })
        .catch((e) => {
        success = false;
        return e;
    });
    client.release(true);
    if (success)
        return result;
    else
        throw result;
});
const fetchTickersFromHoldings = (pool) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield sqlQuery({
        pool,
        query: sql.getAllTickers,
        queryArguments: []
    });
    return result.rows.map((row) => (row.ticker));
});
const updateOrInsertPortfolio = (pool, userId, value) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield sqlQuery({
        pool,
        query: sql.updateOrInsertPortfolio,
        queryArguments: [userId, value]
    });
});
const getHoldingsFromUsers = (pool) => __awaiter(void 0, void 0, void 0, function* () {
    const result = (yield sqlQuery({
        pool,
        query: sql.getAllHoldings,
        queryArguments: []
    })).rows;
    return result;
});
const getAllUsers = (pool) => __awaiter(void 0, void 0, void 0, function* () {
    const result = (yield sqlQuery({
        pool,
        query: sql.getAllUsers,
        queryArguments: []
    })).rows;
    const userList = result.map((row) => [row.user_id, row.cash]);
    return new Map(userList);
});
const getMultipleTickersAsMap = (tickers) => __awaiter(void 0, void 0, void 0, function* () {
    if (tickers.length === 0)
        return new Map();
    try {
        const result = yield yahoo_finance2_1.default.quote(tickers, { return: 'map' });
        return result;
    }
    catch (err) {
        if (isYHError(err)) {
            console.log(err.errors);
            return Object.assign({}, err.result);
        }
        return null;
    }
});
const handler = (event, context) => __awaiter(void 0, void 0, void 0, function* () {
    const pool = new pg_1.Pool(config);
    const tickers = yield fetchTickersFromHoldings(pool);
    const tickersInfo = yield getMultipleTickersAsMap(tickers);
    if (!tickersInfo) {
        throw new Error("Error retrieving tickers");
    }
    const holdings = yield getHoldingsFromUsers(pool);
    let holdingsValue = {};
    holdings.forEach((holdingsRow) => {
        const { user_id: userId, ticker, quantity: quantityString } = holdingsRow;
        const quantity = parseInt(quantityString);
        if ((userId in holdingsValue) === false) {
            holdingsValue = Object.assign(Object.assign({}, holdingsValue), { [userId]: 0 });
        }
        let price = 0;
        if (tickersInfo.has(ticker) && tickersInfo.get(ticker).regularMarketPrice) {
            price = tickersInfo.get(ticker).regularMarketPrice;
        }
        else {
            console.log("Warning: unknown ticker or price");
            console.log(ticker);
            console.log(tickersInfo);
        }
        holdingsValue[userId] += price * quantity;
    });
    const userMap = yield getAllUsers(pool);
    for (const userId in holdingsValue) {
        const cash = userMap.has(parseInt(userId)) ? userMap.get(parseInt(userId)) : 0;
        yield updateOrInsertPortfolio(pool, userId, holdingsValue[userId] + cash);
        userMap.delete(parseInt(userId));
        console.log("Update user with id " + userId.toString());
    }
    userMap.forEach((value, key) => __awaiter(void 0, void 0, void 0, function* () {
        yield updateOrInsertPortfolio(pool, key.toString(), value);
        console.log("Update user with id " + key.toString());
    }));
    console.log("completed");
    return {
        statusCode: 200,
        body: JSON.stringify({
            message: 'completed',
        }),
    };
});
exports.handler = handler;
