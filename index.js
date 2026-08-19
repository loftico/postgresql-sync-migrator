const { spawn } = require('child_process');
const fs = require('fs');
const { startCronJob } = require('./lib/cron');
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;
const { sendDiscordMessage } = require('./lib/discord');
const { createLogger } = require('./lib/logger');
const logger = createLogger();
require('dotenv').config();
const path = require('path');

app.get('/', (req, res) => {
    res.send('Up and running')
})

app.listen(port, () => {
    logger.info(`PostgreSQL Sync Migrator listening on port ${port}`);
})

const sourceDbString = process.env.DATABASE_URL_SOURCE;
const targetDbString = process.env.DATABASE_URL_TARGET;
const backupFile = `${new Date().toISOString()}.sql`;

const retry = (fn, retriesLeft = 3, interval = 10000) => {
    while (retriesLeft) {
        try {
            fn();
            return;
        } catch (error) {
            logger.error(`Error: ${error}`);
            retriesLeft--;
            if (retriesLeft) {
                logger.warn(`Retrying in ${interval}ms: ${error}`);
                setTimeout(() => { }, interval);
            }
            if (retriesLeft === 0) {
                sendDiscordMessage(`Retries exhausted, giving up: ${error}`);
                logger.error(`Retries exhausted, giving up: ${error}`);
                return;
            }
        }
    }
};

const createBackup = () => {
    sendDiscordMessage(`Source DB backup is being created`);
    logger.info(`Source DB backup is being created`);
    logger.debug(`Source DB ${sourceDbString} backup is being created at ${backupFile}`);

   const pg_dump = spawn('pg_dump', ['--dbname=' + sourceDbString, '--clean', '--if-exists', '--no-owner', '--no-acl', '-f', backupFile]);
    
    pg_dump.stdout.on('data', (data) => {
        logger.debug(`Source DB backup stdout: ${data}`);
    });

    pg_dump.stderr.on('data', (data) => {

        if (data.includes('warning')) {
            logger.warn(`Source DB backup stderr: ${data}`);
            return;
        }

        sendDiscordMessage(`Error creating Source DB backup`);
        logger.error(`Source DB backup stderr: ${data}`);
        throw new Error(`pg_dump encountered an error: ${data}`);
    });

    pg_dump.stdin.on('data', (data) => {
        logger.debug(`Source DB backup stdin: ${data}`);
    });

    pg_dump.on('exit', (code) => {
        if (code === 0) {
            logger.info('Process pg_dump terminated successfully');
        } else {
            logger.info('Process pg_dump terminated with code', code);
        }
    });

    pg_dump.on('close', (code) => {

        pg_dump.stdin.pause();
        pg_dump.stderr.pause();
        pg_dump.stdin.pause();
        pg_dump.kill();

        if (code === 0) {
            logger.info(`Source DB backup created successfully`);
            logger.debug(`Source DB backup created at ${backupFile} successfully`);
            sendDiscordMessage(`Source DB backup created successfully`);
            dropAllTables();
        } else {
            sendDiscordMessage(`Error creating Source DB backup`);
            throw new Error(`Error creating Source DB backup. Exit code: ${code}`);
        }
    });
};

const dropAllTables = () => {
    const psql = spawn('psql', ['--dbname=' + targetDbString, '-c', 'DROP SCHEMA entity_audit CASCADE; DROP SCHEMA comments CASCADE; DROP SCHEMA book_keeping CASCADE; DROP SCHEMA templates CASCADE; DROP SCHEMA documents CASCADE; DROP SCHEMA communication CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE SCHEMA communication; CREATE SCHEMA documents; CREATE SCHEMA templates; CREATE SCHEMA book_keeping; CREATE SCHEMA comments; CREATE SCHEMA entity_audit;']);

    psql.stdout.on('data', (data) => {
        logger.debug(`Drop all tables stdout: ${data}`);
    });

    psql.stderr.on('data', (data) => {
        logger.error(`Drop all tables stderr: ${data}`);
        sendDiscordMessage(`Error dropping all tables`);
        throw new Error(`psql encountered an error: ${data}`);
    });

    psql.stdin.on('data', (data) => {
        logger.debug(`Drop all tables stdin: ${data}`);
    });

    psql.on('exit', (code) => {
        if (code === 0) {
            logger.info('Process psql terminated successfully');
        } else {
            logger.info('Process psql terminated with code', code);
        }
    });

    psql.on('close', (code) => {

        psql.stdin.pause();
        psql.stderr.pause();
        psql.stdin.pause();
        psql.kill();

        if (code === 0) {
            logger.info(`All tables dropped successfully`);
            sendDiscordMessage(`All tables dropped successfully`);
            restoreDb();
        } else {
            sendDiscordMessage(`Error dropping all tables`);
            throw new Error(`Error dropping all tables. Exit code: ${code}`);
        }
    });
};

const restoreDb = () => {
    sendDiscordMessage(`Target DB is being restored with Source DB backup`);
    logger.info(`Target DB is being restored with Source DB backup`);
    logger.debug(`Target DB ${targetDbString} is being restored with Source DB backup ${backupFile}`);
    const psql = spawn('psql', ['--dbname=' + targetDbString, '-f', backupFile]);

    psql.stdout.on('data', (data) => {
        logger.debug(`Target DB restore stdout: ${data}`);
    });

    psql.stderr.on('data', (data) => {

        if (data.includes('warning')) {
            logger.warn(`Source DB backup stderr: ${data}`);
            return;
        }

        logger.error(`Target DB restore stderr: ${data}`);
        sendDiscordMessage(`Error restoring to Target DB`);
        throw new Error(`psql encountered an error: ${data}`);
    });

    psql.stdin.on('data', (data) => {
        logger.debug(`Target DB restore stdin: ${data}`);
    });

    psql.on('exit', (code) => {
        if (code === 0) {
            logger.info('Process psql terminated successfully');
        } else {
            logger.info('Process psql terminated with code', code);
        }
    });

    psql.on('close', (code) => {

        psql.stdin.pause();
        psql.stderr.pause();
        psql.stdin.pause();
        psql.kill();

        if (code === 0) {
            logger.info(`Target DB restored with Source DB backup successfully`);
            logger.debug(`Target DB ${targetDbString} restored with Source DB backup ${backupFile} successfully`);
            sendDiscordMessage(`Target DB restored with Source DB backup successfully`);
            removeBackup();
        } else {
            sendDiscordMessage(`Error restoring to Target DB`);
            throw new Error(`Error restoring to Target DB. Exit code: ${code}`);
        }
    });
};

const removeBackup = () => {
    fs.unlink(backupFile, (err) => {
        if (err) {
            logger.error(`Error deleting backup file: ${err}`);
        } else {
            logger.info(`Backup file ${backupFile} deleted`);
        }
    });
};

const run = () => {
    if (process.env.FAILOVER_RETRIES && process.env.FAILOVER_RETRY_DELAY_MS) {
        sendDiscordMessage(`Going to retry ${process.env.FAILOVER_RETRIES} times with ${process.env.FAILOVER_RETRY_DELAY_MS}ms delay`)
        logger.info(`Going to retry ${process.env.FAILOVER_RETRIES} times with ${process.env.FAILOVER_RETRY_DELAY_MS}ms delay`);
        retry(createBackup, process.env.FAILOVER_RETRIES, process.env.FAILOVER_RETRY_DELAY_MS);
    } else {
        sendDiscordMessage(`Going to retry 3 times with 10000ms delay`)
        logger.info(`Going to retry 3 times with 10000ms delay`);
        retry(createBackup);
    }
};

startCronJob(process.env.SCHEDULE_TIME, process.env.SCHEDULE_TIMEZONE, () => {
    logger.info(`Running scheduled job`);
    sendDiscordMessage(`Running scheduled job`);
    run();
}, 60 * 1000);

if (process.env.RUN_ON_STARTUP === 'true') {
    logger.info(`Running on startup`);
    sendDiscordMessage(`Running on startup`);
    run();
}
