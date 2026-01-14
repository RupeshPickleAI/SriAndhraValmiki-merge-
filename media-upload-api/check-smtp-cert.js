// check-smtp-cert.js
const tls = require("tls");

const socket = tls.connect(
  465,
  "smtp.gmail.com",
  {
    servername: "smtp.gmail.com",

    // ✅ allow handshake even if chain is untrusted (ONLY for inspection)
    rejectUnauthorized: false,
  },
  () => {
    const cert = socket.getPeerCertificate(true);

    console.log("✅ Connected (verification disabled for inspection)");
    console.log("Subject:", cert.subject);
    console.log("Issuer:", cert.issuer);
    console.log("Valid From:", cert.valid_from);
    console.log("Valid To:", cert.valid_to);
    console.log("Fingerprint:", cert.fingerprint);

    // Print the full chain by walking issuerCertificate
    let i = 0;
    let c = cert;
    while (c) {
      console.log("\n--- CERT", i, "---");
      console.log("Subject:", c.subject);
      console.log("Issuer:", c.issuer);
      if (!c.issuerCertificate || c.issuerCertificate === c) break;
      c = c.issuerCertificate;
      i += 1;
      if (i > 10) break;
    }

    socket.end();
  }
);

socket.on("error", (e) => {
  console.error("TLS error:", e.message);
});
