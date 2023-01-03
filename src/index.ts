import type { Server } from 'http';
import express from 'express';
import path from 'path';
import v1SendRawEmail from './v1/sendRawEmail';
import v1SendEmail from './v1/sendEmail';
import v1SendTemplatedEmail from './v1/sendTemplatedEmail';
import v2SendEmail from './v2/sendEmail';
import store from './store';

export interface Config {
  port: number,
  templatesPath?: string,
  templatesDir?: string,
}

export const defaultConfig: Config = {
  port: 8005,
  templatesDir: 'email-templates',
};

const server = (partialConfig: Partial<Config> = {}): Promise<Server> => {
  const config: Config = {
    ...defaultConfig,
    ...partialConfig,
  };

  const app = express();
  app.use(express.json({ limit: '25mb' }));
  app.use(express.urlencoded({ extended: false, limit: '25mb' }));

  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../static/index.html'));
  });

  app.post('/clear-store', (req, res) => {
    store.emails = [];
    res.status(200).send({ message: 'Emails cleared' });
  });

  app.get('/store', (req, res) => {
    if (!req.query.since) {
      res.status(200).send(store);
      return;
    }

    if (typeof req.query.since !== 'string') {
      res.status(400).send({ message: 'Bad since query param, expected single value' });
    }

    const since = parseInt(req.query.since as string, 10);
    if (Number.isNaN(since) || req.query.since !== String(since)) {
      res.status(400).send({ message: 'Bad since query param, expected integer representing epoch timestamp in seconds' });
    }

    res.status(200).send({ ...store, emails: store.emails.filter((e) => e.at >= since) });
  });

  app.get('/health-check', (req, res) => {
    res.status(200).send();
  });

  app.use((req, res, next) => {
    const authHeader = req.header('authorization');
    if (!authHeader) {
      res.status(403).send({ message: 'Missing Authentication Token', detail: 'aws-ses-v2-local: Must provide some type of authentication, even if only a mock access key' });
      return;
    }
    if (!authHeader.startsWith('AWS')) {
      res.status(400).send({ message: 'Not Authorized', detail: 'aws-ses-v2-local: Authorization type must be AWS' });
      return;
    }
    next();
  });

  app.post('/', (req, res, next) => {
    try {
      switch (req.body.Action) {
        case 'SendEmail':
          v1SendEmail(req, res, next);
          break;
        case 'SendRawEmail':
          v1SendRawEmail(req, res, next);
          break;
        case 'SendTemplatedEmail':
          res.locals.templateDir = config.templatesDir;
          res.locals.templatesPath = config.templatesPath;
          v1SendTemplatedEmail(req, res, next);
          break;
        default:
          console.log(`Endpoint ${req.body.Action} not supported. Consider making a PR to https://github.com/domdomegg/aws-ses-v2-local to add support.`);
      }
    } catch (e) {
      console.log(`Error calling ${req.body.Action}`, e);
      res.status(500).send(`<?xml version="1.0" encoding="UTF-8"?>
<Error>
  <Code>500</Code>
  <Message>${e}</Message>
</Error>`);
    }
  });

  app.post('/v2/email/outbound-emails', v2SendEmail);

  app.use((req, res) => {
    res.status(404).send('<UnknownOperationException/>');
  });

  return new Promise((resolve) => {
    const s = app.listen(config.port, () => resolve(s));
  });
};

export default server;
