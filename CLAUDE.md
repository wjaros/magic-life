# Magic Life: zasady dla Claude

## Wdrożenia na własną infrastrukturę (Docker + Nginx Proxy Manager)

Właściciel hostuje na własnej infrastrukturze: serwer z Dockerem plus Nginx Proxy Manager
(z obsługą WebSocketów), **często na innym hoście niż aplikacja**. Przy plikach wdrożeniowych:

- **Port na hoście:** nie używaj popularnych portów (80, 443, 3000, 5000, 8000, 8080, 8443,
  9000…), bo na serwerze z Dockerem zwykle są zajęte. Wybierz nietypowy (np. 18040) i daj
  możliwość zmiany przez zmienną (`HOST_PORT`). Port wewnątrz kontenera może być dowolny.
- **Adres:** domyślnie publikuj na `0.0.0.0`, żeby NPM z innego hosta połączył się bez
  dodatkowej konfiguracji. Ograniczenie do jednego adresu (`HOST_BIND`) to opcja, nie domyślne
  ustawienie. Nie ustawiaj `127.0.0.1` jako domyślnego, bo wtedy NPM z innego hosta się nie połączy.
- **Wariant „NPM na tym samym hoście”:** daj go jako osobny plik nakładkowy docker-compose
  (wspólna sieć zewnętrzna, bez publikowania portu), a nie jako wariant domyślny.
- **HTTPS/SSL** załatwia NPM (Let's Encrypt). Aplikacja w kontenerze serwuje zwykłe HTTP.
  W instrukcji podaj pola formularza Proxy Host w NPM (Forward Hostname/IP, Forward Port,
  Websockets Support, zakładka SSL).
- **Firewall:** nie zalecaj `ufw`/`firewalld` do ochrony portów kontenerów, bo Docker je omija.
  Jeśli trzeba filtrować, użyj łańcucha `DOCKER-USER` albo `HOST_BIND`.
- Dodaj endpoint `/healthz` i `HEALTHCHECK` w Dockerfile oraz podaj komendę `curl`
  do sprawdzenia połączenia z hosta NPM.
