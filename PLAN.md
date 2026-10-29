# Magic Life: plan budowy PWA (MTG Commander)

PWA do liczenia życia i czasu przy stole w Commanderze. Działa offline, instaluje się na telefonie, ekran się nie wygasza, telefon leży na środku stołu.

## 1. Zakres (MVP)

**Życie i liczniki**
- 2–6 graczy, start 40 życia (do ustawienia: 20/30/40).
- Tap = ±1, przytrzymanie = ±10 (z powtarzaniem), pokazywana zmiana z ostatnich ~2 s ("−7").
- Commander damage: macierz gracz × przeciwnik (+ partner). 21 od jednego commandera = przegrana.
- Trucizna (10 = przegrana), commander tax, energia/doświadczenie (opcjonalnie).
- Monarch / Initiative, każdy jako jeden znacznik.
- Undo (historia zdarzeń), reset gry, oznaczanie graczy jako wyeliminowanych.

**Czas**
- Zegar całej gry.
- Zegar tury typu chess clock: aktywny gracz, przycisk „Następna tura", czas łączny każdego gracza i licznik tur.
- Pauza. Zegar liczy z timestampów (`Date.now()`), nie z `setInterval`, więc działa poprawnie po zablokowaniu ekranu.
- Opcjonalnie: limit czasu na turę z wibracją lub dźwiękiem.

**Przy stole**
- Układy na 2/3/4/5/6 graczy, panele obrócone w stronę siedzących (0°/90°/180°/270°).
- Kolor/nazwa gracza, duże cyfry, tryb ciemny jako domyślny.
- Wake Lock API (ekran nie gaśnie), wibracje, pełny ekran.

**PWA**
- Manifest, ikony, service worker (precache), instalacja, 100% offline.
- Stan gry w `localStorage`, przeżywa odświeżenie i zamknięcie aplikacji.

Poza MVP: historia rozegranych gier, statystyki, losowanie pierwszego gracza, rzut kostką/monetą, synchronizacja wielu urządzeń.

## 2. Stack

| Obszar | Wybór | Dlaczego |
|---|---|---|
| Build | Vite + TypeScript | szybko, mało konfiguracji |
| UI | Preact (+ signals) | mały bundle, React-owe API |
| PWA | `vite-plugin-pwa` (Workbox) | manifest + SW z konfiguracji |
| Testy | Vitest (logika), Playwright (e2e, mobile viewport) | |
| Hosting | GitHub Pages przez GitHub Actions | darmowy HTTPS, którego wymaga PWA |

## 3. Architektura

```
src/
  core/        # czysta logika, zero DOM: typy, reducer, reguły przegranej
    types.ts
    game.ts    # reducer(state, action) -> state, historia na potrzeby undo
    rules.ts   # isEliminated(), lethal checks
  timer/       # silnik zegara oparty o timestampy
    clock.ts
  storage/     # persist/rehydrate + wersjonowanie schematu
  ui/
    layouts/   # siatki na 2–6 graczy + rotacje
    components/ PlayerPanel, CounterButton, CmdDamageSheet, TurnBar, SetupScreen
  pwa/         # wake lock, rejestracja SW, prompt instalacji
```

**Kontrakt (Faza 0, wspólny dla wszystkich agentów):** `core/types.ts`, czyli `GameState`, `Player`, `Action` (union), oraz interfejs `Clock` (`start/pause/nextTurn/snapshot(now)`). Agenci pracują równolegle i spotykają się dopiero na tych typach.

## 4. Podział na agentów

Orkiestrator (główna sesja) robi Fazę 0, rozdziela zadania, scala gałęzie i rozstrzyga konflikty. Każdy agent pracuje w osobnym worktree (`isolation: worktree`) na własnej gałęzi i kończy, gdy jego testy przechodzą.

### Faza 0: Fundament (orkiestrator, sekwencyjnie)
- Scaffold Vite + TS + Preact, ESLint/Prettier, Vitest, Playwright.
- `core/types.ts` i interfejs `Clock`: zamrożone, zmiany tylko przez orkiestratora.
- Pusty `App` z routingiem Setup → Game.
- **Wyjście:** `npm run dev / build / test` działa na `master`.

### Faza 1: Równolegle (4 agenty)

| Agent | Zadanie | Pliki | Definicja ukończenia |
|---|---|---|---|
| **A: Core** | reducer gry: życie, cmd damage (z partnerem), trucizna, tax, monarch/initiative, eliminacja, undo | `src/core/**` | ≥90% pokrycia Vitest, testy reguł 21/10/0 życia |
| **B: Timer** | chess clock na timestampach: pauza, następna tura, czas per gracz, opcjonalny limit tury | `src/timer/**` | testy z fake timers, w tym symulacja „ekran zablokowany 5 min" |
| **C: UI** | ekran setupu, layouty 2–6 z rotacją, PlayerPanel (tap/hold), arkusz cmd damage, pasek tury. Na początku podłączony do mocków typów | `src/ui/**` | wygląda dobrze na 360×740 i 768×1024, duże pola dotyku ≥48 px |
| **D: PWA** | `vite-plugin-pwa`, manifest, ikony (SVG→PNG 192/512/maskable), Wake Lock, `storage/` z migracjami, workflow GitHub Pages | `vite.config.ts`, `src/pwa/**`, `src/storage/**`, `.github/workflows/**`, `public/**` | działa offline, da się zainstalować, deploy przechodzi |

Pliki się nie pokrywają, więc scalanie powinno obejść się bez konfliktów.

### Faza 2: Integracja (orkiestrator)
- Merge A, B, D, potem C. Podpięcie UI pod prawdziwy reducer i zegar, persist stanu.
- Jeden przejazd ręczny: 4 graczy, cała gra, undo, odświeżenie w trakcie.

### Faza 3: QA (2 agenty równolegle)

| Agent | Zadanie |
|---|---|
| **E: E2E** | Playwright (Pixel 7 / iPhone 14 viewport): setup → gra → eliminacja przez cmd damage → undo → reload zachowuje stan → tryb offline |
| **F: Review** | `/code-review` + audyt Lighthouse (PWA, a11y, performance), lista poprawek do orkiestratora |

### Faza 4: Poprawki i release
- Orkiestrator (albo agent A/C ponownie) wdraża poprawki z Fazy 3, tag `v1.0`, deploy na Pages.

### Modele agentów (wariant oszczędny)

| Agent | Model |
|---|---|
| A: Core | Sonnet |
| B: Timer | Haiku |
| C: UI | Sonnet |
| D: PWA | Haiku |
| E: E2E | Haiku |
| F: Review | Sonnet |

## 5. Graf zależności

```
Faza 0 ──┬── A Core ──┐
         ├── B Timer ─┤
         ├── C UI ────┼── Faza 2 Integracja ──┬── E E2E ────┐
         └── D PWA ───┘                       └── F Review ─┴── Faza 4 Release
```

## 6. Ryzyka

- **iOS Safari:** Wake Lock działa od iOS 16.4, wibracji brak. Trzeba zrobić fallback i nie polegać na haptyce.
- **Zegar w tle:** przeglądarki usypiają timery, stąd tylko timestampy i przeliczanie przy `visibilitychange`.
- **Przypadkowe tapnięcia:** debounce, wyraźny podgląd zmiany, łatwe undo.
- **Zmiana schematu stanu:** pole `version` w `localStorage` i migracje w `storage/`.
