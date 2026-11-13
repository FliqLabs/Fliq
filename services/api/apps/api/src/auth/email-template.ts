const BG = "#050510";
const CARD = "#0c0c1f";
const BORDER = "#1d1d42";
const ACCENT = "#6366f1";
const MUTED = "#9a9ac0";

export const SIGN_IN_SUBJECT = "Your fliq sign-in link";

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderSignInEmail(link: string, expiresInMinutes: number) {
  const href = escape(link);
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${SIGN_IN_SUBJECT}</title>
</head>
<body style="margin:0;padding:0;background:${BG};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${BG};">Tap to sign in to fliq. This link works once.&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BG}" style="background:${BG};">
<tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

    <tr><td style="padding:0 4px 20px;font-size:26px;font-weight:800;letter-spacing:-0.5px;color:#ffffff;">fliq<span style="color:${ACCENT};">.</span></td></tr>

    <tr><td bgcolor="${CARD}" style="background:${CARD};border:1px solid ${BORDER};border-radius:20px;padding:40px 36px 36px;">

      <div style="font-size:12px;letter-spacing:3px;text-transform:uppercase;color:${ACCENT};font-weight:700;padding-bottom:14px;">Sign in</div>
      <h1 style="margin:0 0 16px;font-size:32px;line-height:38px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">Welcome back.</h1>
      <p style="margin:0 0 28px;font-size:16px;line-height:25px;color:#d6d6ee;">
        Tap the button to sign in to <strong style="color:#ffffff;">fliq</strong>. No password needed.
      </p>

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px;">
        <tr><td bgcolor="${ACCENT}" style="background:${ACCENT};border-radius:12px;">
          <a href="${href}" style="display:inline-block;padding:15px 32px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;">Sign in to fliq</a>
        </td></tr>
      </table>

      <p style="margin:0 0 20px;font-size:14px;line-height:22px;color:${MUTED};">
        This link works once and expires in ${expiresInMinutes} minutes. If you did not ask for it, you can safely ignore this email.
      </p>
      <p style="margin:0;font-size:12px;line-height:19px;color:#6d6d96;word-break:break-all;">
        Button not working? Paste this into your browser:<br>
        <a href="${href}" style="color:#c7c8ff;">${href}</a>
      </p>

    </td></tr>

    <tr><td align="center" style="padding:28px 16px 0;">
      <div style="font-size:11px;letter-spacing:4px;text-transform:uppercase;color:#6d6d96;">Global crypto. Local money.</div>
      <div style="font-size:12px;line-height:19px;color:#55557a;padding-top:14px;">© ${new Date().getFullYear()} fliq. All rights reserved.</div>
    </td></tr>

  </table>
</td></tr>
</table>
</body>
</html>`;

  const text = `Welcome back.

Sign in to fliq: ${link}

This link works once and expires in ${expiresInMinutes} minutes. If you did not ask for it, ignore this email.

GLOBAL CRYPTO. LOCAL MONEY.`;

  return { subject: SIGN_IN_SUBJECT, html, text };
}
