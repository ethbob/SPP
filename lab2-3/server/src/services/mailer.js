// Отправка писем. В Docker письма уходят в Mailpit (тестовый SMTP-сервер с веб-интерфейсом
// на http://localhost:8025), в тестах — никуда не уходят, а складываются в массив sent.
const nodemailer = require('nodemailer');
const config = require('../config');

const transport = config.isTest
  ? nodemailer.createTransport({ jsonTransport: true })
  : nodemailer.createTransport({ host: config.mail.host, port: config.mail.port, secure: false });

const sent = [];

async function sendMail({ to, subject, text, html }) {
  const info = await transport.sendMail({ from: config.mail.from, to, subject, text, html });
  if (config.isTest) sent.push({ to, subject, text });
  return info;
}

function passwordResetEmail(name, link, ttlMinutes) {
  return {
    subject: 'Восстановление доступа',
    text:
      `Здравствуйте, ${name}!\n\n` +
      `Чтобы задать новый пароль, перейдите по ссылке (действует ${ttlMinutes} минут):\n${link}\n\n` +
      'Если вы не запрашивали восстановление, просто проигнорируйте это письмо.',
    html:
      `<p>Здравствуйте, ${escapeHtml(name)}!</p>` +
      `<p>Чтобы задать новый пароль, перейдите по ссылке (действует ${ttlMinutes} минут):</p>` +
      `<p><a href="${link}">${link}</a></p>` +
      '<p>Если вы не запрашивали восстановление, просто проигнорируйте это письмо.</p>',
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

module.exports = { sendMail, passwordResetEmail, sent };
