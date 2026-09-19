'use client';

/** Last-resort boundary (root layout failed): no providers available here, so no i18n — bilingual static copy. */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="it">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: '#0A1220',
          color: '#E8EDF5',
          fontFamily: 'system-ui, sans-serif',
          textAlign: 'center',
          padding: 24,
        }}
      >
        <div>
          <h1 style={{ fontSize: 24 }}>Rescue Control</h1>
          <p style={{ color: '#A3B0C4' }}>Qualcosa è andato storto · Something went wrong</p>
          <button
            onClick={reset}
            style={{
              marginTop: 16,
              height: 44,
              padding: '0 20px',
              borderRadius: 10,
              border: 0,
              background: '#E5202A',
              color: '#fff',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Riprova · Retry
          </button>
        </div>
      </body>
    </html>
  );
}
