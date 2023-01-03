import path from 'path';
import fs from 'fs';
import type { RequestHandler } from 'express';
import type { JSONSchema7 } from 'json-schema';
import ajv from '../ajv';
import store from '../store';

const handler: RequestHandler = async (req, res) => {
  const valid = validate(req.body);
  if (!valid) {
    res.status(404).send({ message: 'Bad Request Exception', detail: 'aws-ses-v2-local: Schema validation failed' });
    return;
  }

  const messageId = `ses-${Math.floor(Math.random() * 900000000 + 100000000)}`;

  // TODO: deal w this...
  const templatePath = res.locals.templatesPath
    ? path.join('/sls-offline/', res.locals.templatesPath, `${req.body.Template}.json`)
    : `${__dirname.replace('/src/v1', '/test')}/${res.locals.templateDir}/${req.body.Template}.json`;

  const template = JSON.parse(fs.readFileSync(templatePath).toString());

  const html = template.Body.Html;
  const text = template.Body.Text;

  const templateData = JSON.parse(req.body.TemplateData);

  Object.keys(templateData).forEach((key) => {
    html.Data = html.Data.replace(new RegExp(`{{${key}}}`, 'g'), templateData[key]);
    text.Data = text.Data.replace(new RegExp(`{{${key}}}`, 'g'), templateData[key]);
  });

  store.emails.push({
    messageId,
    from: req.body.Source,
    replyTo: Object.keys(req.body).filter((k) => k.startsWith('ReplyToAddresses.member.')).map((k) => req.body[k]),
    destination: {
      to: Object.keys(req.body).filter((k) => k.startsWith('Destination.ToAddresses.member.')).map((k) => req.body[k]),
      cc: Object.keys(req.body).filter((k) => k.startsWith('Destination.CcAddresses.member.')).map((k) => req.body[k]),
      bcc: Object.keys(req.body).filter((k) => k.startsWith('Destination.BccAddresses.member.')).map((k) => req.body[k]),
    },
    subject: template.Subject.Data,
    body: {
      text,
      html,
    },
    attachments: [],
    at: Math.floor(new Date().getTime() / 1000),
  });

  res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<SendTemplatedEmailResponse xmlns="http://ses.amazonaws.com/doc/2010-12-01/">
  <SendTemplatedEmailResult>
    <MessageId>${messageId}</MessageId>
  </SendTemplatedEmailResult>
</SendTemplatedEmailResponse>`);
};

export default handler;

const sendTemplatedEmailRequestSchema: JSONSchema7 = {
  type: 'object',
  properties: {
    Action: { type: 'string', pattern: '^SendTemplatedEmail$' },
    Version: { type: 'string' },

    ConfigurationSetName: { type: 'string' },
    'Destination.ToAddresses.member.1': { type: 'string' },
    'Destination.CcAddresses.member.1': { type: 'string' },
    'Destination.BccAddresses.member.1': { type: 'string' },
    'ReplyToAddresses.member.1': { type: 'string' },
    ReturnPath: { type: 'string' },
    ReturnPathArn: { type: 'string' },
    Source: { type: 'string' },
    SourceArn: { type: 'string' },
    'Tags.member.1': { type: 'string' },
    Template: { type: 'string' },
    TemplateData: { type: 'string' },
  },
  required: ['Action', 'Source', 'Template', 'TemplateData'],
};

const validate = ajv.compile(sendTemplatedEmailRequestSchema);
