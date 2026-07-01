const { Resend } = require('resend');

let resendClient = null;
function getClient() {
  if (!process.env.RESEND_API_KEY) return null;
  if (!resendClient) resendClient = new Resend(process.env.RESEND_API_KEY);
  return resendClient;
}

/**
 * Sends a "book finished" notification to both the author and the admin.
 * If RESEND_API_KEY isn't configured (e.g. during local dev), this logs
 * instead of throwing — a missing email config shouldn't break the
 * finish-book flow, since the PDF itself is the important deliverable.
 */
async function sendBookFinishedEmails({ authorEmail, authorName, bookId, pdfStoragePath }) {
  const client = getClient();
  const adminEmail = process.env.NOTIFY_ADMIN_EMAIL;

  if (!client) {
    console.log(
      `[email stub] Would notify ${authorEmail} and ${adminEmail} that book ${bookId} is finished.`
    );
    return;
  }

  const subject = `${authorName}'s "My Story" book is ready`;
  const html = `
    <p>Hi ${authorName},</p>
    <p>Congratulations — your "My Story" book is complete and your PDF has been generated.</p>
    <p>Log back in to download it any time.</p>
  `;

  await client.emails.send({
    from: 'My Story <noreply@yourdomain.com>',
    to: authorEmail,
    subject,
    html,
  });

  if (adminEmail) {
    await client.emails.send({
      from: 'My Story <noreply@yourdomain.com>',
      to: adminEmail,
      subject: `${authorName} has finished their book`,
      html: `<p>${authorName} (${authorEmail}) has finished their "My Story" book. You can view/download it from the admin dashboard.</p>`,
    });
  }
}

module.exports = { sendBookFinishedEmails };
