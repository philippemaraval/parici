const test = require("node:test"),
  assert = require("node:assert/strict"),
  net = require("node:net");
test(
  "password recovery sends a real SMTP message to an isolated local receiver",
  { timeout: 15000 },
  async (t) => {
    let message = "";
    const connections = new Set();
    const server = net.createServer((socket) => {
      connections.add(socket);
      socket.on("close", () => connections.delete(socket));
      socket.write("220 local-test ESMTP\r\n");
      let pending = "",
        data = false;
      socket.on("data", (chunk) => {
        pending += chunk.toString();
        let index;
        while ((index = pending.indexOf("\r\n")) >= 0) {
          const line = pending.slice(0, index);
          pending = pending.slice(index + 2);
          if (data) {
            if (line === ".") {
              data = false;
              socket.write("250 accepted locally\r\n");
            } else message += line + "\n";
            continue;
          }
          if (/^EHLO|^HELO/.test(line))
            socket.write("250-local-test\r\n250 AUTH PLAIN\r\n");
          else if (/^AUTH /.test(line)) socket.write("235 authenticated\r\n");
          else if (/^MAIL FROM:|^RCPT TO:|^RSET/.test(line))
            socket.write("250 OK\r\n");
          else if (line === "DATA") {
            data = true;
            socket.write("354 Send message\r\n");
          } else if (line === "QUIT") socket.end("221 Goodbye\r\n");
          else socket.write("250 OK\r\n");
        }
      });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const values = {
      MAIL_PROVIDER: "smtp",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: String(server.address().port),
      SMTP_SECURE: "false",
      SMTP_USER: "local-sender@example.invalid",
      SMTP_PASS: "local-test-only",
      MAIL_FROM: "Parici <local-sender@example.invalid>",
    };
    const original = Object.fromEntries(
      Object.keys(values).map((k) => [k, process.env[k]]),
    );
    Object.assign(process.env, values);
    const modulePath = require.resolve("../../backend/mailer");
    delete require.cache[modulePath];
    t.after(async () => {
      for (const [k, v] of Object.entries(original))
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      delete require.cache[modulePath];
      connections.forEach((socket) => socket.destroy());
      await new Promise((resolve) => server.close(resolve));
    });
    const sent = await require("../../backend/mailer").sendPasswordResetEmail({
      to: "local-recipient@example.invalid",
      username: "Joueur",
      resetUrl: "http://localhost/reset-password.html?token=local-test",
      expiresInHours: 1,
    });
    assert.deepEqual(sent.accepted, ["local-recipient@example.invalid"]);
    assert.match(message, /reset-password/);
    assert.match(message, /multipart\/alternative/);
    assert.match(message, /Parici/);
  },
);
