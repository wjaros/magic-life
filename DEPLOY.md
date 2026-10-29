# Wdrożenie na własny serwer (Docker + Nginx Proxy Manager)

Jeden kontener serwuje aplikację i WebSocket (`/ws`) do gry na kilku telefonach.
HTTPS (certyfikat SSL) robi Nginx Proxy Manager.

## 1. Kontener

```bash
git clone https://github.com/wjaros/magic-life.git
cd magic-life
# nazwa sieci, w której działa kontener Nginx Proxy Manager (docker network ls)
export PROXY_NETWORK=npm_default
docker compose up -d --build
```

Aktualizacja: `git pull && docker compose up -d --build`.

## 2. Nginx Proxy Manager

Hosts → Proxy Hosts → Add Proxy Host:

| Pole | Wartość |
|---|---|
| Domain Names | `mtg.twojadomena.pl` |
| Scheme | `http` |
| Forward Hostname / IP | `magic-life` (nazwa usługi z docker-compose) |
| Forward Port | `8080` |
| Websockets Support | **włączone** |
| Block Common Exploits | włączone |

Zakładka **SSL**: Request a new SSL Certificate (Let's Encrypt), Force SSL, HTTP/2.

Domena musi mieć rekord DNS `A` wskazujący na serwer.

## 3. Sprawdzenie

- `https://mtg.twojadomena.pl/healthz` → `ok rooms=0`
- aplikacja otwiera się pod `https://mtg.twojadomena.pl/`

Pokoje gier są trzymane tylko w pamięci: restart kontenera na chwilę rozłącza telefony graczy,
ale stan gry zostaje na urządzeniu-gospodarzu, które odtwarza pokój pod tym samym kodem, a telefony łączą się ponownie same.
