import { useMemo } from 'preact/hooks';
import { renderSVG } from 'uqr';
import { host } from '../../net/host';
import { joinUrl } from '../../net/protocol';
import { game } from '../store';

const STATUS_LABEL = { connecting: 'łączenie…', open: 'online', closed: 'brak połączenia' } as const;

function Qr(props: { url: string; label: string }) {
  const svg = useMemo(() => renderSVG(props.url, { border: 1 }), [props.url]);
  return <div class="qr" role="img" aria-label={props.label} dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** Modal for the table device: room code, a QR per player tile, seat status. Never rotated. */
export function ConnectSheet(props: { onClose: () => void }) {
  const g = game.value;
  const code = host.room.value;
  const status = host.status.value;
  if (!g) return null;
  // location.href (not just origin) so the link keeps a sub-path when the app is not served at the root.
  const urlFor = (seat?: string) => joinUrl(location.href.split(/[?#]/)[0], import.meta.env.BASE_URL, code!, seat);
  const stop = () => { host.stopHosting(); props.onClose(); };

  return (
    <div class="overlay center" onClick={props.onClose}>
      <div class="sheet connect" role="dialog" aria-label="Połącz telefony" style={{ '--pc': 'var(--accent)' }} onClick={(e) => e.stopPropagation()}>
        <div class="sheet-head">
          <b>📱 Połącz telefony</b>
          <span class={`conn-dot ${status}`} title={STATUS_LABEL[status]} />
          <button class="btn" onClick={props.onClose}>Gotowe</button>
        </div>
        {!code ? (
          <p class="hint">Łączenie z serwerem… ({STATUS_LABEL[status]})</p>
        ) : (
          <>
            <p class="hint">Gracze skanują swój kod QR aparatem telefonu albo wpisują kod pokoju.</p>
            <div class="room-code" aria-label="Kod pokoju">{code}</div>
            <div class="qr-grid">
              {g.players.map((p) => {
                const cid = host.seats.value[p.id];
                const peer = cid ? host.peers.value.get(cid) : undefined;
                const online = !!peer?.online;
                return (
                  <div key={p.id} class="qr-card" style={{ '--pc': p.color }} data-player={p.id}>
                    <div class="qr-name"><span class="dot" style={{ background: p.color }} />{p.name}</div>
                    <Qr url={urlFor(p.id)} label={`Kod QR gracza ${p.name}`} />
                    <div class={`qr-status${cid ? (online ? ' on' : ' off') : ''}`}>
                      {!cid ? 'wolny' : online ? `połączony${peer?.name ? `: ${peer.name}` : ''}` : 'offline'}
                    </div>
                    {cid && <button class="btn" onClick={() => host.releaseSeat(p.id)}>Zwolnij</button>}
                  </div>
                );
              })}
              <div class="qr-card generic">
                <div class="qr-name">Dowolne miejsce</div>
                <Qr url={urlFor()} label="Kod QR bez wybranego gracza" />
                <div class="qr-status">gracz wybiera sam</div>
              </div>
            </div>
          </>
        )}
        <div class="toggles">
          <button class="btn danger" onClick={stop}>Zakończ udostępnianie</button>
        </div>
      </div>
    </div>
  );
}
