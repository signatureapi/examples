<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Acme Corp: sign your Service Agreement</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 860px; margin: 2rem auto; padding: 0 1rem; }
    iframe { width: 100%; height: 640px; border: 1px solid #ccc; border-radius: 8px; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <h1>Sign your Service Agreement</h1>
  <form id="start">
    <label>Name <input name="name" value="Jane Doe" required></label>
    <label>Email <input name="email" type="email" value="jane.doe@example.com" required></label>
    <button>Start signing</button>
  </form>
  <p id="status"></p>
  <p><a id="download" class="hidden">Download the signed PDF</a></p>
  <iframe id="signatureapi-ceremony" class="hidden" title="SignatureAPI Signing Ceremony"></iframe>
  <script>
    const CEREMONY_ORIGIN = 'https://sign.signatureapi.com';
    const iframe = document.getElementById('signatureapi-ceremony');
    const status = document.getElementById('status');
    let envelopeId = null;

    document.getElementById('start').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(event.target);
      const response = await fetch('/api/contracts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.get('name'), email: form.get('email') }),
      });
      const body = await response.json();
      if (!response.ok) { status.textContent = body.error; return; }
      envelopeId = body.envelopeId;
      // Both query parameters are required for an embedded ceremony.
      const src = new URL(body.ceremonyUrl);
      src.searchParams.set('embedded', 'true');
      src.searchParams.set('event_delivery', 'message');
      iframe.src = src.toString();
      iframe.classList.remove('hidden');
    });

    window.addEventListener('message', async (event) => {
      // Accept messages only from the ceremony iframe.
      if (event.origin !== CEREMONY_ORIGIN || event.source !== iframe.contentWindow) return;
      if (event.data.type === 'ceremony.completed') {
        iframe.classList.add('hidden');
        // The browser event is a UI signal. Confirm on your server before you act on it.
        const response = await fetch(`/api/contracts/${envelopeId}`);
        const body = await response.json();
        status.textContent = `Thanks! Envelope status: ${body.status}`;
        // The signed PDF is ready a few seconds after completion. Your server streams it (step 5).
        const download = document.getElementById('download');
        download.href = `/api/contracts/${envelopeId}/signed.pdf`;
        download.classList.remove('hidden');
      } else if (event.data.type === 'ceremony.canceled') {
        status.textContent = 'Signing canceled. You can start again any time.';
      } else if (event.data.type === 'ceremony.failed') {
        status.textContent = `Signing failed: ${event.data.error_message}`;
      }
    });
  </script>
</body>
</html>
