# Wdrożenie na własny serwer (Docker + Nginx Proxy Manager)

Jeden kontener serwuje aplikację i WebSocket (`/ws`) do gry na kilku telefonach.
HTTPS (certyfikat SSL) robi Nginx Proxy Manager.

## 1. Kontener

```bash
git clone https://github.com/wjaros/magic-life.git
cd magic-life
```

**Wariant A: Nginx Proxy Manager na innym hoście** (domyślny):

```bash
export HOST_PORT=18040   # dowolny wolny port: ss -tlnp | grep 18040
docker compose up -d --build
```

Kontener słucha na wszystkich adresach serwera (`0.0.0.0`), więc NPM z innego hosta
połączy się od razu. Ten port serwuje zwykłe HTTP z pominięciem NPM:

- serwer w sieci domowej za routerem (bez przekierowania portu) — nic nie trzeba robić;
- serwer z publicznym IP (VPS) — port jest widoczny z internetu. Aplikacja nie ma kont
  ani haseł, więc ryzyko jest małe, ale możesz go ograniczyć:
  - `export HOST_BIND=192.168.1.20` — słuchaj tylko na adresie LAN/VPN (np. Tailscale),
  - albo reguła w łańcuchu `DOCKER-USER` (uwaga: **ufw/firewalld nie filtrują portów
    wystawionych przez Dockera**):

    ```bash
    sudo iptables -I DOCKER-USER -p tcp --dport 8080 ! -s <IP-hosta-NPM> -j DROP
    ```

    (`--dport` to port w kontenerze, 8080, bo reguła działa już po przekierowaniu).

**Wariant B: NPM na tym samym hoście** (bez wystawiania portu, przez wspólną sieć Dockera; wymaga Docker Compose 2.24+):

```bash
export PROXY_NETWORK=npm_default   # nazwa sieci kontenera NPM: docker network ls
docker compose -f docker-compose.yml -f docker-compose.npm-network.yml up -d --build
```

Aktualizacja: `git pull` i ta sama komenda `docker compose ... up -d --build`.

## 2. Nginx Proxy Manager

Hosts → Proxy Hosts → Add Proxy Host:

| Pole | Wariant A (inny host) | Wariant B (ten sam host) |
|---|---|---|
| Domain Names | `mtg.twojadomena.pl` | `mtg.twojadomena.pl` |
| Scheme | `http` | `http` |
| Forward Hostname / IP | IP serwera z aplikacją, np. `192.168.1.20` | `magic-life` |
| Forward Port | `18040` (`HOST_PORT`) | `8080` (port w kontenerze) |
| Websockets Support | **włączone** | **włączone** |
| Block Common Exploits | włączone | włączone |

Zakładka **SSL**: Request a new SSL Certificate (Let's Encrypt), Force SSL, HTTP/2.

Domena musi mieć rekord DNS `A` wskazujący na host, na którym działa NPM.
Host z NPM musi móc połączyć się z serwerem aplikacji na porcie `HOST_PORT`
(sprawdź z hosta NPM: `curl http://192.168.1.20:18040/healthz`).

## 3. Sprawdzenie

- `https://mtg.twojadomena.pl/healthz` → `ok rooms=0`
- aplikacja otwiera się pod `https://mtg.twojadomena.pl/`

Pokoje gier są trzymane tylko w pamięci: restart kontenera na chwilę rozłącza telefony graczy,
ale stan gry zostaje na urządzeniu-gospodarzu, które odtwarza pokój pod tym samym kodem, a telefony łączą się ponownie same.
