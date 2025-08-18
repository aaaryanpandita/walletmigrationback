import pg from 'pg';
import dotenv from 'dotenv';
import config from '../config/config.json' with { type: 'json' };


const stagingConfig = config.development;

dotenv.config();
const { Pool } = pg;

const pool = new Pool({
    user: stagingConfig.DB_USER,
    host: stagingConfig.DB_HOST,
    database: stagingConfig.DB_NAME,
    password: stagingConfig.DB_PASSWORD,
    port: stagingConfig.DB_PORT
});

export const connect = () => pool.connect();
export const query = (text, params) => pool.query(text, params);

export default pool;
